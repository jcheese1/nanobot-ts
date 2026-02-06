import { Tool } from "./base.js";
import type { SubagentManager } from "../subagent.js";

/**
 * Tool to spawn a subagent for background task execution.
 */
export class SpawnTool extends Tool {
  readonly name = "spawn";
  readonly description =
    "Spawn a subagent to handle a task in the background. " +
    "Use this for complex or time-consuming tasks that can run independently. " +
    "The subagent will complete the task and report back when done.";
  readonly parameters = {
    type: "object",
    properties: {
      task: {
        type: "string",
        description: "The task for the subagent to complete",
      },
      label: {
        type: "string",
        description: "Optional short label for the task (for display)",
      },
    },
    required: ["task"],
  };

  private manager: SubagentManager;
  private originChannel = "cli";
  private originChatId = "direct";

  constructor(manager: SubagentManager) {
    super();
    this.manager = manager;
  }

  /** Set the origin context for subagent announcements. */
  setContext(channel: string, chatId: string): void {
    this.originChannel = channel;
    this.originChatId = chatId;
  }

  async execute(args: Record<string, unknown>): Promise<string> {
    const task = String(args.task);
    const label = args.label ? String(args.label) : undefined;
    return this.manager.spawn({
      task,
      label,
      originChannel: this.originChannel,
      originChatId: this.originChatId,
    });
  }
}
