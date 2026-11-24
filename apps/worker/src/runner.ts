import { Worker } from "bullmq";
import {
  prisma,
  getQueue,
  getConnection,
  nextStage,
  type Stage,
  type LeadJob,
} from "@signal/shared";

// status shown while a stage is running
const RUNNING_STATUS: Record<Stage, string> = {
  enrich: "enriching",
  research: "researching",
  score: "scoring",
  embed: "matching",
  route: "routing",
};

export function runStage(
  stage: Stage,
  handler: (leadId: string) => Promise<void>,
): Worker<LeadJob> {
  const worker = new Worker<LeadJob>(
    stage,
    async (job) => {
      const { leadId } = job.data;
      await prisma.lead.update({
        where: { id: leadId },
        data: { status: RUNNING_STATUS[stage] as never },
      });
      await handler(leadId);
      const next = nextStage(stage);
      if (next) {
        await getQueue(next).add(next, { leadId });
      } else {
        await prisma.lead.update({
          where: { id: leadId },
          data: { status: "done" },
        });
      }
    },
    { connection: getConnection() },
  );

  worker.on("failed", async (job, err) => {
    if (job && job.attemptsMade >= (job.opts.attempts ?? 1)) {
      await prisma.lead
        .update({ where: { id: job.data.leadId }, data: { status: "dead_letter" } })
        .catch(() => {});
    }
    console.error(`[${stage}] job failed:`, err.message);
  });

  return worker;
}
