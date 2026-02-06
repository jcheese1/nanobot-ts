import { Tool } from "./base.js";
import type { CronService } from "../../cron/service.js";
import type { CronSchedule } from "../../cron/types.js";

/** Tool to schedule reminders and recurring tasks. */
export class CronTool extends Tool {
  readonly name = "cron";
  readonly description =
    "Schedule reminders and recurring tasks. Actions: add, list, remove.";
  readonly parameters = {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: ["add", "list", "remove"],
        description: "Action to perform",
      },
      message: {
        type: "string",
        description: "Reminder message (for add)",
      },
      every_seconds: {
        type: "integer",
        description: "Interval in seconds (for recurring tasks)",
      },
      cron_expr: {
        type: "string",
        description: "Cron expression like '0 9 * * *' (for scheduled tasks)",
      },
      job_id: {
        type: "string",
        description: "Job ID (for remove)",
      },
    },
    required: ["action"],
  };

  private cronService: CronService;
  private channel = "";
  private chatId = "";

  constructor(cronService: CronService) {
    super();
    this.cronService = cronService;
  }

  /** Set the current session context for delivery. */
  setContext(channel: string, chatId: string): void {
    this.channel = channel;
    this.chatId = chatId;
  }

  async execute(args: Record<string, unknown>): Promise<string> {
    const action = String(args.action);
    switch (action) {
      case "add":
        return this.addJob(args);
      case "list":
        return this.listJobs();
      case "remove":
        return this.removeJob(args);
      default:
        return `Unknown action: ${action}`;
    }
  }

  private addJob(args: Record<string, unknown>): string {
    const message = args.message ? String(args.message) : "";
    const everySeconds = args.every_seconds
      ? Number(args.every_seconds)
      : null;
    const cronExpr = args.cron_expr ? String(args.cron_expr) : null;

    if (!message) return "Error: message is required for add";
    if (!this.channel || !this.chatId)
      return "Error: no session context (channel/chatId)";

    let schedule: CronSchedule;
    if (everySeconds) {
      schedule = { kind: "every", everyMs: everySeconds * 1000 };
    } else if (cronExpr) {
      schedule = { kind: "cron", expr: cronExpr };
    } else {
      return "Error: either every_seconds or cron_expr is required";
    }

    const job = this.cronService.addJob({
      name: message.slice(0, 30),
      schedule,
      message,
      deliver: true,
      channel: this.channel,
      to: this.chatId,
    });
    return `Created job '${job.name}' (id: ${job.id})`;
  }

  private listJobs(): string {
    const jobs = this.cronService.listJobs();
    if (jobs.length === 0) return "No scheduled jobs.";
    const lines = jobs.map(
      (j) => `- ${j.name} (id: ${j.id}, ${j.schedule.kind})`,
    );
    return "Scheduled jobs:\n" + lines.join("\n");
  }

  private removeJob(args: Record<string, unknown>): string {
    const jobId = args.job_id ? String(args.job_id) : null;
    if (!jobId) return "Error: job_id is required for remove";
    if (this.cronService.removeJob(jobId)) {
      return `Removed job ${jobId}`;
    }
    return `Job ${jobId} not found`;
  }
}
