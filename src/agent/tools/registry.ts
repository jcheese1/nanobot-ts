import type { ToolDefinition } from "../../providers/base.js";
import type { Tool } from "./base.js";

/**
 * Dynamic tool registration and execution.
 */
export class ToolRegistry {
  private tools = new Map<string, Tool>();

  /** Register a tool. */
  register(tool: Tool): void {
    this.tools.set(tool.name, tool);
  }

  /** Unregister a tool by name. */
  unregister(name: string): boolean {
    return this.tools.delete(name);
  }

  /** Get a tool by name. */
  get(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  /** Check if a tool exists. */
  has(name: string): boolean {
    return this.tools.has(name);
  }

  /** Get tool definitions for the LLM. */
  getDefinitions(): ToolDefinition[] {
    return Array.from(this.tools.values()).map((t) => t.getDefinition());
  }

  /** Execute a tool by name with arguments. */
  async execute(
    name: string,
    args: Record<string, unknown>,
  ): Promise<string> {
    const tool = this.tools.get(name);
    if (!tool) {
      return `Error: Unknown tool '${name}'`;
    }
    try {
      return await tool.execute(args);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return `Error executing ${name}: ${message}`;
    }
  }

  /** Get all registered tool names. */
  getNames(): string[] {
    return Array.from(this.tools.keys());
  }

  /** Get count of registered tools. */
  get size(): number {
    return this.tools.size;
  }
}
