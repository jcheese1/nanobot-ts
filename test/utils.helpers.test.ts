import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

async function importHelpers(home: string) {
  vi.resetModules();
  vi.doMock("node:os", () => ({ homedir: () => home }));
  return await import("../src/utils/helpers.ts");
}

describe("utils/helpers", () => {
  let tempRoot: string;
  let tempHome: string;

  beforeEach(() => {
    tempRoot = join(tmpdir(), `nanobot-helpers-${Date.now()}`);
    mkdirSync(tempRoot, { recursive: true });
    tempHome = join(tempRoot, "home");
    mkdirSync(tempHome, { recursive: true });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(tempRoot, { recursive: true, force: true });
  });

  it("ensureDir creates missing directories", async () => {
    const { ensureDir } = await importHelpers(tempHome);
    const target = join(tempRoot, "a", "b", "c");
    expect(existsSync(target)).toBe(false);
    const result = ensureDir(target);
    expect(result).toBe(target);
    expect(existsSync(target)).toBe(true);
  });

  it("getWorkspacePath expands ~ and ensures directory", async () => {
    const { getWorkspacePath } = await importHelpers(tempHome);
    const ws = getWorkspacePath("~/ws");
    expect(ws).toBe(join(tempHome, "ws"));
    expect(existsSync(ws)).toBe(true);
  });

  it("getWorkspacePath defaults to ~/.nanobot/workspace", async () => {
    const { getWorkspacePath } = await importHelpers(tempHome);
    const ws = getWorkspacePath();
    expect(ws).toBe(join(tempHome, ".nanobot", "workspace"));
    expect(existsSync(ws)).toBe(true);
  });

  it("safeFilename replaces unsafe characters and trims", async () => {
    const { safeFilename } = await importHelpers(tempHome);
    expect(safeFilename('  bad<>:"/\\\\|?*  ')).toBe("bad__________");
  });

  it("truncateString shortens with suffix", async () => {
    const { truncateString } = await importHelpers(tempHome);
    expect(truncateString("hello", 10)).toBe("hello");
    expect(truncateString("hello world", 8)).toBe("hello...");
  });

  it("parseSessionKey splits channel and chat id", async () => {
    const { parseSessionKey } = await importHelpers(tempHome);
    expect(parseSessionKey("telegram:123")).toEqual(["telegram", "123"]);
    expect(() => parseSessionKey("badkey")).toThrow("Invalid session key");
  });

  it("todayDate and timestamp return ISO-like formats", async () => {
    const { todayDate, timestamp } = await importHelpers(tempHome);
    expect(todayDate()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(timestamp()).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});
