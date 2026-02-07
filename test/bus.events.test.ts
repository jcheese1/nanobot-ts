import { describe, it, expect, vi } from "vitest";

import {
  createInboundMessage,
  createOutboundMessage,
  getSessionKey,
} from "../src/bus/events.ts";

describe("bus/events", () => {
  it("creates inbound message with defaults", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2020-01-01T00:00:00.000Z"));
    const msg = createInboundMessage({
      channel: "telegram",
      senderId: "u1",
      chatId: "c1",
      content: "hi",
    });
    expect(msg.timestamp.toISOString()).toBe("2020-01-01T00:00:00.000Z");
    expect(msg.media).toEqual([]);
    expect(msg.metadata).toEqual({});
    vi.useRealTimers();
  });

  it("creates outbound message with defaults", () => {
    const msg = createOutboundMessage({
      channel: "telegram",
      chatId: "c1",
      content: "ok",
    });
    expect(msg.media).toEqual([]);
    expect(msg.metadata).toEqual({});
  });

  it("getSessionKey formats channel and chatId", () => {
    const key = getSessionKey({
      channel: "telegram",
      senderId: "u1",
      chatId: "c1",
      content: "hi",
      timestamp: new Date(),
      media: [],
      metadata: {},
    });
    expect(key).toBe("telegram:c1");
  });
});
