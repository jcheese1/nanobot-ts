import { randomUUID } from "node:crypto";
import type { LLMProvider, ChatMessage } from "../providers/base.js";
import type { MessageBus } from "../bus/queue.js";
import { createInboundMessage } from "../bus/events.js";
import { ToolRegistry } from "./tools/registry.js";
import { ReadFileTool, WriteFileTool, ListDirTool } from "./tools/filesystem.js";
import { ExecTool } from "./tools/shell.js";
import { WebSearchTool, WebFetchTool } from "./tools/web.js";
import type { ExecToolConfig } from "../config/schema.js";

/**
 * Manages background subagent execution.
 */
export class SubagentManager {
  private provider: LLMProvider;
  private workspace: string;
  private bus: MessageBus;
  private model: string;
  private braveApiKey?: string;
  private execConfig: ExecToolConfig;
  private runningTasks = new Map<string, AbortController>();

  constructor(params: {
    provider: LLMProvider;
    workspace: string;
    bus: MessageBus;
    model?: string;
    braveApiKey?: string;
    execConfig?: ExecToolConfig;
  }) {
    this.provider = params.provider;
    this.workspace = params.workspace;
    this.bus = params.bus;
    this.model = params.model ?? params.provider.getDefaultModel();
    this.braveApiKey = params.braveApiKey;
    this.execConfig = params.execConfig ?? { timeout: 60, restrictToWorkspace: false };
  }

  /** Spawn a subagent to execute a task in the background. */
  async spawn(params: {
    task: string;
    label?: string;
    originChannel?: string;
    originChatId?: string;
  }): Promise<string> {
    const taskId = randomUUID().slice(0, 8);
    const displayLabel =
      params.label ??
      (params.task.length > 30
        ? params.task.slice(0, 30) + "..."
        : params.task);

    const origin = {
      channel: params.originChannel ?? "cli",
      chatId: params.originChatId ?? "direct",
    };

    const controller = new AbortController();
    this.runningTasks.set(taskId, controller);

    // Run in background (don't await)
    this.runSubagent(taskId, params.task, displayLabel, origin)
      .finally(() => this.runningTasks.delete(taskId));

    console.log(`Spawned subagent [${taskId}]: ${displayLabel}`);
    return `Subagent [${displayLabel}] started (id: ${taskId}). I'll notify you when it completes.`;
  }

  private async runSubagent(
    taskId: string,
    task: string,
    label: string,
    origin: { channel: string; chatId: string },
  ): Promise<void> {
    console.log(`Subagent [${taskId}] starting task: ${label}`);

    try {
      // Build subagent tools (no message, no spawn)
      const tools = new ToolRegistry();
      tools.register(new ReadFileTool());
      tools.register(new WriteFileTool());
      tools.register(new ListDirTool());
      tools.register(
        new ExecTool({
          workingDir: this.workspace,
          timeout: this.execConfig.timeout,
          restrictToWorkspace: this.execConfig.restrictToWorkspace,
        }),
      );
      tools.register(new WebSearchTool({ apiKey: this.braveApiKey }));
      tools.register(new WebFetchTool());

      const systemPrompt = this.buildSubagentPrompt(task);
      const messages: ChatMessage[] = [
        { role: "system", content: systemPrompt },
        { role: "user", content: task },
      ];

      const maxIterations = 15;
      let finalResult: string | null = null;

      for (let i = 0; i < maxIterations; i++) {
        const response = await this.provider.chat({
          messages,
          tools: tools.getDefinitions(),
          model: this.model,
        });

        if (response.hasToolCalls) {
          const toolCallDicts = response.toolCalls.map((tc) => ({
            id: tc.id,
            type: "function" as const,
            function: {
              name: tc.name,
              arguments: JSON.stringify(tc.arguments),
            },
          }));

          messages.push({
            role: "assistant",
            content: response.content ?? "",
            tool_calls: toolCallDicts,
          });

          for (const tc of response.toolCalls) {
            console.log(
              `Subagent [${taskId}] executing: ${tc.name}`,
            );
            const result = await tools.execute(tc.name, tc.arguments);
            messages.push({
              role: "tool",
              tool_call_id: tc.id,
              name: tc.name,
              content: result,
            });
          }
        } else {
          finalResult = response.content;
          break;
        }
      }

      finalResult ??= "Task completed but no final response was generated.";
      console.log(`Subagent [${taskId}] completed successfully`);
      await this.announceResult(taskId, label, task, finalResult, origin, "ok");
    } catch (err) {
      const errorMsg = `Error: ${err instanceof Error ? err.message : err}`;
      console.error(`Subagent [${taskId}] failed:`, err);
      await this.announceResult(
        taskId,
        label,
        task,
        errorMsg,
        origin,
        "error",
      );
    }
  }

  private async announceResult(
    taskId: string,
    label: string,
    task: string,
    result: string,
    origin: { channel: string; chatId: string },
    status: string,
  ): Promise<void> {
    const statusText =
      status === "ok" ? "completed successfully" : "failed";

    const content = `[Subagent '${label}' ${statusText}]

Task: ${task}

Result:
${result}

Summarize this naturally for the user. Keep it brief (1-2 sentences). Do not mention technical details like "subagent" or task IDs.`;

    const msg = createInboundMessage({
      channel: "system",
      senderId: "subagent",
      chatId: `${origin.channel}:${origin.chatId}`,
      content,
    });

    await this.bus.publishInbound(msg);
  }

  private buildSubagentPrompt(task: string): string {
    return `# Subagent

You are a subagent spawned by the main agent to complete a specific task.

## Your Task
${task}

## Rules
1. Stay focused - complete only the assigned task, nothing else
2. Your final response will be reported back to the main agent
3. Do not initiate conversations or take on side tasks
4. Be concise but informative in your findings

## What You Can Do
- Read and write files in the workspace
- Execute shell commands
- Search the web and fetch web pages
- Complete the task thoroughly

## What You Cannot Do
- Send messages directly to users (no message tool available)
- Spawn other subagents
- Access the main agent's conversation history

## Workspace
Your workspace is at: ${this.workspace}

When you have completed the task, provide a clear summary of your findings or actions.`;
  }

  get runningCount(): number {
    return this.runningTasks.size;
  }
}
