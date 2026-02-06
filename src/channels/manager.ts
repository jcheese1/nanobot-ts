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

  constructor(config: Config, bus: MessageBus) {
    this.config = config;
    this.bus = bus;
    this.initChannels();
  }

  private initChannels(): void {
    // Telegram channel
    if (this.config.channels.telegram.enabled) {
      try {
        // Dynamic import to avoid pulling grammy if not needed
        const { TelegramChannel } = require("./telegram.js") as {
          TelegramChannel: typeof import("./telegram.js").TelegramChannel;
        };
        const channel = new TelegramChannel(
          this.config.channels.telegram,
          this.bus,
          this.config.providers.groq.apiKey,
        );
        this.channels.set("telegram", channel);
        console.log("Telegram channel enabled");
      } catch (err) {
        console.warn("Telegram channel not available:", err);
      }
    }
  }

  /** Start all channels and the outbound dispatcher. */
  async startAll(): Promise<void> {
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
        const msg = await withTimeout(this.bus.consumeOutbound(), 1000);
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
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), ms);
    promise.then(
      (val) => {
        clearTimeout(timer);
        resolve(val);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}
