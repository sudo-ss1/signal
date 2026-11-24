import { Queue } from "bullmq";
import { getConfig } from "./config.js";
import type { LeadJob } from "./types.js";

export const STAGES = [
  "enrich",
  "research",
  "score",
  "embed",
  "route",
] as const;

export type Stage = (typeof STAGES)[number];

export interface RedisConnection {
  host: string;
  port: number;
}

let connection: RedisConnection | undefined;

export function getConnection(): RedisConnection {
  if (!connection) {
    const url = new URL(getConfig().redisUrl);
    connection = { host: url.hostname, port: Number(url.port) || 6379 };
  }
  return connection;
}

const queues = new Map<Stage, Queue<LeadJob>>();

// Queues are created on first use (memoized), so importing this module opens
// no Redis connection. Only a caller that actually enqueues pays for one.
export function getQueue(stage: Stage): Queue<LeadJob> {
  let q = queues.get(stage);
  if (!q) {
    q = new Queue<LeadJob>(stage, {
      connection: getConnection(),
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: "exponential", delay: 1000 },
        removeOnComplete: 100,
        removeOnFail: false,
      },
    });
    queues.set(stage, q);
  }
  return q;
}

/** Close every queue opened so far (lets scripts and tests exit cleanly). */
export async function closeQueues(): Promise<void> {
  await Promise.all([...queues.values()].map((q) => q.close()));
  queues.clear();
}

export function nextStage(current: Stage): Stage | null {
  const i = STAGES.indexOf(current);
  return i >= 0 && i < STAGES.length - 1 ? STAGES[i + 1] : null;
}
