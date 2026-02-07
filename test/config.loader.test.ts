import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { ConfigSchema } from "../src/config/schema.ts";
import { loadConfig, saveConfig } from "../src/config/loader.ts";

describe("config/loader", () => {
  let tempRoot: string;

  beforeEach(() => {
    tempRoot = join(tmpdir(), `nanobot-config-${Date.now()}`);
    mkdirSync(tempRoot, { recursive: true });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(tempRoot, { recursive: true, force: true });
  });

  it("loads config from file", () => {
    const path = join(tempRoot, "config.json");
    writeFileSync(path, JSON.stringify({ gateway: { port: 1234 } }));
    const cfg = loadConfig(path);
    expect(cfg.gateway.port).toBe(1234);
  });

  it("falls back to defaults when file is invalid", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const path = join(tempRoot, "config.json");
    writeFileSync(path, "{ invalid json");
    const cfg = loadConfig(path);
    const defaults = ConfigSchema.parse({});
    expect(cfg.gateway.port).toBe(defaults.gateway.port);
    expect(warnSpy).toHaveBeenCalled();
  });

  it("saves config to file", () => {
    const path = join(tempRoot, "config.json");
    const cfg = ConfigSchema.parse({ gateway: { port: 9000 } });
    saveConfig(cfg, path);
    const raw = readFileSync(path, "utf-8");
    const parsed = JSON.parse(raw);
    expect(parsed.gateway.port).toBe(9000);
  });
});
