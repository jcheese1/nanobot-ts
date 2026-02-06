import type { ToolDefinition } from "../../providers/base.js";

/** Abstract base class for tools. */
export abstract class Tool {
  abstract readonly name: string;
  abstract readonly description: string;
  abstract readonly parameters: Record<string, unknown>;

  /** Execute the tool with the given arguments. */
  abstract execute(args: Record<string, unknown>): Promise<string>;

  /** Get the tool definition for the LLM. */
  getDefinition(): ToolDefinition {
    return {
      type: "function",
      function: {
        name: this.name,
        description: this.description,
        parameters: this.parameters,
      },
    };
  }
}
