import { exec } from "node:child_process";
import { Tool } from "./base.js";

/**
 * Execute shell commands.
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

    return new Promise<string>((resolve) => {
      const child = exec(
        command,
        {
          cwd: this.workingDir,
          timeout: timeout * 1000,
          maxBuffer: 1024 * 1024, // 1MB
          env: { ...process.env, HOME: process.env.HOME ?? "" },
        },
        (error, stdout, stderr) => {
          const parts: string[] = [];

          if (stdout) parts.push(stdout);
          if (stderr) parts.push(`[stderr]\n${stderr}`);

          if (error) {
            if (error.killed) {
              parts.push(`\n[Timed out after ${timeout}s]`);
            } else if (error.code !== undefined) {
              parts.push(`\n[Exit code: ${error.code}]`);
            }
          }

          const output = parts.join("\n").trim();
          // Truncate large output
          if (output.length > 50000) {
            resolve(
              output.slice(0, 50000) + "\n... (truncated, output too large)",
            );
          } else {
            resolve(output || "(no output)");
          }
        },
      );
    });
  }
}
