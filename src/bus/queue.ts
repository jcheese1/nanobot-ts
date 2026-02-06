import type { InboundMessage, OutboundMessage } from "./events.js";

/**
 * Simple async queue. Mimics Python's asyncio.Queue.
 */
class AsyncQueue<T> {
  private queue: T[] = [];
  private waiters: Array<(value: T) => void> = [];

  async put(item: T): Promise<void> {
    const waiter = this.waiters.shift();
    if (waiter) {
      waiter(item);
    } else {
      this.queue.push(item);
    }
  }

  async get(): Promise<T> {
    const item = this.queue.shift();
    if (item !== undefined) {
      return item;
    }
    return new Promise<T>((resolve) => {
      this.waiters.push(resolve);
    });
  }

  get size(): number {
    return this.queue.length;
  }
}

type OutboundCallback = (msg: OutboundMessage) => Promise<void>;

/**
 * Async message bus that decouples chat channels from the agent core.
 *
 * Channels push messages to the inbound queue, and the agent processes
 * them and pushes responses to the outbound queue.
 */
export class MessageBus {
  readonly inbound = new AsyncQueue<InboundMessage>();
  readonly outbound = new AsyncQueue<OutboundMessage>();
  private outboundSubscribers = new Map<string, OutboundCallback[]>();
  private _running = false;

  async publishInbound(msg: InboundMessage): Promise<void> {
    await this.inbound.put(msg);
  }

  async consumeInbound(): Promise<InboundMessage> {
    return this.inbound.get();
  }

  async publishOutbound(msg: OutboundMessage): Promise<void> {
    await this.outbound.put(msg);
  }

  async consumeOutbound(): Promise<OutboundMessage> {
    return this.outbound.get();
  }

  subscribeOutbound(channel: string, callback: OutboundCallback): void {
    const subs = this.outboundSubscribers.get(channel) ?? [];
    subs.push(callback);
    this.outboundSubscribers.set(channel, subs);
  }

  async dispatchOutbound(): Promise<void> {
    this._running = true;
    while (this._running) {
      try {
        const msg = await withTimeout(this.outbound.get(), 1000);
        const subscribers = this.outboundSubscribers.get(msg.channel) ?? [];
        for (const callback of subscribers) {
          try {
            await callback(msg);
          } catch (err) {
            console.error(`Error dispatching to ${msg.channel}:`, err);
          }
        }
      } catch {
        // timeout, continue loop
      }
    }
  }

  stop(): void {
    this._running = false;
  }

  get inboundSize(): number {
    return this.inbound.size;
  }

  get outboundSize(): number {
    return this.outbound.size;
  }
}

/** Promise.race with a timeout. Rejects on timeout. */
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
