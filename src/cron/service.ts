import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import type {
  CronJob,
  CronSchedule,
  CronStore,
  CronPayload,
  CronJobState,
} from "./types.js";
import { createCronStore, createCronPayload, createCronJobState } from "./types.js";

function nowMs(): number {
  return Date.now();
}

function computeNextRun(
  schedule: CronSchedule,
  currentMs: number,
): number | null {
  if (schedule.kind === "at") {
    return schedule.atMs && schedule.atMs > currentMs
      ? schedule.atMs
      : null;
  }

  if (schedule.kind === "every") {
    if (!schedule.everyMs || schedule.everyMs <= 0) return null;
    return currentMs + schedule.everyMs;
  }

  if (schedule.kind === "cron" && schedule.expr) {
    try {
      // Dynamic import for cron-parser
      const { parseExpression } = require("cron-parser") as typeof import("cron-parser");
      const interval = parseExpression(schedule.expr);
      const next = interval.next();
      return next.getTime();
    } catch {
      return null;
    }
  }

  return null;
}

type JobCallback = (job: CronJob) => Promise<string | null>;

/** Service for managing and executing scheduled jobs. */
export class CronService {
  private storePath: string;
  onJob: JobCallback | null;
  private store: CronStore | null = null;
  private timerHandle: ReturnType<typeof setTimeout> | null = null;
  private _running = false;

  constructor(storePath: string, onJob?: JobCallback) {
    this.storePath = storePath;
    this.onJob = onJob ?? null;
  }

  private loadStore(): CronStore {
    if (this.store) return this.store;

    if (existsSync(this.storePath)) {
      try {
        const raw = readFileSync(this.storePath, "utf-8");
        const data = JSON.parse(raw);
        const jobs: CronJob[] = (data.jobs ?? []).map(
          (j: Record<string, unknown>) => ({
            id: j.id as string,
            name: j.name as string,
            enabled: (j.enabled as boolean) ?? true,
            schedule: {
              kind: (j.schedule as Record<string, unknown>).kind as string,
              atMs: (j.schedule as Record<string, unknown>).atMs as number | undefined,
              everyMs: (j.schedule as Record<string, unknown>).everyMs as number | undefined,
              expr: (j.schedule as Record<string, unknown>).expr as string | undefined,
              tz: (j.schedule as Record<string, unknown>).tz as string | undefined,
            } as CronSchedule,
            payload: {
              kind:
                ((j.payload as Record<string, unknown>)?.kind as string) ??
                "agent_turn",
              message:
                ((j.payload as Record<string, unknown>)?.message as string) ??
                "",
              deliver:
                ((j.payload as Record<string, unknown>)?.deliver as boolean) ??
                false,
              channel: (j.payload as Record<string, unknown>)?.channel as
                | string
                | undefined,
              to: (j.payload as Record<string, unknown>)?.to as
                | string
                | undefined,
            } as CronPayload,
            state: {
              nextRunAtMs: (
                (j.state as Record<string, unknown>) ?? {}
              ).nextRunAtMs as number | undefined,
              lastRunAtMs: (
                (j.state as Record<string, unknown>) ?? {}
              ).lastRunAtMs as number | undefined,
              lastStatus: (
                (j.state as Record<string, unknown>) ?? {}
              ).lastStatus as string | undefined,
              lastError: (
                (j.state as Record<string, unknown>) ?? {}
              ).lastError as string | undefined,
            } as CronJobState,
            createdAtMs: (j.createdAtMs as number) ?? 0,
            updatedAtMs: (j.updatedAtMs as number) ?? 0,
            deleteAfterRun: (j.deleteAfterRun as boolean) ?? false,
          }),
        );
        this.store = { version: data.version ?? 1, jobs };
      } catch (err) {
        console.warn("Failed to load cron store:", err);
        this.store = createCronStore();
      }
    } else {
      this.store = createCronStore();
    }

    return this.store;
  }

  private saveStore(): void {
    if (!this.store) return;

    const dir = dirname(this.storePath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

    const data = {
      version: this.store.version,
      jobs: this.store.jobs.map((j) => ({
        id: j.id,
        name: j.name,
        enabled: j.enabled,
        schedule: {
          kind: j.schedule.kind,
          atMs: j.schedule.atMs,
          everyMs: j.schedule.everyMs,
          expr: j.schedule.expr,
          tz: j.schedule.tz,
        },
        payload: {
          kind: j.payload.kind,
          message: j.payload.message,
          deliver: j.payload.deliver,
          channel: j.payload.channel,
          to: j.payload.to,
        },
        state: {
          nextRunAtMs: j.state.nextRunAtMs,
          lastRunAtMs: j.state.lastRunAtMs,
          lastStatus: j.state.lastStatus,
          lastError: j.state.lastError,
        },
        createdAtMs: j.createdAtMs,
        updatedAtMs: j.updatedAtMs,
        deleteAfterRun: j.deleteAfterRun,
      })),
    };

    writeFileSync(this.storePath, JSON.stringify(data, null, 2));
  }

  async start(): Promise<void> {
    this._running = true;
    this.loadStore();
    this.recomputeNextRuns();
    this.saveStore();
    this.armTimer();
    console.log(
      `Cron service started with ${this.store?.jobs.length ?? 0} jobs`,
    );
  }

  stop(): void {
    this._running = false;
    if (this.timerHandle) {
      clearTimeout(this.timerHandle);
      this.timerHandle = null;
    }
  }

  private recomputeNextRuns(): void {
    if (!this.store) return;
    const now = nowMs();
    for (const job of this.store.jobs) {
      if (job.enabled) {
        job.state.nextRunAtMs = computeNextRun(job.schedule, now);
      }
    }
  }

  private getNextWakeMs(): number | null {
    if (!this.store) return null;
    const times = this.store.jobs
      .filter((j) => j.enabled && j.state.nextRunAtMs)
      .map((j) => j.state.nextRunAtMs!);
    return times.length > 0 ? Math.min(...times) : null;
  }

  private armTimer(): void {
    if (this.timerHandle) {
      clearTimeout(this.timerHandle);
      this.timerHandle = null;
    }

    const nextWake = this.getNextWakeMs();
    if (!nextWake || !this._running) return;

    const delayMs = Math.max(0, nextWake - nowMs());
    this.timerHandle = setTimeout(() => {
      if (this._running) {
        this.onTimer().catch(console.error);
      }
    }, delayMs);
  }

  private async onTimer(): Promise<void> {
    if (!this.store) return;
    const now = nowMs();

    const dueJobs = this.store.jobs.filter(
      (j) => j.enabled && j.state.nextRunAtMs && now >= j.state.nextRunAtMs,
    );

    for (const job of dueJobs) {
      await this.executeJob(job);
    }

    this.saveStore();
    this.armTimer();
  }

  private async executeJob(job: CronJob): Promise<void> {
    const startMs = nowMs();
    console.log(`Cron: executing job '${job.name}' (${job.id})`);

    try {
      if (this.onJob) {
        await this.onJob(job);
      }
      job.state.lastStatus = "ok";
      job.state.lastError = null;
      console.log(`Cron: job '${job.name}' completed`);
    } catch (err) {
      job.state.lastStatus = "error";
      job.state.lastError = err instanceof Error ? err.message : String(err);
      console.error(`Cron: job '${job.name}' failed:`, err);
    }

    job.state.lastRunAtMs = startMs;
    job.updatedAtMs = nowMs();

    if (job.schedule.kind === "at") {
      if (job.deleteAfterRun && this.store) {
        this.store.jobs = this.store.jobs.filter((j) => j.id !== job.id);
      } else {
        job.enabled = false;
        job.state.nextRunAtMs = null;
      }
    } else {
      job.state.nextRunAtMs = computeNextRun(job.schedule, nowMs());
    }
  }

  // ========== Public API ==========

  listJobs(includeDisabled = false): CronJob[] {
    const store = this.loadStore();
    const jobs = includeDisabled
      ? store.jobs
      : store.jobs.filter((j) => j.enabled);
    return jobs.sort(
      (a, b) =>
        (a.state.nextRunAtMs ?? Infinity) - (b.state.nextRunAtMs ?? Infinity),
    );
  }

  addJob(params: {
    name: string;
    schedule: CronSchedule;
    message: string;
    deliver?: boolean;
    channel?: string;
    to?: string;
    deleteAfterRun?: boolean;
  }): CronJob {
    const store = this.loadStore();
    const now = nowMs();

    const job: CronJob = {
      id: randomUUID().slice(0, 8),
      name: params.name,
      enabled: true,
      schedule: params.schedule,
      payload: createCronPayload({
        kind: "agent_turn",
        message: params.message,
        deliver: params.deliver ?? false,
        channel: params.channel,
        to: params.to,
      }),
      state: createCronJobState({
        nextRunAtMs: computeNextRun(params.schedule, now),
      }),
      createdAtMs: now,
      updatedAtMs: now,
      deleteAfterRun: params.deleteAfterRun ?? false,
    };

    store.jobs.push(job);
    this.saveStore();
    this.armTimer();

    console.log(`Cron: added job '${params.name}' (${job.id})`);
    return job;
  }

  removeJob(jobId: string): boolean {
    const store = this.loadStore();
    const before = store.jobs.length;
    store.jobs = store.jobs.filter((j) => j.id !== jobId);
    const removed = store.jobs.length < before;

    if (removed) {
      this.saveStore();
      this.armTimer();
      console.log(`Cron: removed job ${jobId}`);
    }
    return removed;
  }

  enableJob(jobId: string, enabled = true): CronJob | null {
    const store = this.loadStore();
    for (const job of store.jobs) {
      if (job.id === jobId) {
        job.enabled = enabled;
        job.updatedAtMs = nowMs();
        if (enabled) {
          job.state.nextRunAtMs = computeNextRun(job.schedule, nowMs());
        } else {
          job.state.nextRunAtMs = null;
        }
        this.saveStore();
        this.armTimer();
        return job;
      }
    }
    return null;
  }

  status(): { enabled: boolean; jobs: number; nextWakeAtMs: number | null } {
    const store = this.loadStore();
    return {
      enabled: this._running,
      jobs: store.jobs.length,
      nextWakeAtMs: this.getNextWakeMs(),
    };
  }
}
