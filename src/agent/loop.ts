import type { LLMProvider, ChatMessage } from "../providers/base.js";
import type { MessageBus } from "../bus/queue.js";
import type {
  InboundMessage,
  OutboundMessage,
} from "../bus/events.js";
import { createOutboundMessage } from "../bus/events.js";
import { ContextBuilder } from "./context.js";
import { ToolRegistry } from "./tools/registry.js";
import {
  ReadFileTool,
  WriteFileTool,
  EditFileTool,
  ListDirTool,
} from "./tools/filesystem.js";
import { ExecTool } from "./tools/shell.js";
import { WebSearchTool, WebFetchTool } from "./tools/web.js";
import { MessageTool } from "./tools/message.js";
import { SpawnTool } from "./tools/spawn.js";
import { CronTool } from "./tools/cron.js";
import { SubagentManager } from "./subagent.js";
import { SessionManager } from "../session/manager.js";
import type { ExecToolConfig } from "../config/schema.js";
import type { CronService } from "../cron/service.js";

/**
 * The agent loop: core processing engine.
 *
 * 1. Receives messages from the bus
 * 2. Builds context with history, memory, skills
 * 3. Calls the LLM
 * 4. Executes tool calls
 * 5. Sends responses back
 */
export class AgentLoop {
  private bus: MessageBus;
  private provider: LLMProvider;
  private workspace: string;
  private model: string;
  private maxTokens: number;
  private maxIterations: number;

  readonly context: ContextBuilder;
  readonly sessions: SessionManager;
  readonly tools: ToolRegistry;
  readonly subagents: SubagentManager;

  private _running = false;

  constructor(params: {
    bus: MessageBus;
    provider: LLMProvider;
    workspace: string;
    model?: string;
    maxTokens?: number;
    maxIterations?: number;
    braveApiKey?: string;
    execConfig?: ExecToolConfig;
    cronService?: CronService;
  }) {
    this.bus = params.bus;
    this.provider = params.provider;
    this.workspace = params.workspace;
    this.model = params.model ?? params.provider.getDefaultModel();
    this.maxTokens = params.maxTokens ?? 8192;
    this.maxIterations = params.maxIterations ?? 20;

    const execConfig = params.execConfig ?? {
      timeout: 60,
      restrictToWorkspace: false,
    };

    this.context = new ContextBuilder(params.workspace);
    this.sessions = new SessionManager(params.workspace);
    this.tools = new ToolRegistry();
    this.subagents = new SubagentManager({
      provider: params.provider,
      workspace: params.workspace,
      bus: params.bus,
      model: this.model,
      braveApiKey: params.braveApiKey,
      execConfig,
    });

    this.registerDefaultTools(execConfig, params.braveApiKey, params.cronService);
  }

  private registerDefaultTools(
    execConfig: ExecToolConfig,
    braveApiKey?: string,
    cronService?: CronService,
  ): void {
    // File tools
    this.tools.register(new ReadFileTool());
    this.tools.register(new WriteFileTool());
    this.tools.register(new EditFileTool());
    this.tools.register(new ListDirTool());

    // Shell tool
    this.tools.register(
      new ExecTool({
        workingDir: this.workspace,
        timeout: execConfig.timeout,
        restrictToWorkspace: execConfig.restrictToWorkspace,
      }),
    );

    // Web tools
    this.tools.register(new WebSearchTool({ apiKey: braveApiKey }));
    this.tools.register(new WebFetchTool());

    // Message tool
    const messageTool = new MessageTool({
      sendCallback: (msg) => this.bus.publishOutbound(msg),
    });
    this.tools.register(messageTool);

    // Spawn tool
    const spawnTool = new SpawnTool(this.subagents);
    this.tools.register(spawnTool);

    // Cron tool
    if (cronService) {
      this.tools.register(new CronTool(cronService));
    }
  }

  /** Run the agent loop, processing messages from the bus. */
  async run(): Promise<void> {
    this._running = true;
    console.log("Agent loop started");

    while (this._running) {
      try {
        const msg = await this.bus.consumeInboundTimeout(1000);

        try {
          const response = await this.processMessage(msg);
          if (response) {
            await this.bus.publishOutbound(response);
          }
        } catch (err) {
          console.error("Error processing message:", err);
          await this.bus.publishOutbound(
            createOutboundMessage({
              channel: msg.channel,
              chatId: msg.chatId,
              content: `Sorry, I encountered an error: ${err instanceof Error ? err.message : err}`,
            }),
          );
        }
      } catch {
        // timeout, continue
      }
    }
  }

  /** Stop the agent loop. */
  stop(): void {
    this._running = false;
    console.log("Agent loop stopping");
  }

  /** Process a single inbound message. */
  private async processMessage(
    msg: InboundMessage,
  ): Promise<OutboundMessage | null> {
    // Handle system messages (subagent announces)
    if (msg.channel === "system") {
      return this.processSystemMessage(msg);
    }

    console.log(`Processing message from ${msg.channel}:${msg.senderId}`);

    const sessionKey = `${msg.channel}:${msg.chatId}`;
    const session = this.sessions.getOrCreate(sessionKey);

    // Update tool contexts
    this.updateToolContexts(msg.channel, msg.chatId);

    // Build initial messages
    const messages = this.context.buildMessages({
      history: session.getHistory(),
      currentMessage: msg.content,
      media: msg.media.length > 0 ? msg.media : undefined,
      channel: msg.channel,
      chatId: msg.chatId,
    });

    // The messages array is: [system, ...history, currentUser]
    // We want to save from the current user message onward (skip system + old history).
    const savedHistoryLen = session.getHistory().length;
    const newMsgStart = 1 + savedHistoryLen; // 1 for system prompt

    // Agent loop (mutates messages by appending assistant/tool messages)
    const finalContent = await this.runAgentLoop(messages);

    // Save the new messages from this turn (user + all agent loop messages)
    session.addTurnMessages(messages.slice(newMsgStart));
    this.sessions.save(session);

    return createOutboundMessage({
      channel: msg.channel,
      chatId: msg.chatId,
      content: finalContent,
    });
  }

  private async processSystemMessage(
    msg: InboundMessage,
  ): Promise<OutboundMessage | null> {
    console.log(`Processing system message from ${msg.senderId}`);

    let originChannel: string;
    let originChatId: string;

    if (msg.chatId.includes(":")) {
      const [ch, id] = msg.chatId.split(":", 2);
      originChannel = ch;
      originChatId = id;
    } else {
      originChannel = "cli";
      originChatId = msg.chatId;
    }

    const sessionKey = `${originChannel}:${originChatId}`;
    const session = this.sessions.getOrCreate(sessionKey);

    this.updateToolContexts(originChannel, originChatId);

    const messages = this.context.buildMessages({
      history: session.getHistory(),
      currentMessage: msg.content,
      channel: originChannel,
      chatId: originChatId,
    });

    const savedHistoryLen = session.getHistory().length;
    const newMsgStart = 1 + savedHistoryLen;

    const finalContent = await this.runAgentLoop(messages);

    session.addTurnMessages(messages.slice(newMsgStart));
    this.sessions.save(session);

    return createOutboundMessage({
      channel: originChannel,
      chatId: originChatId,
      content: finalContent,
    });
  }

  private async runAgentLoop(messages: ChatMessage[]): Promise<string> {
    let finalContent: string | null = null;

    for (let i = 0; i < this.maxIterations; i++) {
      const response = await this.provider.chat({
        messages,
        tools: this.tools.getDefinitions(),
        model: this.model,
        maxTokens: this.maxTokens,
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

        this.context.addAssistantMessage(
          messages,
          response.content,
          toolCallDicts,
        );

        for (const tc of response.toolCalls) {
          console.log(
            `Executing tool: ${tc.name} with arguments: ${JSON.stringify(tc.arguments)}`,
          );
          const result = await this.tools.execute(tc.name, tc.arguments);
          this.context.addToolResult(messages, tc.id, tc.name, result);
        }
      } else {
        finalContent = response.content;
        // Push the final assistant message so it gets persisted with the turn
        messages.push({ role: "assistant", content: finalContent ?? "" });
        break;
      }
    }

    finalContent ??= "I've completed processing but have no response to give.";

    // If we exhausted iterations without a non-tool-call response, still persist the final text
    if (messages[messages.length - 1]?.role !== "assistant" || messages[messages.length - 1]?.content !== finalContent) {
      messages.push({ role: "assistant", content: finalContent });
    }

    return finalContent;
  }

  private updateToolContexts(channel: string, chatId: string): void {
    const messageTool = this.tools.get("message");
    if (messageTool instanceof MessageTool) {
      messageTool.setContext(channel, chatId);
    }

    const spawnTool = this.tools.get("spawn");
    if (spawnTool instanceof SpawnTool) {
      spawnTool.setContext(channel, chatId);
    }

    const cronTool = this.tools.get("cron");
    if (cronTool instanceof CronTool) {
      cronTool.setContext(channel, chatId);
    }
  }

  /** Process a message directly (for CLI or cron usage). */
  async processDirect(
    content: string,
    sessionKey = "cli:direct",
    channel = "cli",
    chatId = "direct",
  ): Promise<string> {
    // Use inline version of processMessage for direct calls
    const session = this.sessions.getOrCreate(sessionKey);
    this.updateToolContexts(channel, chatId);

    const messages = this.context.buildMessages({
      history: session.getHistory(),
      currentMessage: content,
      channel,
      chatId,
    });

    const savedHistoryLen = session.getHistory().length;
    const newMsgStart = 1 + savedHistoryLen;

    const finalContent = await this.runAgentLoop(messages);

    session.addTurnMessages(messages.slice(newMsgStart));
    this.sessions.save(session);

    return finalContent;
  }
}

