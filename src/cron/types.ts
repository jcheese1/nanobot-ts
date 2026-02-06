/** Schedule definition for a cron job. */
export interface CronSchedule {
  kind: "at" | "every" | "cron";
  /** For "at": timestamp in ms */
  atMs?: number | null;
  /** For "every": interval in ms */
  everyMs?: number | null;
  /** For "cron": cron expression (e.g. "0 9 * * *") */
  expr?: string | null;
  /** Timezone for cron expressions */
  tz?: string | null;
}

/** What to do when the job runs. */
export interface CronPayload {
  kind: "system_event" | "agent_turn";
  message: string;
  /** Deliver response to channel */
  deliver: boolean;
  channel?: string | null;
  to?: string | null;
}

/** Runtime state of a job. */
export interface CronJobState {
  nextRunAtMs?: number | null;
  lastRunAtMs?: number | null;
  lastStatus?: "ok" | "error" | "skipped" | null;
  lastError?: string | null;
}

/** A scheduled job. */
export interface CronJob {
  id: string;
  name: string;
  enabled: boolean;
  schedule: CronSchedule;
  payload: CronPayload;
  state: CronJobState;
  createdAtMs: number;
  updatedAtMs: number;
  deleteAfterRun: boolean;
}

/** Persistent store for cron jobs. */
export interface CronStore {
  version: number;
  jobs: CronJob[];
}

/** Create a default CronPayload. */
export function createCronPayload(
  partial?: Partial<CronPayload>,
): CronPayload {
  return {
    kind: "agent_turn",
    message: "",
    deliver: false,
    ...partial,
  };
}

/** Create a default CronJobState. */
export function createCronJobState(
  partial?: Partial<CronJobState>,
): CronJobState {
  return { ...partial };
}

/** Create a default CronStore. */
export function createCronStore(partial?: Partial<CronStore>): CronStore {
  return {
    version: 1,
    jobs: [],
    ...partial,
  };
}
