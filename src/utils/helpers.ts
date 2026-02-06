import { mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

/** Ensure a directory exists, creating it if necessary. */
export function ensureDir(dirPath: string): string {
  if (!existsSync(dirPath)) {
    mkdirSync(dirPath, { recursive: true });
  }
  return dirPath;
}

/** Get the nanobot data directory (~/.nanobot). */
export function getDataPath(): string {
  return ensureDir(join(homedir(), ".nanobot"));
}

/** Get the workspace path. Defaults to ~/.nanobot/workspace. */
export function getWorkspacePath(workspace?: string): string {
  const resolved = workspace
    ? workspace.replace(/^~/, homedir())
    : join(homedir(), ".nanobot", "workspace");
  return ensureDir(resolved);
}

/** Get the sessions storage directory. */
export function getSessionsPath(): string {
  return ensureDir(join(getDataPath(), "sessions"));
}

/** Get the memory directory within the workspace. */
export function getMemoryPath(workspace?: string): string {
  const ws = workspace ?? getWorkspacePath();
  return ensureDir(join(ws, "memory"));
}

/** Get the skills directory within the workspace. */
export function getSkillsPath(workspace?: string): string {
  const ws = workspace ?? getWorkspacePath();
  return ensureDir(join(ws, "skills"));
}

/** Get today's date in YYYY-MM-DD format. */
export function todayDate(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Get current timestamp in ISO format. */
export function timestamp(): string {
  return new Date().toISOString();
}

/** Truncate a string to max length, adding suffix if truncated. */
export function truncateString(
  s: string,
  maxLen = 100,
  suffix = "...",
): string {
  if (s.length <= maxLen) return s;
  return s.slice(0, maxLen - suffix.length) + suffix;
}

/** Convert a string to a safe filename. */
export function safeFilename(name: string): string {
  const unsafe = '<>:"/\\|?*';
  let result = name;
  for (const char of unsafe) {
    result = result.replaceAll(char, "_");
  }
  return result.trim();
}

/** Parse a session key into channel and chat_id. */
export function parseSessionKey(key: string): [string, string] {
  const idx = key.indexOf(":");
  if (idx === -1) {
    throw new Error(`Invalid session key: ${key}`);
  }
  return [key.slice(0, idx), key.slice(idx + 1)];
}
