/** Message received from a chat channel. */
export interface InboundMessage {
  channel: string; // telegram, discord, etc.
  senderId: string; // User identifier
  chatId: string; // Chat/channel identifier
  content: string; // Message text
  timestamp: Date;
  media: string[]; // Media file paths
  metadata: Record<string, unknown>; // Channel-specific data
}

/** Message to send to a chat channel. */
export interface OutboundMessage {
  channel: string;
  chatId: string;
  content: string;
  replyTo?: string;
  media: string[];
  metadata: Record<string, unknown>;
}

/** Create an InboundMessage with defaults. */
export function createInboundMessage(
  partial: Pick<InboundMessage, "channel" | "senderId" | "chatId" | "content"> &
    Partial<InboundMessage>,
): InboundMessage {
  return {
    timestamp: new Date(),
    media: [],
    metadata: {},
    ...partial,
  };
}

/** Create an OutboundMessage with defaults. */
export function createOutboundMessage(
  partial: Pick<OutboundMessage, "channel" | "chatId" | "content"> &
    Partial<OutboundMessage>,
): OutboundMessage {
  return {
    media: [],
    metadata: {},
    ...partial,
  };
}

/** Get session key from an inbound message. */
export function getSessionKey(msg: InboundMessage): string {
  return `${msg.channel}:${msg.chatId}`;
}
