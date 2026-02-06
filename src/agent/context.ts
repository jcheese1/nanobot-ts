import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { ChatMessage, ContentPart } from "../providers/base.js";
import { MemoryStore } from "./memory.js";
import { SkillsLoader } from "./skills.js";

const BOOTSTRAP_FILES = [
  "AGENTS.md",
  "SOUL.md",
  "USER.md",
  "TOOLS.md",
  "IDENTITY.md",
];

/**
 * Builds the context (system prompt + messages) for the agent.
 */
export class ContextBuilder {
  private workspace: string;
  readonly memory: MemoryStore;
  readonly skills: SkillsLoader;

  constructor(workspace: string) {
    this.workspace = workspace;
    this.memory = new MemoryStore(workspace);
    this.skills = new SkillsLoader(workspace);
  }

  /** Build the system prompt from bootstrap files, memory, and skills. */
  buildSystemPrompt(): string {
    const parts: string[] = [];

    // Core identity
    parts.push(this.getIdentity());

    // Bootstrap files
    const bootstrap = this.loadBootstrapFiles();
    if (bootstrap) parts.push(bootstrap);

    // Memory context
    const memory = this.memory.getMemoryContext();
    if (memory) parts.push(`# Memory\n\n${memory}`);

    // Always-loaded skills
    const alwaysSkills = this.skills.getAlwaysSkills();
    if (alwaysSkills.length > 0) {
      const alwaysContent = this.skills.loadSkillsForContext(alwaysSkills);
      if (alwaysContent) {
        parts.push(`# Active Skills\n\n${alwaysContent}`);
      }
    }

    // Available skills summary
    const skillsSummary = this.skills.buildSkillsSummary();
    if (skillsSummary) {
      parts.push(
        `# Skills\n\n` +
          `The following skills extend your capabilities. To use a skill, read its SKILL.md file using the read_file tool.\n` +
          `Skills with available="false" need dependencies installed first.\n\n` +
          skillsSummary,
      );
    }

    return parts.join("\n\n---\n\n");
  }

  private getIdentity(): string {
    const now = new Date();
    const dateStr = now.toISOString().slice(0, 16).replace("T", " ");
    const dayName = now.toLocaleDateString("en-US", { weekday: "long" });

    return `# nanobot

You are nanobot, a helpful AI assistant. You have access to tools that allow you to:
- Read, write, and edit files
- Execute shell commands
- Search the web and fetch web pages
- Send messages to users on chat channels
- Spawn subagents for complex background tasks

## Current Time
${dateStr} (${dayName})

## Workspace
Your workspace is at: ${this.workspace}
- Memory files: ${this.workspace}/memory/MEMORY.md
- Daily notes: ${this.workspace}/memory/YYYY-MM-DD.md
- Custom skills: ${this.workspace}/skills/{skill-name}/SKILL.md

IMPORTANT: When responding to direct questions or conversations, reply directly with your text response.
Only use the 'message' tool when you need to send a message to a specific chat channel.
For normal conversation, just respond with text - do not call the message tool.

Always be helpful, accurate, and concise. When using tools, explain what you're doing.
When remembering something, write to ${this.workspace}/memory/MEMORY.md`;
  }

  private loadBootstrapFiles(): string {
    const parts: string[] = [];
    for (const filename of BOOTSTRAP_FILES) {
      const filePath = join(this.workspace, filename);
      if (existsSync(filePath)) {
        const content = readFileSync(filePath, "utf-8");
        parts.push(`## ${filename}\n\n${content}`);
      }
    }
    return parts.join("\n\n");
  }

  /** Build the complete message list for an LLM call. */
  buildMessages(params: {
    history: Array<{ role: string; content: string }>;
    currentMessage: string;
    media?: string[];
    channel?: string;
    chatId?: string;
  }): ChatMessage[] {
    const messages: ChatMessage[] = [];

    // System prompt
    let systemPrompt = this.buildSystemPrompt();
    if (params.channel && params.chatId) {
      systemPrompt += `\n\n## Current Session\nChannel: ${params.channel}\nChat ID: ${params.chatId}`;
    }
    messages.push({ role: "system", content: systemPrompt });

    // History
    for (const msg of params.history) {
      messages.push({
        role: msg.role as "user" | "assistant",
        content: msg.content,
      });
    }

    // Current message (with optional image attachments)
    const userContent = this.buildUserContent(
      params.currentMessage,
      params.media,
    );
    messages.push({ role: "user", content: userContent });

    return messages;
  }

  private buildUserContent(
    text: string,
    media?: string[],
  ): string | ContentPart[] {
    if (!media || media.length === 0) return text;

    const images: ContentPart[] = [];
    for (const filePath of media) {
      if (!existsSync(filePath)) continue;
      try {
        const data = readFileSync(filePath);
        const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
        const mimeMap: Record<string, string> = {
          jpg: "image/jpeg",
          jpeg: "image/jpeg",
          png: "image/png",
          gif: "image/gif",
          webp: "image/webp",
        };
        const mime = mimeMap[ext];
        if (!mime) continue;

        const b64 = data.toString("base64");
        images.push({
          type: "image_url",
          image_url: { url: `data:${mime};base64,${b64}` },
        });
      } catch {
        // skip unreadable files
      }
    }

    if (images.length === 0) return text;
    return [...images, { type: "text", text }];
  }

  /** Add a tool result to the message list. */
  addToolResult(
    messages: ChatMessage[],
    toolCallId: string,
    toolName: string,
    result: string,
  ): ChatMessage[] {
    messages.push({
      role: "tool",
      tool_call_id: toolCallId,
      name: toolName,
      content: result,
    });
    return messages;
  }

  /** Add an assistant message to the message list. */
  addAssistantMessage(
    messages: ChatMessage[],
    content: string | null,
    toolCalls?: Array<{
      id: string;
      type: "function";
      function: { name: string; arguments: string };
    }>,
  ): ChatMessage[] {
    const msg: ChatMessage = {
      role: "assistant",
      content: content ?? "",
    };
    if (toolCalls) {
      msg.tool_calls = toolCalls;
    }
    messages.push(msg);
    return messages;
  }
}
