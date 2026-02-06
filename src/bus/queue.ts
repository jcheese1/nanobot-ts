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

  /**
   * Wait for an item with a timeout. On timeout, the waiter is removed
   * from the queue so it does not consume a future item.
   */
  getWithTimeout(ms: number): Promise<T> {
    const item = this.queue.shift();
    if (item !== undefined) {
      return Promise.resolve(item);
    }

    return new Promise<T>((resolve, reject) => {
      let settled = false;

      const waiter = (value: T) => {
        if (settled) {
          // Timeout already fired — put the item back so it isn't lost
          this.queue.unshift(value);
          return;
        }
        settled = true;
        clearTimeout(timer);
        resolve(value);
      };

      this.waiters.push(waiter);

      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        // Remove our waiter so it doesn't consume a future item
        const idx = this.waiters.indexOf(waiter);
        if (idx !== -1) this.waiters.splice(idx, 1);
        reject(new Error("timeout"));
      }, ms);
    });
  }

  get size(): number {
    return this.queue.length;
  }
}

/**
 * Async message bus that decouples chat channels from the agent core.
 *
 * Channels push messages to the inbound queue, and the agent processes
 * them and pushes responses to the outbound queue.
 */
export class MessageBus {
  readonly inbound = new AsyncQueue<InboundMessage>();
  readonly outbound = new AsyncQueue<OutboundMessage>();

  async publishInbound(msg: InboundMessage): Promise<void> {
    await this.inbound.put(msg);
  }

  async consumeInbound(): Promise<InboundMessage> {
    return this.inbound.get();
  }

  /** Consume with timeout — safely removes the waiter on timeout so no messages are lost. */
  consumeInboundTimeout(ms: number): Promise<InboundMessage> {
    return this.inbound.getWithTimeout(ms);
  }

  async publishOutbound(msg: OutboundMessage): Promise<void> {
    await this.outbound.put(msg);
  }

  async consumeOutbound(): Promise<OutboundMessage> {
    return this.outbound.get();
  }

  /** Consume with timeout — safely removes the waiter on timeout so no messages are lost. */
  consumeOutboundTimeout(ms: number): Promise<OutboundMessage> {
    return this.outbound.getWithTimeout(ms);
  }

  get inboundSize(): number {
    return this.inbound.size;
  }

  get outboundSize(): number {
    return this.outbound.size;
  }
}

