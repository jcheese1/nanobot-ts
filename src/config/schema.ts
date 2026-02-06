import { z } from "zod";
import { homedir } from "node:os";

export const TelegramConfigSchema = z.object({
  enabled: z.boolean().default(false),
  token: z.string().default(""),
  allowFrom: z.array(z.string()).default([]),
  proxy: z.string().nullish(),
});
export type TelegramConfig = z.infer<typeof TelegramConfigSchema>;

export const ChannelsConfigSchema = z.object({
  telegram: TelegramConfigSchema.default({
    enabled: false,
    token: "",
    allowFrom: [],
  }),
});
export type ChannelsConfig = z.infer<typeof ChannelsConfigSchema>;

export const AgentDefaultsSchema = z.object({
  workspace: z.string().default("~/.nanobot/workspace"),
  model: z.string().default("anthropic/claude-sonnet-4-20250514"),
  maxTokens: z.number().default(8192),
  temperature: z.number().default(0.7),
  maxToolIterations: z.number().default(20),
});
export type AgentDefaults = z.infer<typeof AgentDefaultsSchema>;

export const AgentsConfigSchema = z.object({
  defaults: AgentDefaultsSchema.default({
    workspace: "~/.nanobot/workspace",
    model: "anthropic/claude-sonnet-4-20250514",
    maxTokens: 8192,
    temperature: 0.7,
    maxToolIterations: 20,
  }),
});
export type AgentsConfig = z.infer<typeof AgentsConfigSchema>;

export const ProviderConfigSchema = z.object({
  apiKey: z.string().default(""),
  apiBase: z.string().nullish(),
});
export type ProviderConfig = z.infer<typeof ProviderConfigSchema>;

const defaultProvider = { apiKey: "" } as const;

export const ProvidersConfigSchema = z.object({
  anthropic: ProviderConfigSchema.default(defaultProvider),
  openai: ProviderConfigSchema.default(defaultProvider),
  openrouter: ProviderConfigSchema.default(defaultProvider),
  deepseek: ProviderConfigSchema.default(defaultProvider),
  groq: ProviderConfigSchema.default(defaultProvider),
  gemini: ProviderConfigSchema.default(defaultProvider),
  openaiCompatible: ProviderConfigSchema.default(defaultProvider),
});
export type ProvidersConfig = z.infer<typeof ProvidersConfigSchema>;

export const GatewayConfigSchema = z.object({
  host: z.string().default("0.0.0.0"),
  port: z.number().default(18790),
});
export type GatewayConfig = z.infer<typeof GatewayConfigSchema>;

export const WebSearchConfigSchema = z.object({
  apiKey: z.string().default(""),
  maxResults: z.number().default(5),
});

export const WebToolsConfigSchema = z.object({
  search: WebSearchConfigSchema.default({ apiKey: "", maxResults: 5 }),
});

export const ExecToolConfigSchema = z.object({
  timeout: z.number().default(60),
  restrictToWorkspace: z.boolean().default(false),
});
export type ExecToolConfig = z.infer<typeof ExecToolConfigSchema>;

export const ToolsConfigSchema = z.object({
  web: WebToolsConfigSchema.default({
    search: { apiKey: "", maxResults: 5 },
  }),
  exec: ExecToolConfigSchema.default({
    timeout: 60,
    restrictToWorkspace: false,
  }),
});

export const ConfigSchema = z.object({
  agents: AgentsConfigSchema.default({
    defaults: {
      workspace: "~/.nanobot/workspace",
      model: "anthropic/claude-sonnet-4-20250514",
      maxTokens: 8192,
      temperature: 0.7,
      maxToolIterations: 20,
    },
  }),
  channels: ChannelsConfigSchema.default({
    telegram: { enabled: false, token: "", allowFrom: [] },
  }),
  providers: ProvidersConfigSchema.default({
    anthropic: defaultProvider,
    openai: defaultProvider,
    openrouter: defaultProvider,
    deepseek: defaultProvider,
    groq: defaultProvider,
    gemini: defaultProvider,
    openaiCompatible: defaultProvider,
  }),
  gateway: GatewayConfigSchema.default({ host: "0.0.0.0", port: 18790 }),
  tools: ToolsConfigSchema.default({
    web: { search: { apiKey: "", maxResults: 5 } },
    exec: { timeout: 60, restrictToWorkspace: false },
  }),
});
export type Config = z.infer<typeof ConfigSchema>;

/** Get expanded workspace path. */
export function getConfigWorkspacePath(config: Config): string {
  const ws = config.agents.defaults.workspace;
  if (ws.startsWith("~")) {
    return ws.replace(/^~/, homedir());
  }
  return ws;
}

/** Get API key in priority order. */
export function getApiKey(config: Config): string | null {
  return (
    config.providers.openrouter.apiKey ||
    config.providers.deepseek.apiKey ||
    config.providers.anthropic.apiKey ||
    config.providers.openai.apiKey ||
    config.providers.gemini.apiKey ||
    config.providers.groq.apiKey ||
    config.providers.openaiCompatible.apiKey ||
    null
  );
}

/** Get API base URL if using OpenRouter. */
export function getApiBase(config: Config): string | null {
  if (config.providers.openrouter.apiKey) {
    return (
      config.providers.openrouter.apiBase ?? "https://openrouter.ai/api/v1"
    );
  }
  if (config.providers.openaiCompatible.apiKey) {
    return config.providers.openaiCompatible.apiBase ?? null;
  }
  return null;
}
