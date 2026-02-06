import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

function readVersion(): string {
  try {
    // Works from both src/ (dev) and dist/ (built)
    for (const rel of ["../package.json", "../../package.json"]) {
      try {
        const pkg = JSON.parse(readFileSync(join(__dirname, rel), "utf-8"));
        if (pkg.version) return pkg.version;
      } catch { /* try next */ }
    }
  } catch { /* fallback */ }
  return "0.0.0";
}

export const VERSION = readVersion();
export const LOGO = "\u{1F408}";

// Core exports
export { AgentLoop } from "./agent/loop.js";
export { ContextBuilder } from "./agent/context.js";
export { MemoryStore } from "./agent/memory.js";
export { SkillsLoader } from "./agent/skills.js";
export { SubagentManager } from "./agent/subagent.js";

// Bus
export { MessageBus } from "./bus/queue.js";
export type { InboundMessage, OutboundMessage } from "./bus/events.js";

// Config
export { loadConfig, saveConfig } from "./config/loader.js";
export type { Config } from "./config/schema.js";

// Providers
export { OpenAIProvider } from "./providers/openai-provider.js";
export type { LLMProvider, LLMResponse, ToolCallRequest } from "./providers/base.js";

// Channels
export { TelegramChannel } from "./channels/telegram.js";
export { ChannelManager } from "./channels/manager.js";

// Services
export { CronService } from "./cron/service.js";
export { HeartbeatService } from "./heartbeat/service.js";
export { SessionManager } from "./session/manager.js";
