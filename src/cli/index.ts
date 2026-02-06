#!/usr/bin/env node
/**
 * nanobot CLI - Personal AI Assistant
 */

import { Command } from "commander";
import { existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { VERSION, LOGO } from "../index.js";
import { loadConfig, saveConfig } from "../config/loader.js";
import { getConfigPath, getDataDir } from "../config/loader.js";
import {
  ConfigSchema,
  getConfigWorkspacePath,
  getApiKey,
  getApiBase,
} from "../config/schema.js";
import type { Config } from "../config/schema.js";
import { GatewayServer } from "../gateway/server.js";

const program = new Command();

program
  .name("nanobot")
  .description(`${LOGO} nanobot - Personal AI Assistant`)
  .version(`${LOGO} nanobot v${VERSION}`, "-v, --version");

// ============================================================================
// Onboard / Setup
// ============================================================================

program
  .command("onboard")
  .description("Initialize nanobot configuration and workspace")
  .action(() => {
    const configPath = getConfigPath();

    if (existsSync(configPath)) {
      console.log(`Config already exists at ${configPath}`);
      console.log("Delete it first if you want to start fresh.");
      return;
    }

    // Create default config
    const config = ConfigSchema.parse({});
    saveConfig(config);
    console.log(`Created config at ${configPath}`);

    // Create workspace
    const workspace = getConfigWorkspacePath(config);
    createWorkspaceTemplates(workspace);

    console.log(`\n${LOGO} nanobot is ready!`);
    console.log("\nNext steps:");
    console.log("  1. Add your API key to ~/.nanobot/config.json");
    console.log("     Get one at: https://openrouter.ai/keys");
    console.log('  2. Chat: nanobot agent -m "Hello!"');
    console.log(
      "\nWant Telegram? See: https://github.com/HKUDS/nanobot#-chat-apps",
    );
  });

function createWorkspaceTemplates(workspace: string): void {
  if (!existsSync(workspace)) {
    mkdirSync(workspace, { recursive: true });
  }

  const templates: Record<string, string> = {
    "AGENTS.md": `# Agent Instructions

You are a helpful AI assistant. Be concise, accurate, and friendly.

## Guidelines

- Always explain what you're doing before taking actions
- Ask for clarification when the request is ambiguous
- Use tools to help accomplish tasks
- Remember important information in your memory files
`,
    "SOUL.md": `# Soul

I am nanobot, a lightweight AI assistant.

## Personality

- Helpful and friendly
- Concise and to the point
- Curious and eager to learn

## Values

- Accuracy over speed
- User privacy and safety
- Transparency in actions
`,
    "USER.md": `# User

Information about the user goes here.

## Preferences

- Communication style: (casual/formal)
- Timezone: (your timezone)
- Language: (your preferred language)
`,
  };

  for (const [filename, content] of Object.entries(templates)) {
    const filePath = join(workspace, filename);
    if (!existsSync(filePath)) {
      writeFileSync(filePath, content);
      console.log(`  Created ${filename}`);
    }
  }

  // Create memory directory and MEMORY.md
  const memoryDir = join(workspace, "memory");
  if (!existsSync(memoryDir)) {
    mkdirSync(memoryDir, { recursive: true });
  }
  const memoryFile = join(memoryDir, "MEMORY.md");
  if (!existsSync(memoryFile)) {
    writeFileSync(
      memoryFile,
      `# Long-term Memory

This file stores important information that should persist across sessions.

## User Information

(Important facts about the user)

## Preferences

(User preferences learned over time)

## Important Notes

(Things to remember)
`,
    );
    console.log("  Created memory/MEMORY.md");
  }
}

// ============================================================================
// Config Export / Import
// ============================================================================

/** Shape of the portable config bundle. */
interface ConfigBundle {
  _nanobot: string;
  version: string;
  exportedAt: string;
  config: unknown;
  cronJobs: unknown | null;
  knownChats: unknown | null;
  workspace: Record<string, string>;
}

const configCmd = program
  .command("config")
  .description("Manage nanobot configuration");

configCmd
  .command("export")
  .description("Export config, cron jobs, known chats, and workspace files to a portable JSON bundle")
  .option("-o, --output <path>", "Write to file instead of stdout")
  .action((opts) => {
    const dataDir = getDataDir();
    const config = loadConfig();
    const workspace = getConfigWorkspacePath(config);

    // Read optional data files
    const readJsonSafe = (p: string): unknown | null => {
      try { return JSON.parse(readFileSync(p, "utf-8")); } catch { return null; }
    };
    const readTextSafe = (p: string): string | null => {
      try { return readFileSync(p, "utf-8"); } catch { return null; }
    };

    // Gather workspace files
    const wsFiles: Record<string, string> = {};
    const workspaceEntries = [
      "AGENTS.md", "SOUL.md", "USER.md", "TOOLS.md", "IDENTITY.md",
      "memory/MEMORY.md",
    ];
    for (const rel of workspaceEntries) {
      const content = readTextSafe(join(workspace, rel));
      if (content !== null) wsFiles[rel] = content;
    }

    // Also grab daily memory notes
    const memoryDir = join(workspace, "memory");
    if (existsSync(memoryDir)) {
      try {
        for (const f of readdirSync(memoryDir)) {
          if (f.endsWith(".md") && f !== "MEMORY.md") {
            const content = readTextSafe(join(memoryDir, f));
            if (content !== null) wsFiles[`memory/${f}`] = content;
          }
        }
      } catch { /* ignore */ }
    }

    const bundle: ConfigBundle = {
      _nanobot: "config-bundle",
      version: VERSION,
      exportedAt: new Date().toISOString(),
      config,
      cronJobs: readJsonSafe(join(dataDir, "cron", "jobs.json")),
      knownChats: readJsonSafe(join(dataDir, "known_chats.json")),
      workspace: wsFiles,
    };

    const json = JSON.stringify(bundle, null, 2);

    if (opts.output) {
      const outDir = dirname(opts.output);
      if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
      writeFileSync(opts.output, json);
      console.log(`Exported to ${opts.output}`);
    } else {
      process.stdout.write(json + "\n");
    }
  });

configCmd
  .command("import")
  .description("Import a config bundle (from file or stdin)")
  .argument("[path]", "Path to bundle JSON file (omit to read from stdin)")
  .option("--no-workspace", "Skip importing workspace files")
  .option("--no-cron", "Skip importing cron jobs")
  .action(async (path: string | undefined, opts: { workspace: boolean; cron: boolean }) => {
    let raw: string;

    if (path) {
      if (!existsSync(path)) {
        console.error(`File not found: ${path}`);
        process.exit(1);
      }
      raw = readFileSync(path, "utf-8");
    } else {
      // Read from stdin
      const chunks: Buffer[] = [];
      for await (const chunk of process.stdin) {
        chunks.push(chunk as Buffer);
      }
      raw = Buffer.concat(chunks).toString("utf-8");
    }

    let bundle: ConfigBundle;
    try {
      bundle = JSON.parse(raw);
    } catch {
      console.error("Error: Invalid JSON");
      process.exit(1);
    }

    if (bundle._nanobot !== "config-bundle") {
      console.error("Error: Not a nanobot config bundle");
      process.exit(1);
    }

    const dataDir = getDataDir();

    // 1. Restore config
    if (bundle.config) {
      const config = ConfigSchema.parse(bundle.config);
      saveConfig(config);
      console.log("  Restored config.json");
    }

    // 2. Restore cron jobs
    if (opts.cron && bundle.cronJobs) {
      const cronDir = join(dataDir, "cron");
      if (!existsSync(cronDir)) mkdirSync(cronDir, { recursive: true });
      writeFileSync(join(cronDir, "jobs.json"), JSON.stringify(bundle.cronJobs, null, 2));
      console.log("  Restored cron/jobs.json");
    }

    // 3. Restore known chats
    if (bundle.knownChats) {
      writeFileSync(join(dataDir, "known_chats.json"), JSON.stringify(bundle.knownChats, null, 2));
      console.log("  Restored known_chats.json");
    }

    // 4. Restore workspace files
    if (opts.workspace && bundle.workspace) {
      const config = loadConfig();
      const workspace = getConfigWorkspacePath(config);

      for (const [rel, content] of Object.entries(bundle.workspace)) {
        const filePath = join(workspace, rel);
        const fileDir = dirname(filePath);
        if (!existsSync(fileDir)) mkdirSync(fileDir, { recursive: true });
        writeFileSync(filePath, content);
        console.log(`  Restored ${rel}`);
      }
    }

    console.log(`\n${LOGO} Import complete (from ${bundle.exportedAt})`);
  });

// ============================================================================
// Gateway / Server
// ============================================================================

program
  .command("gateway")
  .description("Start the nanobot gateway")
  .option("-p, --port <number>", "Gateway port", "18790")
  .option("--verbose", "Verbose output", false)
  .action(async (opts) => {
    console.log(
      `${LOGO} Starting nanobot gateway on port ${opts.port}...`,
    );

    const config = loadConfig();
    const apiKey = getApiKey(config);
    const apiBase = getApiBase(config);
    const model = config.agents.defaults.model;

    if (!apiKey) {
      console.error("Error: No API key configured.");
      console.error(
        "Set one in ~/.nanobot/config.json under providers.openrouter.apiKey",
      );
      process.exit(1);
    }

    // Dynamic imports to avoid loading heavy deps up front
    const { MessageBus } = await import("../bus/queue.js");
    const { OpenAIProvider } = await import(
      "../providers/openai-provider.js"
    );
    const { AgentLoop } = await import("../agent/loop.js");
    const { ChannelManager } = await import("../channels/manager.js");
    const { CronService } = await import("../cron/service.js");
    const { HeartbeatService } = await import(
      "../heartbeat/service.js"
    );

    const bus = new MessageBus();
    const workspace = getConfigWorkspacePath(config);

    const provider = new OpenAIProvider({
      apiKey,
      apiBase: apiBase ?? undefined,
      defaultModel: model,
    });

    // Create cron service
    const cronStorePath = join(getDataDir(), "cron", "jobs.json");
    const cron = new CronService(cronStorePath);

    // Create agent
    const agent = new AgentLoop({
      bus,
      provider,
      workspace,
      model,
      maxTokens: config.agents.defaults.maxTokens,
      maxIterations: config.agents.defaults.maxToolIterations,
      braveApiKey: config.tools.web.search.apiKey || undefined,
      execConfig: config.tools.exec,
      cronService: cron,
    });

    // Create channel manager (before cron so the callback can broadcast)
    const channels = new ChannelManager(config, bus);

    // Wire cron callback (gateway is assigned after server creation below)
    let gateway: GatewayServer | null = null;

    cron.onJob = async (job) => {
      const sessionKey = `cron:${job.id}`;

      // Snapshot history length so we can extract only this turn's messages
      const session = agent.sessions.getOrCreate(sessionKey);
      const prevLen = session.getHistory().length;

      const response = await agent.processDirect(
        job.payload.message,
        sessionKey,
        "cron",
        job.id,
      );

      // Push the full turn (tool calls + results + final answer) to the web UI via SSE
      if (gateway) {
        const turnMessages = session.getHistory().slice(prevLen);
        for (const msg of turnMessages) {
          if (msg.role === "assistant" && msg.tool_calls && msg.tool_calls.length > 0) {
            for (const tc of msg.tool_calls) {
              gateway.notifyToolCall(tc.function.name, tc.function.arguments);
            }
            // If the assistant message also has text content, push it
            if (msg.content) {
              gateway.notify("assistant", typeof msg.content === "string" ? msg.content : "", "default");
            }
          } else if (msg.role === "tool") {
            const content = typeof msg.content === "string" ? msg.content : "";
            gateway.notifyToolResult(msg.name ?? "", content);
          } else if (msg.role === "assistant") {
            gateway.notify("assistant", typeof msg.content === "string" ? msg.content : "", "default");
          }
        }
      }

      // Deliver to all configured chat channels (telegram, etc.)
      if (job.payload.deliver) {
        const { createOutboundMessage } = await import(
          "../bus/events.js"
        );

        for (const channelName of channels.enabledChannels) {
          const chatIds = channels.getKnownChatIds(channelName);
          if (chatIds.length === 0) {
            console.log(`Cron: no known chats for ${channelName}, skipping`);
            continue;
          }
          for (const chatId of chatIds) {
            await bus.publishOutbound(
              createOutboundMessage({
                channel: channelName,
                chatId,
                content: response ?? "",
              }),
            );
          }
        }
      }

      return response;
    };

    // Create heartbeat
    const heartbeat = new HeartbeatService({
      workspace,
      onHeartbeat: (prompt) =>
        agent.processDirect(prompt, "heartbeat"),
      intervalS: 30 * 60,
      enabled: true,
    });

    const cronStatus = cron.status();
    if (cronStatus.jobs > 0) {
      console.log(`Cron: ${cronStatus.jobs} scheduled jobs`);
    }
    console.log("Heartbeat: every 30m");

    // Handle graceful shutdown
    const shutdown = async () => {
      console.log("\nShutting down...");
      heartbeat.stop();
      cron.stop();
      agent.stop();
      await channels.stopAll();
      process.exit(0);
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);

    // Start HTTP gateway server
    const { createGatewayServer } = await import(
      "../gateway/server.js"
    );
    gateway = createGatewayServer({
      agent,
      port: Number(opts.port),
    });

    try {
      // Initialise channels first (non-blocking) so enabledChannels is populated
      await channels.init();
      await cron.start();
      await heartbeat.start();
      // Both agent.run() and channels.startAll() block until stopped
      await Promise.all([agent.run(), channels.startAll()]);
    } catch (err) {
      console.error("Gateway error:", err);
      process.exit(1);
    }
  });

// ============================================================================
// Agent Commands
// ============================================================================

program
  .command("agent")
  .description("Interact with the agent directly")
  .option("-m, --message <text>", "Message to send to the agent")
  .option(
    "-s, --session <id>",
    "Session ID",
    "cli:default",
  )
  .action(async (opts) => {
    const config = loadConfig();
    const apiKey = getApiKey(config);
    const apiBase = getApiBase(config);

    if (!apiKey) {
      console.error("Error: No API key configured.");
      process.exit(1);
    }

    const { MessageBus } = await import("../bus/queue.js");
    const { OpenAIProvider } = await import(
      "../providers/openai-provider.js"
    );
    const { AgentLoop } = await import("../agent/loop.js");

    const bus = new MessageBus();
    const workspace = getConfigWorkspacePath(config);

    const provider = new OpenAIProvider({
      apiKey,
      apiBase: apiBase ?? undefined,
      defaultModel: config.agents.defaults.model,
    });

    const agentLoop = new AgentLoop({
      bus,
      provider,
      workspace,
      maxTokens: config.agents.defaults.maxTokens,
      braveApiKey: config.tools.web.search.apiKey || undefined,
      execConfig: config.tools.exec,
    });

    if (opts.message) {
      // Single message mode
      const response = await agentLoop.processDirect(
        opts.message,
        opts.session,
      );
      console.log(`\n${LOGO} ${response}`);
    } else {
      // Interactive mode
      console.log(`${LOGO} Interactive mode (Ctrl+C to exit)\n`);

      const readline = await import("node:readline");
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      });

      const ask = (): void => {
        rl.question("You: ", async (input) => {
          const trimmed = input.trim();
          if (!trimmed) {
            ask();
            return;
          }

          try {
            const response = await agentLoop.processDirect(
              trimmed,
              opts.session,
            );
            console.log(`\n${LOGO} ${response}\n`);
          } catch (err) {
            console.error("Error:", err);
          }
          ask();
        });
      };

      rl.on("close", () => {
        console.log("\nGoodbye!");
        process.exit(0);
      });

      ask();
    }
  });

// ============================================================================
// Channel Commands
// ============================================================================

const channelsCmd = program
  .command("channels")
  .description("Manage channels");

channelsCmd
  .command("status")
  .description("Show channel status")
  .action(() => {
    const config = loadConfig();

    console.log("Channel Status");
    console.log("─".repeat(50));

    const tg = config.channels.telegram;
    const tgToken = tg.token
      ? `token: ${tg.token.slice(0, 10)}...`
      : "not configured";
    console.log(
      `  Telegram  ${tg.enabled ? "[enabled]" : "[disabled]"}  ${tgToken}`,
    );
  });

// ============================================================================
// Cron Commands
// ============================================================================

const cronCmd = program
  .command("cron")
  .description("Manage scheduled tasks");

cronCmd
  .command("list")
  .description("List scheduled jobs")
  .option("-a, --all", "Include disabled jobs", false)
  .action(async (opts) => {
    const { CronService } = await import("../cron/service.js");

    const storePath = join(getDataDir(), "cron", "jobs.json");
    const service = new CronService(storePath);

    const jobs = service.listJobs(opts.all);

    if (jobs.length === 0) {
      console.log("No scheduled jobs.");
      return;
    }

    console.log("Scheduled Jobs");
    console.log("─".repeat(70));
    console.log(
      `${"ID".padEnd(10)} ${"Name".padEnd(20)} ${"Schedule".padEnd(18)} ${"Status".padEnd(10)} Next Run`,
    );
    console.log("─".repeat(70));

    for (const job of jobs) {
      let sched: string;
      if (job.schedule.kind === "every") {
        sched = `every ${(job.schedule.everyMs ?? 0) / 1000}s`;
      } else if (job.schedule.kind === "cron") {
        sched = job.schedule.expr ?? "";
      } else {
        sched = "one-time";
      }

      let nextRun = "";
      if (job.state.nextRunAtMs) {
        nextRun = new Date(job.state.nextRunAtMs).toLocaleString();
      }

      const status = job.enabled ? "enabled" : "disabled";

      console.log(
        `${job.id.padEnd(10)} ${job.name.padEnd(20)} ${sched.padEnd(18)} ${status.padEnd(10)} ${nextRun}`,
      );
    }
  });

cronCmd
  .command("add")
  .description("Add a scheduled job")
  .requiredOption("-n, --name <name>", "Job name")
  .requiredOption("-m, --message <text>", "Message for agent")
  .option("-e, --every <seconds>", "Run every N seconds")
  .option("-c, --cron <expr>", "Cron expression (e.g. '0 9 * * *')")
  .option("--at <iso>", "Run once at time (ISO format)")
  .option("-d, --deliver", "Deliver response to channel", false)
  .option("--to <recipient>", "Recipient for delivery")
  .option("--channel <name>", "Channel for delivery")
  .action(async (opts) => {
    const { CronService } = await import("../cron/service.js");

    let schedule: { kind: string; everyMs?: number; expr?: string; atMs?: number };
    if (opts.every) {
      schedule = { kind: "every", everyMs: Number(opts.every) * 1000 };
    } else if (opts.cron) {
      schedule = { kind: "cron", expr: opts.cron };
    } else if (opts.at) {
      const dt = new Date(opts.at);
      schedule = { kind: "at", atMs: dt.getTime() };
    } else {
      console.error("Error: Must specify --every, --cron, or --at");
      process.exit(1);
    }

    const storePath = join(getDataDir(), "cron", "jobs.json");
    const service = new CronService(storePath);

    const job = service.addJob({
      name: opts.name,
      schedule: schedule as import("../cron/types.js").CronSchedule,
      message: opts.message,
      deliver: opts.deliver,
      to: opts.to,
      channel: opts.channel,
    });

    console.log(`Added job '${job.name}' (${job.id})`);
  });

cronCmd
  .command("remove")
  .description("Remove a scheduled job")
  .argument("<jobId>", "Job ID to remove")
  .action(async (jobId: string) => {
    const { CronService } = await import("../cron/service.js");

    const storePath = join(getDataDir(), "cron", "jobs.json");
    const service = new CronService(storePath);

    if (service.removeJob(jobId)) {
      console.log(`Removed job ${jobId}`);
    } else {
      console.error(`Job ${jobId} not found`);
    }
  });

cronCmd
  .command("enable")
  .description("Enable or disable a job")
  .argument("<jobId>", "Job ID")
  .option("--disable", "Disable instead of enable", false)
  .action(async (jobId: string, opts: { disable: boolean }) => {
    const { CronService } = await import("../cron/service.js");

    const storePath = join(getDataDir(), "cron", "jobs.json");
    const service = new CronService(storePath);

    const job = service.enableJob(jobId, !opts.disable);
    if (job) {
      const status = opts.disable ? "disabled" : "enabled";
      console.log(`Job '${job.name}' ${status}`);
    } else {
      console.error(`Job ${jobId} not found`);
    }
  });

// ============================================================================
// Status
// ============================================================================

program
  .command("status")
  .description("Show nanobot status")
  .action(() => {
    const configPath = getConfigPath();
    const config = loadConfig();
    const workspace = getConfigWorkspacePath(config);

    console.log(`${LOGO} nanobot Status\n`);

    console.log(
      `Config: ${configPath} ${existsSync(configPath) ? "[ok]" : "[missing]"}`,
    );
    console.log(
      `Workspace: ${workspace} ${existsSync(workspace) ? "[ok]" : "[missing]"}`,
    );

    if (existsSync(configPath)) {
      console.log(`Model: ${config.agents.defaults.model}`);

      const hasOpenrouter = Boolean(config.providers.openrouter.apiKey);
      const hasAnthropic = Boolean(config.providers.anthropic.apiKey);
      const hasOpenai = Boolean(config.providers.openai.apiKey);
      const hasGemini = Boolean(config.providers.gemini.apiKey);
      const hasDeepseek = Boolean(config.providers.deepseek.apiKey);
      const hasOpenaiCompatible = Boolean(config.providers.openaiCompatible.apiKey);
      console.log(
        `OpenRouter API: ${hasOpenrouter ? "[set]" : "[not set]"}`,
      );
      console.log(
        `Anthropic API: ${hasAnthropic ? "[set]" : "[not set]"}`,
      );
      console.log(
        `OpenAI API: ${hasOpenai ? "[set]" : "[not set]"}`,
      );
      console.log(
        `Gemini API: ${hasGemini ? "[set]" : "[not set]"}`,
      );
      console.log(
        `DeepSeek API: ${hasDeepseek ? "[set]" : "[not set]"}`,
      );
      console.log(
        `OpenAI Compatible API: ${hasOpenaiCompatible ? "[set]" : "[not set]"}`,
      );
    }
  });

program.parse();
