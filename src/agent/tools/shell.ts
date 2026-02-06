import { spawn } from "node:child_process";
import { Tool } from "./base.js";

/** Characters/patterns that require shell interpretation. */
const SHELL_SYNTAX = /[|&;<>`$(){}[\]!#*?"'\\~]|\s>|\s</;

/**
 * Parse a command string into [command, args] for spawn.
 * Only handles simple "cmd arg1 arg2" forms — anything with shell
 * metacharacters should be routed through the shell instead.
 */
function parseCommand(command: string): [string, string[]] {
  const parts: string[] = [];
  let current = "";
  let inSingle = false;
  let inDouble = false;

  for (let i = 0; i < command.length; i++) {
    const ch = command[i];
    if (ch === "'" && !inDouble) {
      inSingle = !inSingle;
    } else if (ch === '"' && !inSingle) {
      inDouble = !inDouble;
    } else if (ch === " " && !inSingle && !inDouble) {
      if (current) {
        parts.push(current);
        current = "";
      }
    } else {
      current += ch;
    }
  }
  if (current) parts.push(current);

  const [cmd, ...args] = parts;
  return [cmd ?? "", args];
}

/**
 * Execute shell commands.
 *
 * Uses child_process.spawn instead of exec for compatibility with
 * WebContainer environments (e.g. StackBlitz) where the virtualised
 * shell (jsh) has limited support and cross-origin constraints.
 *
 * Simple commands (e.g. "node script.js", "git status") are spawned
 * directly without a shell.  Commands that contain shell syntax
 * (pipes, redirects, etc.) fall back to shell mode automatically.
 */
export class ExecTool extends Tool {
  readonly name = "exec";
  readonly description =
    "Execute a shell command and return its output. Use for running programs, scripts, git, etc.";
  readonly parameters = {
    type: "object",
    properties: {
      command: { type: "string", description: "Shell command to execute" },
      timeout: {
        type: "integer",
        description: "Timeout in seconds (default: 60)",
      },
    },
    required: ["command"],
  };

  private workingDir: string;
  private defaultTimeout: number;
  private restrictToWorkspace: boolean;

  constructor(params?: {
    workingDir?: string;
    timeout?: number;
    restrictToWorkspace?: boolean;
  }) {
    super();
    this.workingDir = params?.workingDir ?? process.cwd();
    this.defaultTimeout = params?.timeout ?? 60;
    this.restrictToWorkspace = params?.restrictToWorkspace ?? false;
  }

  async execute(args: Record<string, unknown>): Promise<string> {
    const command = String(args.command);
    const timeout = args.timeout ? Number(args.timeout) : this.defaultTimeout;

    if (!command.trim()) {
      return "Error: Empty command";
    }

    // Basic safety check
    if (this.restrictToWorkspace) {
      const dangerous = ["rm -rf /", "mkfs", "dd if=", "> /dev/"];
      for (const pattern of dangerous) {
        if (command.includes(pattern)) {
          return `Error: Command blocked for safety: ${pattern}`;
        }
      }
    }

    // Determine whether the command needs a shell.
    // Shell syntax (pipes, redirects, etc.) requires shell interpretation.
    // Simple "cmd arg1 arg2" commands can be spawned directly, which avoids
    // WebContainer/jsh limitations entirely.
    const needsShell = SHELL_SYNTAX.test(command);

    return new Promise<string>((resolve) => {
      let child;
      const spawnOpts = {
        cwd: this.workingDir,
        timeout: timeout * 1000,
        env: { ...process.env, HOME: process.env.HOME ?? "" },
      };

      if (needsShell) {
        // Fall back to shell for complex commands
        child = spawn(command, {
          ...spawnOpts,
          shell: true,
          maxBuffer: 1024 * 1024,
        } as any);
      } else {
        // Direct spawn — bypasses jsh entirely
        const [cmd, cmdArgs] = parseCommand(command);
        child = spawn(cmd, cmdArgs, spawnOpts);
      }

      const stdoutChunks: Buffer[] = [];
      const stderrChunks: Buffer[] = [];
      let totalBytes = 0;
      const maxBuffer = 1024 * 1024; // 1MB

      child.stdout?.on("data", (chunk: Buffer) => {
        totalBytes += chunk.length;
        if (totalBytes <= maxBuffer) stdoutChunks.push(chunk);
      });

      child.stderr?.on("data", (chunk: Buffer) => {
        totalBytes += chunk.length;
        if (totalBytes <= maxBuffer) stderrChunks.push(chunk);
      });

      child.on("error", (err) => {
        resolve(`Error: ${err.message}`);
      });

      child.on("close", (code, signal) => {
        const stdout = Buffer.concat(stdoutChunks).toString();
        const stderr = Buffer.concat(stderrChunks).toString();
        const parts: string[] = [];

        if (stdout) parts.push(stdout);
        if (stderr) parts.push(`[stderr]\n${stderr}`);

        if (signal === "SIGTERM" || signal === "SIGKILL") {
          parts.push(`\n[Timed out after ${timeout}s]`);
        } else if (code !== null && code !== 0) {
          parts.push(`\n[Exit code: ${code}]`);
        }

        const output = parts.join("\n").trim();
        if (output.length > 50000) {
          resolve(
            output.slice(0, 50000) + "\n... (truncated, output too large)",
          );
        } else {
          resolve(output || "(no output)");
        }
      });
    });
  }
}
