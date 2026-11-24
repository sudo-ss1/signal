import { prisma, type Tier, type Confidence } from "@signal/shared";
import { findSimilar } from "./embed.js";

export type RoutingAction = "crm_push" | "slack_alert" | "suppressed";

export function decideAction(tier: Tier, confidence: Confidence): RoutingAction {
  if (tier === "A" && confidence === "high") return "slack_alert";
  if (tier === "A" || tier === "B") return "crm_push";
  return "suppressed";
}

export async function routeHandler(leadId: string): Promise<void> {
  const score = await prisma.score.findUnique({ where: { leadId } });
  if (!score) throw new Error(`no score for lead ${leadId}`);

  const action = decideAction(score.tier as Tier, score.confidence as Confidence);

  // Similarity lookup for the payload (best match). The cosine query lives in
  // findSimilar (./embed.js) so it exists in exactly one place.
  let topMatch: { companyName: string; similarity: number } | null = null;
  const rows = await prisma.$queryRawUnsafe<{ emb: string | null }[]>(
    "SELECT embedding::text AS emb FROM embeddings WHERE lead_id = $1",
    leadId,
  );
  if (rows[0]?.emb) {
    const vec = JSON.parse(rows[0].emb) as number[];
    const matches = await findSimilar(vec, 1);
    topMatch = matches[0]
      ? { companyName: matches[0].companyName, similarity: matches[0].similarity }
      : null;
  }

  const payload = {
    action,
    score: score.score,
    tier: score.tier,
    reasoning: score.reasoning,
    similarAccount: topMatch,
  };

  // Sink: console + routing_events. Real HubSpot/Slack is deferred to a later
  // cycle (Phase 2 design, item C).
  console.log(`[route] ${action}`, JSON.stringify(payload));

  // Upsert keyed on leadId: re-running the stage replaces the decision rather
  // than appending a duplicate event.
  const timestamp = new Date();
  await prisma.routingEvent.upsert({
    where: { leadId },
    create: { leadId, action, payload, timestamp },
    update: { action, payload, timestamp },
  });
}
