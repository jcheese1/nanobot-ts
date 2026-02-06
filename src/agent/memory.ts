import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { ensureDir, todayDate } from "../utils/helpers.js";

/**
 * Memory system for the agent.
 * Supports daily notes (memory/YYYY-MM-DD.md) and long-term memory (MEMORY.md).
 */
export class MemoryStore {
  private workspace: string;
  private memoryDir: string;
  private memoryFile: string;

  constructor(workspace: string) {
    this.workspace = workspace;
    this.memoryDir = ensureDir(join(workspace, "memory"));
    this.memoryFile = join(this.memoryDir, "MEMORY.md");
  }

  /** Get path to today's memory file. */
  getTodayFile(): string {
    return join(this.memoryDir, `${todayDate()}.md`);
  }

  /** Read today's memory notes. */
  readToday(): string {
    const todayFile = this.getTodayFile();
    if (existsSync(todayFile)) {
      return readFileSync(todayFile, "utf-8");
    }
    return "";
  }

  /** Append content to today's memory notes. */
  appendToday(content: string): void {
    const todayFile = this.getTodayFile();
    let finalContent: string;

    if (existsSync(todayFile)) {
      const existing = readFileSync(todayFile, "utf-8");
      finalContent = existing + "\n" + content;
    } else {
      finalContent = `# ${todayDate()}\n\n${content}`;
    }

    writeFileSync(todayFile, finalContent, "utf-8");
  }

  /** Read long-term memory (MEMORY.md). */
  readLongTerm(): string {
    if (existsSync(this.memoryFile)) {
      return readFileSync(this.memoryFile, "utf-8");
    }
    return "";
  }

  /** Write to long-term memory (MEMORY.md). */
  writeLongTerm(content: string): void {
    writeFileSync(this.memoryFile, content, "utf-8");
  }

  /** Get memories from the last N days. */
  getRecentMemories(days = 7): string {
    const memories: string[] = [];
    const today = new Date();

    for (let i = 0; i < days; i++) {
      const date = new Date(today);
      date.setDate(date.getDate() - i);
      const dateStr = date.toISOString().slice(0, 10);
      const filePath = join(this.memoryDir, `${dateStr}.md`);

      if (existsSync(filePath)) {
        memories.push(readFileSync(filePath, "utf-8"));
      }
    }

    return memories.join("\n\n---\n\n");
  }

  /** List all memory files sorted by date (newest first). */
  listMemoryFiles(): string[] {
    if (!existsSync(this.memoryDir)) return [];

    return readdirSync(this.memoryDir)
      .filter((f) => /^\d{4}-\d{2}-\d{2}\.md$/.test(f))
      .sort()
      .reverse()
      .map((f) => join(this.memoryDir, f));
  }

  /** Get memory context for the agent prompt. */
  getMemoryContext(): string {
    const parts: string[] = [];

    const longTerm = this.readLongTerm();
    if (longTerm) {
      parts.push("## Long-term Memory\n" + longTerm);
    }

    const today = this.readToday();
    if (today) {
      parts.push("## Today's Notes\n" + today);
    }

    return parts.join("\n\n");
  }
}
