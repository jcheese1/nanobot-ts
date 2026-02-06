import type { OutboundMessage } from "../../bus/events.js";
import { Tool } from "./base.js";

type SendCallback = (msg: OutboundMessage) => Promise<void>;

/** Tool to send messages to users on chat channels. */
export class MessageTool extends Tool {
  readonly name = "message";
  readonly description =
    "Send a message to the user. Use this when you want to communicate something.";
  readonly parameters = {
    type: "object",
    properties: {
      content: {
        type: "string",
        description: "The message content to send",
      },
      channel: {
        type: "string",
        description: "Optional: target channel (telegram, etc.)",
      },
      chat_id: {
        type: "string",
        description: "Optional: target chat/user ID",
      },
    },
    required: ["content"],
  };

  private sendCallback: SendCallback | null;
  private defaultChannel: string;
  private defaultChatId: string;

  constructor(params?: {
    sendCallback?: SendCallback;
    defaultChannel?: string;
    defaultChatId?: string;
  }) {
    super();
    this.sendCallback = params?.sendCallback ?? null;
    this.defaultChannel = params?.defaultChannel ?? "";
    this.defaultChatId = params?.defaultChatId ?? "";
  }

  /** Set the current message context. */
  setContext(channel: string, chatId: string): void {
    this.defaultChannel = channel;
    this.defaultChatId = chatId;
  }

  /** Set the callback for sending messages. */
  setSendCallback(callback: SendCallback): void {
    this.sendCallback = callback;
  }

  async execute(args: Record<string, unknown>): Promise<string> {
    const content = String(args.content);
    const channel = args.channel
      ? String(args.channel)
      : this.defaultChannel;
    const chatId = args.chat_id ? String(args.chat_id) : this.defaultChatId;

    if (!channel || !chatId) {
      return "Error: No target channel/chat specified";
    }
    if (!this.sendCallback) {
      return "Error: Message sending not configured";
    }

    const msg: OutboundMessage = {
      channel,
      chatId,
      content,
      media: [],
      metadata: {},
    };

    try {
      await this.sendCallback(msg);
      return `Message sent to ${channel}:${chatId}`;
    } catch (err) {
      return `Error sending message: ${err instanceof Error ? err.message : err}`;
    }
  }
}
