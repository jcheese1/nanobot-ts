import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const DEFAULT_HEARTBEAT_INTERVAL_S = 30 * 60; // 30 minutes

const HEARTBEAT_PROMPT = `Read HEARTBEAT.md in your workspace (if it exists).
Follow any instructions or tasks listed there.
If nothing needs attention, reply with just: HEARTBEAT_OK`;

const HEARTBEAT_OK_TOKEN = "HEARTBEAT_OK";

/** Check if HEARTBEAT.md has no actionable content. */
function isHeartbeatEmpty(content: string | null): boolean {
  if (!content) return true;

  const skipPatterns = new Set(["- [ ]", "* [ ]", "- [x]", "* [x]"]);

  for (const rawLine of content.split("\n")) {
    const line = rawLine.trim();
    if (
      !line ||
      line.startsWith("#") ||
      line.startsWith("<!--") ||
      skipPatterns.has(line)
    ) {
      continue;
    }
    return false; // Found actionable content
  }
  return true;
}

type HeartbeatCallback = (prompt: string) => Promise<string>;

/**
 * Periodic heartbeat service that wakes the agent to check for tasks.
 */
export class HeartbeatService {
  private workspace: string;
  private onHeartbeat: HeartbeatCallback | null;
  private intervalS: number;
  private enabled: boolean;
  private _running = false;
  private timerHandle: ReturnType<typeof setTimeout> | null = null;

  constructor(params: {
    workspace: string;
    onHeartbeat?: HeartbeatCallback;
    intervalS?: number;
    enabled?: boolean;
  }) {
    this.workspace = params.workspace;
    this.onHeartbeat = params.onHeartbeat ?? null;
    this.intervalS = params.intervalS ?? DEFAULT_HEARTBEAT_INTERVAL_S;
    this.enabled = params.enabled ?? true;
  }

  private get heartbeatFile(): string {
    return join(this.workspace, "HEARTBEAT.md");
  }

  private readHeartbeatFile(): string | null {
    if (existsSync(this.heartbeatFile)) {
      try {
        return readFileSync(this.heartbeatFile, "utf-8");
      } catch {
        return null;
      }
    }
    return null;
  }

  async start(): Promise<void> {
    if (!this.enabled) {
      console.log("Heartbeat disabled");
      return;
    }

    this._running = true;
    this.scheduleNext();
    console.log(`Heartbeat started (every ${this.intervalS}s)`);
  }

  stop(): void {
    this._running = false;
    if (this.timerHandle) {
      clearTimeout(this.timerHandle);
      this.timerHandle = null;
    }
  }

  private scheduleNext(): void {
    if (!this._running) return;
    this.timerHandle = setTimeout(async () => {
      if (this._running) {
        await this.tick();
        this.scheduleNext();
      }
    }, this.intervalS * 1000);
  }

  private async tick(): Promise<void> {
    const content = this.readHeartbeatFile();

    if (isHeartbeatEmpty(content)) {
      return;
    }

    console.log("Heartbeat: checking for tasks...");

    if (this.onHeartbeat) {
      try {
        const response = await this.onHeartbeat(HEARTBEAT_PROMPT);
        const normalized = response.toUpperCase().replace(/_/g, "");
        if (normalized.includes(HEARTBEAT_OK_TOKEN.replace(/_/g, ""))) {
          console.log("Heartbeat: OK (no action needed)");
        } else {
          console.log("Heartbeat: completed task");
        }
      } catch (err) {
        console.error("Heartbeat execution failed:", err);
      }
    }
  }

  async triggerNow(): Promise<string | null> {
    if (this.onHeartbeat) {
      return this.onHeartbeat(HEARTBEAT_PROMPT);
    }
    return null;
  }
}
