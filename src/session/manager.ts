import {
  readFileSync,
  writeFileSync,
  existsSync,
  readdirSync,
  unlinkSync,
} from "node:fs";
import { join } from "node:path";
import { ensureDir, safeFilename } from "../utils/helpers.js";
import { homedir } from "node:os";
import type { ChatMessage } from "../providers/base.js";

/** A conversation message (legacy simple format, kept for JSONL compat). */
export interface SessionMessage {
  role: string;
  content: string;
  timestamp: string;
  [key: string]: unknown;
}

/** A conversation session. */
export class Session {
  key: string;
  /** Rich message history preserving tool_calls, tool results, etc. */
  history: ChatMessage[];
  createdAt: Date;
  updatedAt: Date;
  metadata: Record<string, unknown>;

  constructor(params: {
    key: string;
    history?: ChatMessage[];
    createdAt?: Date;
    updatedAt?: Date;
    metadata?: Record<string, unknown>;
  }) {
    this.key = params.key;
    this.history = params.history ?? [];
    this.createdAt = params.createdAt ?? new Date();
    this.updatedAt = params.updatedAt ?? new Date();
    this.metadata = params.metadata ?? {};
  }

  /** Append full ChatMessage entries from an agent loop turn (excluding system prompt). */
  addTurnMessages(messages: ChatMessage[]): void {
    for (const msg of messages) {
      // Skip system messages — those are rebuilt each turn
      if (msg.role === "system") continue;
      this.history.push(msg);
    }
    this.updatedAt = new Date();
  }

  /** Get the full rich history for replaying into the LLM. */
  getHistory(maxMessages = 200): ChatMessage[] {
    if (this.history.length <= maxMessages) return this.history;
    // Trim from the front, but be careful not to cut in the middle of a
    // tool-call / tool-result pair.  Simple approach: walk forward from the
    // trim point until we land on a 'user' message.
    let start = this.history.length - maxMessages;
    while (start < this.history.length && this.history[start].role !== "user") {
      start++;
    }
    return this.history.slice(start);
  }

  /** Clear all messages. */
  clear(): void {
    this.history = [];
    this.updatedAt = new Date();
  }
}

/** Manages conversation sessions stored as JSONL files. */
export class SessionManager {
  private sessionsDir: string;
  private cache = new Map<string, Session>();

  constructor(_workspace: string) {
    this.sessionsDir = ensureDir(join(homedir(), ".nanobot", "sessions"));
  }

  private getSessionPath(key: string): string {
    const safeKey = safeFilename(key.replace(/:/g, "_"));
    return join(this.sessionsDir, `${safeKey}.jsonl`);
  }

  /** Get an existing session or create a new one. */
  getOrCreate(key: string): Session {
    const cached = this.cache.get(key);
    if (cached) return cached;

    const loaded = this.load(key);
    if (loaded) {
      this.cache.set(key, loaded);
      return loaded;
    }

    const session = new Session({ key });
    this.cache.set(key, session);
    return session;
  }

  private load(key: string): Session | null {
    const path = this.getSessionPath(key);
    if (!existsSync(path)) return null;

    try {
      const raw = readFileSync(path, "utf-8");
      const lines = raw.split("\n").filter((l) => l.trim());
      const history: ChatMessage[] = [];
      let metadata: Record<string, unknown> = {};
      let createdAt: Date | undefined;
      let isRichFormat = false;

      for (const line of lines) {
        const data = JSON.parse(line);
        if (data._type === "metadata") {
          metadata = data.metadata ?? {};
          createdAt = data.created_at
            ? new Date(data.created_at)
            : undefined;
          isRichFormat = data._format === "rich";
        } else if (isRichFormat) {
          // Rich format: data is a full ChatMessage
          history.push(data as ChatMessage);
        } else {
          // Legacy format: simple {role, content, timestamp} entries.
          // Convert to ChatMessage, skipping the timestamp field.
          history.push({
            role: data.role as ChatMessage["role"],
            content: data.content ?? "",
          });
        }
      }

      return new Session({
        key,
        history,
        createdAt: createdAt ?? new Date(),
        metadata,
      });
    } catch (err) {
      console.warn(`Failed to load session ${key}:`, err);
      return null;
    }
  }

  /** Save a session to disk. */
  save(session: Session): void {
    const path = this.getSessionPath(session.key);
    const lines: string[] = [];

    // Metadata line first (mark as rich format)
    lines.push(
      JSON.stringify({
        _type: "metadata",
        _format: "rich",
        created_at: session.createdAt.toISOString(),
        updated_at: session.updatedAt.toISOString(),
        metadata: session.metadata,
      }),
    );

    // Message lines — full ChatMessage objects
    for (const msg of session.history) {
      lines.push(JSON.stringify(msg));
    }

    writeFileSync(path, lines.join("\n") + "\n");
    this.cache.set(session.key, session);
  }

  /** Delete a session. */
  delete(key: string): boolean {
    this.cache.delete(key);
    const path = this.getSessionPath(key);
    if (existsSync(path)) {
      unlinkSync(path);
      return true;
    }
    return false;
  }

  /** List all sessions. */
  listSessions(): Array<{
    key: string;
    createdAt?: string;
    updatedAt?: string;
    path: string;
  }> {
    const results: Array<{
      key: string;
      createdAt?: string;
      updatedAt?: string;
      path: string;
    }> = [];

    if (!existsSync(this.sessionsDir)) return results;

    for (const file of readdirSync(this.sessionsDir)) {
      if (!file.endsWith(".jsonl")) continue;
      const filePath = join(this.sessionsDir, file);
      try {
        const raw = readFileSync(filePath, "utf-8");
        const firstLine = raw.split("\n")[0]?.trim();
        if (firstLine) {
          const data = JSON.parse(firstLine);
          if (data._type === "metadata") {
            results.push({
              key: file.replace(".jsonl", "").replace(/_/g, ":"),
              createdAt: data.created_at,
              updatedAt: data.updated_at,
              path: filePath,
            });
          }
        }
      } catch {
        // skip invalid files
      }
    }

    return results.sort(
      (a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""),
    );
  }
}
