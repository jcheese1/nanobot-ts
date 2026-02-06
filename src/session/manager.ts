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

/** A conversation message. */
export interface SessionMessage {
  role: string;
  content: string;
  timestamp: string;
  [key: string]: unknown;
}

/** A conversation session. */
export class Session {
  key: string;
  messages: SessionMessage[];
  createdAt: Date;
  updatedAt: Date;
  metadata: Record<string, unknown>;

  constructor(params: {
    key: string;
    messages?: SessionMessage[];
    createdAt?: Date;
    updatedAt?: Date;
    metadata?: Record<string, unknown>;
  }) {
    this.key = params.key;
    this.messages = params.messages ?? [];
    this.createdAt = params.createdAt ?? new Date();
    this.updatedAt = params.updatedAt ?? new Date();
    this.metadata = params.metadata ?? {};
  }

  /** Add a message to the session. */
  addMessage(role: string, content: string, extra?: Record<string, unknown>): void {
    this.messages.push({
      role,
      content,
      timestamp: new Date().toISOString(),
      ...extra,
    });
    this.updatedAt = new Date();
  }

  /** Get message history for LLM context. */
  getHistory(maxMessages = 50): Array<{ role: string; content: string }> {
    const recent =
      this.messages.length > maxMessages
        ? this.messages.slice(-maxMessages)
        : this.messages;
    return recent.map((m) => ({ role: m.role, content: m.content }));
  }

  /** Clear all messages. */
  clear(): void {
    this.messages = [];
    this.updatedAt = new Date();
  }
}

/** Manages conversation sessions stored as JSONL files. */
export class SessionManager {
  private sessionsDir: string;
  private cache = new Map<string, Session>();

  constructor(workspace: string) {
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
      const messages: SessionMessage[] = [];
      let metadata: Record<string, unknown> = {};
      let createdAt: Date | undefined;

      for (const line of lines) {
        const data = JSON.parse(line);
        if (data._type === "metadata") {
          metadata = data.metadata ?? {};
          createdAt = data.created_at
            ? new Date(data.created_at)
            : undefined;
        } else {
          messages.push(data as SessionMessage);
        }
      }

      return new Session({
        key,
        messages,
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

    // Metadata line first
    lines.push(
      JSON.stringify({
        _type: "metadata",
        created_at: session.createdAt.toISOString(),
        updated_at: session.updatedAt.toISOString(),
        metadata: session.metadata,
      }),
    );

    // Message lines
    for (const msg of session.messages) {
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
