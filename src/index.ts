export const VERSION = "0.1.4";
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
