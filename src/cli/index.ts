#!/usr/bin/env node
/**
 * nanobot CLI - Personal AI Assistant
 */

import { Command } from "commander";
import { existsSync, writeFileSync, mkdirSync } from "node:fs";
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
      maxIterations: config.agents.defaults.maxToolIterations,
      braveApiKey: config.tools.web.search.apiKey || undefined,
      execConfig: config.tools.exec,
      cronService: cron,
    });

    // Wire cron callback
    cron.onJob = async (job) => {
      const response = await agent.processDirect(
        job.payload.message,
        `cron:${job.id}`,
        job.payload.channel ?? "cli",
        job.payload.to ?? "direct",
      );

      if (job.payload.deliver && job.payload.to) {
        const { createOutboundMessage } = await import(
          "../bus/events.js"
        );
        await bus.publishOutbound(
          createOutboundMessage({
            channel: job.payload.channel ?? "cli",
            chatId: job.payload.to,
            content: response ?? "",
          }),
        );
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

    // Create channel manager
    const channels = new ChannelManager(config, bus);

    if (channels.enabledChannels.length > 0) {
      console.log(
        `Channels enabled: ${channels.enabledChannels.join(", ")}`,
      );
    } else {
      console.log("Warning: No channels enabled");
    }

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

    try {
      await cron.start();
      await heartbeat.start();
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
  .action((opts) => {
    const { CronService } = require("../cron/service.js") as typeof import("../cron/service.js");

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
  .action((opts) => {
    const { CronService } = require("../cron/service.js") as typeof import("../cron/service.js");

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
  .action((jobId: string) => {
    const { CronService } = require("../cron/service.js") as typeof import("../cron/service.js");

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
  .action((jobId: string, opts: { disable: boolean }) => {
    const { CronService } = require("../cron/service.js") as typeof import("../cron/service.js");

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
