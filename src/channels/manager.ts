import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import type { OutboundMessage } from "../bus/events.js";
import type { MessageBus } from "../bus/queue.js";
import type { BaseChannel } from "./base.js";
import type { Config } from "../config/schema.js";

/**
 * Manages chat channels and coordinates message routing.
 */
export class ChannelManager {
  private config: Config;
  private bus: MessageBus;
  readonly channels = new Map<string, BaseChannel>();
  private dispatchAbort: AbortController | null = null;
  private knownChatsPath: string;
  private chatIdSaveTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(config: Config, bus: MessageBus) {
    this.config = config;
    this.bus = bus;
    this.knownChatsPath = join(homedir(), ".nanobot", "known_chats.json");
  }

  private async initChannels(): Promise<void> {
    // Telegram channel
    if (this.config.channels.telegram.enabled) {
      try {
        const { TelegramChannel } = await import("./telegram.js");
        const channel = new TelegramChannel(
          this.config.channels.telegram,
          this.bus,
        );
        channel.onNewChatId = () => this.scheduleSave();
        this.channels.set("telegram", channel);
        console.log("Telegram channel enabled");
      } catch (err) {
        console.warn("Telegram channel not available:", err);
      }
    }
  }

  /** Load persisted known chat IDs into channels. */
  private loadKnownChatIds(): void {
    if (!existsSync(this.knownChatsPath)) return;
    try {
      const raw = readFileSync(this.knownChatsPath, "utf-8");
      const data = JSON.parse(raw) as Record<string, string[]>;
      for (const [channelName, chatIds] of Object.entries(data)) {
        const channel = this.channels.get(channelName);
        if (channel) {
          for (const id of chatIds) channel.knownChatIds.add(id);
        }
      }
    } catch {
      // ignore corrupt file
    }
  }

  /** Save known chat IDs to disk. */
  private saveKnownChatIds(): void {
    const data: Record<string, string[]> = {};
    for (const [name, channel] of this.channels) {
      if (channel.knownChatIds.size > 0) {
        data[name] = Array.from(channel.knownChatIds);
      }
    }
    const dir = dirname(this.knownChatsPath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(this.knownChatsPath, JSON.stringify(data, null, 2));
  }

  /** Debounced save — called when new chat IDs are discovered. */
  scheduleSave(): void {
    if (this.chatIdSaveTimer) return;
    this.chatIdSaveTimer = setTimeout(() => {
      this.chatIdSaveTimer = null;
      this.saveKnownChatIds();
    }, 5000);
  }

  /** Initialize channel instances (non-blocking). Call before startAll(). */
  async init(): Promise<void> {
    await this.initChannels();
    this.loadKnownChatIds();
  }

  /** Start all channels and the outbound dispatcher (blocks until stopped). */
  async startAll(): Promise<void> {
    // Init if not already done
    if (this.channels.size === 0) {
      await this.initChannels();
    }

    if (this.channels.size === 0) {
      console.warn("No channels enabled");
      return;
    }

    // Start outbound dispatcher
    this.dispatchAbort = new AbortController();
    const dispatchPromise = this.dispatchOutbound(this.dispatchAbort.signal);

    // Start all channels
    const channelPromises: Promise<void>[] = [];
    for (const [name, channel] of this.channels) {
      console.log(`Starting ${name} channel...`);
      channelPromises.push(channel.start());
    }

    await Promise.all([dispatchPromise, ...channelPromises]);
  }

  /** Stop all channels and the dispatcher. */
  async stopAll(): Promise<void> {
    console.log("Stopping all channels...");

    if (this.chatIdSaveTimer) {
      clearTimeout(this.chatIdSaveTimer);
      this.chatIdSaveTimer = null;
    }
    // Final save of known chat IDs
    this.saveKnownChatIds();

    if (this.dispatchAbort) {
      this.dispatchAbort.abort();
      this.dispatchAbort = null;
    }

    for (const [name, channel] of this.channels) {
      try {
        await channel.stop();
        console.log(`Stopped ${name} channel`);
      } catch (err) {
        console.error(`Error stopping ${name}:`, err);
      }
    }
  }

  private async dispatchOutbound(signal: AbortSignal): Promise<void> {
    console.log("Outbound dispatcher started");

    while (!signal.aborted) {
      try {
        const msg = await this.bus.consumeOutboundTimeout(1000);
        const channel = this.channels.get(msg.channel);
        if (channel) {
          try {
            await channel.send(msg);
          } catch (err) {
            console.error(`Error sending to ${msg.channel}:`, err);
          }
        } else {
          console.warn(`Unknown channel: ${msg.channel}`);
        }
      } catch {
        // timeout, continue
      }
    }
  }

  getChannel(name: string): BaseChannel | undefined {
    return this.channels.get(name);
  }

  getStatus(): Record<string, { enabled: boolean; running: boolean }> {
    const status: Record<string, { enabled: boolean; running: boolean }> = {};
    for (const [name, channel] of this.channels) {
      status[name] = { enabled: true, running: channel.isRunning };
    }
    return status;
  }

  get enabledChannels(): string[] {
    return Array.from(this.channels.keys());
  }

  /** Get known chat IDs for a channel (chats that have sent at least one message). */
  getKnownChatIds(channelName: string): string[] {
    const channel = this.channels.get(channelName);
    if (!channel) return [];
    return Array.from(channel.knownChatIds);
  }
}

