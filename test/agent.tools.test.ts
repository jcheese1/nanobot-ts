import { describe, it, expect } from "vitest";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { AgentLoop } from "../src/agent/loop.ts";
import { MessageBus } from "../src/bus/queue.ts";
import type { LLMProvider, LLMResponse, ChatMessage } from "../src/providers/base.ts";
import { Tool } from "../src/agent/tools/base.ts";

class FakeProvider implements LLMProvider {
  async chat(_params: {
    messages: ChatMessage[];
  }): Promise<LLMResponse> {
    return { content: null, toolCalls: [], hasToolCalls: false };
  }
  getDefaultModel(): string {
    return "fake-model";
  }
}

class CustomTool extends Tool {
  readonly name = "custom_tool";
  readonly description = "custom tool";
  readonly parameters = { type: "object", properties: {} };
  async execute(): Promise<string> {
    return "ok";
  }
}

describe("agent/tools registration", () => {
  function makeWorkspace(): string {
    const ws = join(tmpdir(), `nanobot-agent-${Date.now()}`);
    mkdirSync(ws, { recursive: true });
    return ws;
  }

  it("registers default tools when no filters set", () => {
    const workspace = makeWorkspace();
    const agent = new AgentLoop({
      bus: new MessageBus(),
      provider: new FakeProvider(),
      workspace,
    });

    const names = agent.tools.getNames();
    expect(names).toContain("read_file");
    expect(names).toContain("write_file");
    expect(names).toContain("edit_file");
    expect(names).toContain("list_dir");
    expect(names).toContain("exec");
    expect(names).toContain("web_search");
    expect(names).toContain("web_fetch");
    expect(names).toContain("message");
    expect(names).toContain("spawn");

    rmSync(workspace, { recursive: true, force: true });
  });

  it("respects toolsEnabled allowlist (including custom tools)", () => {
    const workspace = makeWorkspace();
    const agent = new AgentLoop({
      bus: new MessageBus(),
      provider: new FakeProvider(),
      workspace,
      toolsEnabled: ["read_file", "exec", "custom_tool"],
      customTools: [new CustomTool()],
    });

    const names = agent.tools.getNames().sort();
    expect(names).toEqual(["custom_tool", "exec", "read_file"]);

    rmSync(workspace, { recursive: true, force: true });
  });

  it("respects toolsDisabled denylist", () => {
    const workspace = makeWorkspace();
    const agent = new AgentLoop({
      bus: new MessageBus(),
      provider: new FakeProvider(),
      workspace,
      toolsDisabled: ["exec", "web_search"],
      customTools: [new CustomTool()],
    });

    const names = agent.tools.getNames();
    expect(names).toContain("custom_tool");
    expect(names).toContain("read_file");
    expect(names).not.toContain("exec");
    expect(names).not.toContain("web_search");

    rmSync(workspace, { recursive: true, force: true });
  });
});
