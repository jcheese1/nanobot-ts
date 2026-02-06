import type { OutboundMessage, InboundMessage } from "../bus/events.js";
import { createInboundMessage } from "../bus/events.js";
import type { MessageBus } from "../bus/queue.js";

/**
 * Abstract base class for chat channel implementations.
 */
export abstract class BaseChannel {
  abstract readonly name: string;
  protected config: unknown;
  protected bus: MessageBus;
  protected _running = false;

  constructor(config: unknown, bus: MessageBus) {
    this.config = config;
    this.bus = bus;
  }

  abstract start(): Promise<void>;
  abstract stop(): Promise<void>;
  abstract send(msg: OutboundMessage): Promise<void>;

  /** Check if a sender is allowed to use this bot. */
  isAllowed(senderId: string): boolean {
    const allowList = (this.config as { allowFrom?: string[] })?.allowFrom ?? [];
    if (allowList.length === 0) return true;

    const senderStr = String(senderId);
    if (allowList.includes(senderStr)) return true;

    // Check pipe-separated IDs (e.g., "123456|username")
    if (senderStr.includes("|")) {
      for (const part of senderStr.split("|")) {
        if (part && allowList.includes(part)) return true;
      }
    }
    return false;
  }

  /** Handle an incoming message from the chat platform. */
  protected async handleMessage(params: {
    senderId: string;
    chatId: string;
    content: string;
    media?: string[];
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    if (!this.isAllowed(params.senderId)) return;

    const msg = createInboundMessage({
      channel: this.name,
      senderId: String(params.senderId),
      chatId: String(params.chatId),
      content: params.content,
      media: params.media ?? [],
      metadata: params.metadata ?? {},
    });

    await this.bus.publishInbound(msg);
  }

  get isRunning(): boolean {
    return this._running;
  }
}
