import { Bot, type Context } from "grammy";
import { mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { OutboundMessage } from "../bus/events.js";
import type { MessageBus } from "../bus/queue.js";
import { BaseChannel } from "./base.js";
import type { TelegramConfig } from "../config/schema.js";

/** Convert markdown to Telegram-safe HTML. */
function markdownToTelegramHtml(text: string): string {
  if (!text) return "";

  // 1. Extract and protect code blocks
  const codeBlocks: string[] = [];
  let result = text.replace(/```[\w]*\n?([\s\S]*?)```/g, (_m, code) => {
    codeBlocks.push(code);
    return `\x00CB${codeBlocks.length - 1}\x00`;
  });

  // 2. Extract and protect inline code
  const inlineCodes: string[] = [];
  result = result.replace(/`([^`]+)`/g, (_m, code) => {
    inlineCodes.push(code);
    return `\x00IC${inlineCodes.length - 1}\x00`;
  });

  // 3. Headers -> plain text
  result = result.replace(/^#{1,6}\s+(.+)$/gm, "$1");

  // 4. Blockquotes -> plain text
  result = result.replace(/^>\s*(.*)$/gm, "$1");

  // 5. Escape HTML
  result = result
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  // 6. Links
  result = result.replace(
    /\[([^\]]+)\]\(([^)]+)\)/g,
    '<a href="$2">$1</a>',
  );

  // 7. Bold
  result = result.replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");
  result = result.replace(/__(.+?)__/g, "<b>$1</b>");

  // 8. Italic
  result = result.replace(
    /(?<![a-zA-Z0-9])_([^_]+)_(?![a-zA-Z0-9])/g,
    "<i>$1</i>",
  );

  // 9. Strikethrough
  result = result.replace(/~~(.+?)~~/g, "<s>$1</s>");

  // 10. Bullet lists
  result = result.replace(/^[-*]\s+/gm, "\u2022 ");

  // 11. Restore inline code
  for (let i = 0; i < inlineCodes.length; i++) {
    const escaped = inlineCodes[i]
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
    result = result.replace(
      `\x00IC${i}\x00`,
      `<code>${escaped}</code>`,
    );
  }

  // 12. Restore code blocks
  for (let i = 0; i < codeBlocks.length; i++) {
    const escaped = codeBlocks[i]
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
    result = result.replace(
      `\x00CB${i}\x00`,
      `<pre><code>${escaped}</code></pre>`,
    );
  }

  return result;
}

/**
 * Telegram channel using grammY (long polling).
 */
export class TelegramChannel extends BaseChannel {
  readonly name = "telegram";
  private bot: Bot | null = null;
  private telegramConfig: TelegramConfig;
  private groqApiKey: string;

  constructor(config: TelegramConfig, bus: MessageBus, groqApiKey = "") {
    super(config, bus);
    this.telegramConfig = config;
    this.groqApiKey = groqApiKey;
  }

  async start(): Promise<void> {
    if (!this.telegramConfig.token) {
      console.error("Telegram bot token not configured");
      return;
    }

    this._running = true;
    this.bot = new Bot(this.telegramConfig.token);

    // Handle /start command
    this.bot.command("start", async (ctx) => {
      const user = ctx.from;
      await ctx.reply(
        `Hi ${user?.first_name ?? "there"}! I'm nanobot.\n\nSend me a message and I'll respond!`,
      );
    });

    // Handle text messages
    this.bot.on("message:text", async (ctx) => {
      await this.onMessage(ctx);
    });

    // Handle photos
    this.bot.on("message:photo", async (ctx) => {
      await this.onMessage(ctx);
    });

    // Handle voice
    this.bot.on("message:voice", async (ctx) => {
      await this.onMessage(ctx);
    });

    // Handle documents
    this.bot.on("message:document", async (ctx) => {
      await this.onMessage(ctx);
    });

    console.log("Starting Telegram bot (polling mode)...");

    const me = await this.bot.api.getMe();
    console.log(`Telegram bot @${me.username} connected`);

    // Start polling (this blocks until stopped)
    await this.bot.start({
      drop_pending_updates: true,
      allowed_updates: ["message"],
    });
  }

  async stop(): Promise<void> {
    this._running = false;
    if (this.bot) {
      console.log("Stopping Telegram bot...");
      await this.bot.stop();
      this.bot = null;
    }
  }

  async send(msg: OutboundMessage): Promise<void> {
    if (!this.bot) {
      console.warn("Telegram bot not running");
      return;
    }

    try {
      const chatId = Number(msg.chatId);
      if (isNaN(chatId)) {
        console.error(`Invalid chat_id: ${msg.chatId}`);
        return;
      }

      const htmlContent = markdownToTelegramHtml(msg.content);
      try {
        await this.bot.api.sendMessage(chatId, htmlContent, {
          parse_mode: "HTML",
        });
      } catch {
        // Fallback to plain text
        console.warn("HTML parse failed, falling back to plain text");
        await this.bot.api.sendMessage(chatId, msg.content);
      }
    } catch (err) {
      console.error("Error sending Telegram message:", err);
    }
  }

  private async onMessage(ctx: Context): Promise<void> {
    const user = ctx.from;
    const message = ctx.message;
    if (!user || !message) return;

    const chatId = message.chat.id;
    let senderId = String(user.id);
    if (user.username) {
      senderId = `${senderId}|${user.username}`;
    }

    const contentParts: string[] = [];
    const mediaPaths: string[] = [];

    // Text
    if (message.text) contentParts.push(message.text);
    if (message.caption) contentParts.push(message.caption);

    // Photos
    if (message.photo && message.photo.length > 0) {
      const photo = message.photo[message.photo.length - 1];
      try {
        const file = await ctx.api.getFile(photo.file_id);
        const mediaDir = join(homedir(), ".nanobot", "media");
        if (!existsSync(mediaDir)) mkdirSync(mediaDir, { recursive: true });
        // Note: grammy doesn't have a built-in download_to_drive.
        // In WebContainer context, we just note the file_id.
        contentParts.push(`[image: telegram file ${file.file_id}]`);
      } catch (err) {
        contentParts.push("[image: download failed]");
      }
    }

    // Voice
    if (message.voice) {
      contentParts.push(`[voice: telegram file ${message.voice.file_id}]`);
    }

    // Documents
    if (message.document) {
      contentParts.push(
        `[file: ${message.document.file_name ?? message.document.file_id}]`,
      );
    }

    const content =
      contentParts.length > 0 ? contentParts.join("\n") : "[empty message]";

    await this.handleMessage({
      senderId,
      chatId: String(chatId),
      content,
      media: mediaPaths,
      metadata: {
        messageId: message.message_id,
        userId: user.id,
        username: user.username,
        firstName: user.first_name,
        isGroup: message.chat.type !== "private",
      },
    });
  }
}
