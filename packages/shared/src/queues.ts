import { Queue } from "bullmq";
import { config } from "./config.js";
import type { LeadJob } from "./types.js";

export const STAGES = [
  "enrich",
  "research",
  "score",
  "embed",
  "route",
] as const;

export type Stage = (typeof STAGES)[number];

export const connection = { url: config.redisUrl };

export const queues: Record<Stage, Queue<LeadJob>> = Object.fromEntries(
  STAGES.map((s) => [
    s,
    new Queue<LeadJob>(s, {
      connection,
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: "exponential", delay: 1000 },
        removeOnComplete: 100,
        removeOnFail: false,
      },
    }),
  ]),
) as Record<Stage, Queue<LeadJob>>;

export function nextStage(current: Stage): Stage | null {
  const i = STAGES.indexOf(current);
  return i >= 0 && i < STAGES.length - 1 ? STAGES[i + 1] : null;
}
