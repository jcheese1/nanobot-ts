import { describe, it, expect } from "vitest";

import {
  ConfigSchema,
  getApiBase,
  getApiKey,
  type Config,
} from "../src/config/schema.ts";

describe("config/schema", () => {
  it("provides defaults for config", () => {
    const cfg = ConfigSchema.parse({});
    expect(cfg.agents.defaults.workspace).toBe("~/.nanobot/workspace");
    expect(cfg.gateway.port).toBe(18790);
    expect(cfg.providers.openai.apiKey).toBe("");
    expect(cfg.tools.exec.timeout).toBe(60);
  });

  it("getApiKey respects priority order", () => {
    const cfg: Config = ConfigSchema.parse({
      providers: {
        openai: { apiKey: "openai" },
        anthropic: { apiKey: "anthropic" },
        openrouter: { apiKey: "openrouter" },
        deepseek: { apiKey: "deepseek" },
      },
    });
    expect(getApiKey(cfg)).toBe("openrouter");
  });

  it("getApiBase returns OpenRouter default when configured", () => {
    const cfg: Config = ConfigSchema.parse({
      providers: { openrouter: { apiKey: "k" } },
    });
    expect(getApiBase(cfg)).toBe("https://openrouter.ai/api/v1");
  });

  it("getApiBase returns openaiCompatible apiBase when configured", () => {
    const cfg: Config = ConfigSchema.parse({
      providers: { openaiCompatible: { apiKey: "k", apiBase: "http://x" } },
    });
    expect(getApiBase(cfg)).toBe("http://x");
  });
});
