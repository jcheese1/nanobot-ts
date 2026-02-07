import { describe, it, expect, vi } from "vitest";

import { MessageBus } from "../src/bus/queue.ts";

describe("bus/queue", () => {
  it("publishes and consumes inbound messages", async () => {
    const bus = new MessageBus();
    await bus.publishInbound({
      channel: "telegram",
      senderId: "u1",
      chatId: "c1",
      content: "hi",
      timestamp: new Date(),
      media: [],
      metadata: {},
    });
    const msg = await bus.consumeInbound();
    expect(msg.content).toBe("hi");
    expect(bus.inboundSize).toBe(0);
  });

  it("times out without losing future messages", async () => {
    const bus = new MessageBus();
    vi.useFakeTimers();
    const pending = bus.consumeInboundTimeout(10);
    const expectation = expect(pending).rejects.toThrow("timeout");
    await vi.advanceTimersByTimeAsync(10);
    await expectation;

    await bus.publishInbound({
      channel: "telegram",
      senderId: "u1",
      chatId: "c1",
      content: "later",
      timestamp: new Date(),
      media: [],
      metadata: {},
    });

    const msg = await bus.consumeInbound();
    expect(msg.content).toBe("later");
    vi.useRealTimers();
  });
});
