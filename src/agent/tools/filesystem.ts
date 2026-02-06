import {
  readFileSync,
  writeFileSync,
  readdirSync,
  existsSync,
  statSync,
  mkdirSync,
} from "node:fs";
import { join, dirname, resolve } from "node:path";
import { Tool } from "./base.js";

/** Read a file's contents. */
export class ReadFileTool extends Tool {
  readonly name = "read_file";
  readonly description = "Read the contents of a file.";
  readonly parameters = {
    type: "object",
    properties: {
      path: { type: "string", description: "File path to read" },
      maxChars: {
        type: "integer",
        description: "Max characters to return",
        minimum: 1,
      },
    },
    required: ["path"],
  };

  async execute(args: Record<string, unknown>): Promise<string> {
    const filePath = String(args.path);
    const maxChars = args.maxChars ? Number(args.maxChars) : undefined;

    try {
      if (!existsSync(filePath)) {
        return `Error: File not found: ${filePath}`;
      }
      let content = readFileSync(filePath, "utf-8");
      if (maxChars && content.length > maxChars) {
        content = content.slice(0, maxChars) + "\n... (truncated)";
      }
      return content;
    } catch (err) {
      return `Error reading file: ${err instanceof Error ? err.message : err}`;
    }
  }
}

/** Write content to a file. */
export class WriteFileTool extends Tool {
  readonly name = "write_file";
  readonly description = "Write content to a file. Creates parent directories if needed.";
  readonly parameters = {
    type: "object",
    properties: {
      path: { type: "string", description: "File path to write" },
      content: { type: "string", description: "Content to write" },
    },
    required: ["path", "content"],
  };

  async execute(args: Record<string, unknown>): Promise<string> {
    const filePath = String(args.path);
    const content = String(args.content);

    try {
      const dir = dirname(filePath);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
      writeFileSync(filePath, content, "utf-8");
      return `Written ${content.length} chars to ${filePath}`;
    } catch (err) {
      return `Error writing file: ${err instanceof Error ? err.message : err}`;
    }
  }
}

/** Edit a file by replacing text. */
export class EditFileTool extends Tool {
  readonly name = "edit_file";
  readonly description =
    "Edit a file by replacing occurrences of old_text with new_text.";
  readonly parameters = {
    type: "object",
    properties: {
      path: { type: "string", description: "File path to edit" },
      old_text: { type: "string", description: "Text to find and replace" },
      new_text: { type: "string", description: "Replacement text" },
    },
    required: ["path", "old_text", "new_text"],
  };

  async execute(args: Record<string, unknown>): Promise<string> {
    const filePath = String(args.path);
    const oldText = String(args.old_text);
    const newText = String(args.new_text);

    try {
      if (!existsSync(filePath)) {
        return `Error: File not found: ${filePath}`;
      }
      const content = readFileSync(filePath, "utf-8");
      if (!content.includes(oldText)) {
        return `Error: old_text not found in ${filePath}`;
      }
      const newContent = content.replace(oldText, newText);
      writeFileSync(filePath, newContent, "utf-8");
      return `Edited ${filePath}: replaced ${oldText.length} chars`;
    } catch (err) {
      return `Error editing file: ${err instanceof Error ? err.message : err}`;
    }
  }
}

/** List directory contents. */
export class ListDirTool extends Tool {
  readonly name = "list_dir";
  readonly description = "List files and directories at the given path.";
  readonly parameters = {
    type: "object",
    properties: {
      path: { type: "string", description: "Directory path to list" },
    },
    required: ["path"],
  };

  async execute(args: Record<string, unknown>): Promise<string> {
    const dirPath = String(args.path);

    try {
      if (!existsSync(dirPath)) {
        return `Error: Directory not found: ${dirPath}`;
      }
      const entries = readdirSync(dirPath);
      const lines: string[] = [];
      for (const entry of entries) {
        try {
          const fullPath = join(dirPath, entry);
          const stat = statSync(fullPath);
          const type = stat.isDirectory() ? "dir" : "file";
          const size = stat.isDirectory() ? "" : ` (${stat.size}b)`;
          lines.push(`${type}\t${entry}${size}`);
        } catch {
          lines.push(`?\t${entry}`);
        }
      }
      return lines.length > 0 ? lines.join("\n") : "(empty directory)";
    } catch (err) {
      return `Error listing directory: ${err instanceof Error ? err.message : err}`;
    }
  }
}
