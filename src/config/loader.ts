import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { ConfigSchema, type Config } from "./schema.js";

/** Get the default configuration file path. */
export function getConfigPath(): string {
  return join(homedir(), ".nanobot", "config.json");
}

/** Get the nanobot data directory. */
export function getDataDir(): string {
  const dir = join(homedir(), ".nanobot");
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return dir;
}

/** Load configuration from file or create default. */
export function loadConfig(configPath?: string): Config {
  const path = configPath ?? getConfigPath();

  if (existsSync(path)) {
    try {
      const raw = readFileSync(path, "utf-8");
      const data = JSON.parse(raw);
      return ConfigSchema.parse(data);
    } catch (err) {
      console.warn(`Warning: Failed to load config from ${path}: ${err}`);
      console.warn("Using default configuration.");
    }
  }

  return ConfigSchema.parse({});
}

/** Save configuration to file. */
export function saveConfig(config: Config, configPath?: string): void {
  const path = configPath ?? getConfigPath();
  const dir = dirname(path);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(path, JSON.stringify(config, null, 2));
}
