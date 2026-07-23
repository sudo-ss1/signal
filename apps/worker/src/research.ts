import { prisma, type EnrichedAccountData } from "@signal/shared";

// Prisma returns nullable columns as `null`; accept those alongside `undefined`.
type StubInput = { [K in keyof EnrichedAccountData]?: EnrichedAccountData[K] | null };

export function buildStubSummary(e: StubInput): string {
  const parts = [
    e.industry ? `Operates in ${e.industry}.` : "Industry unknown.",
    e.fundingStage ? `Latest funding: ${e.fundingStage}.` : "No funding data.",
    e.techStack?.length ? `Detected tech: ${e.techStack.join(", ")}.` : "No tech stack detected.",
  ];
  return parts.join(" ");
}

export async function researchHandler(leadId: string): Promise<void> {
  const enriched = await prisma.enrichedAccount.findUnique({ where: { leadId } });
  const summary = buildStubSummary(enriched ?? { techStack: [] });
  await prisma.researchFinding.upsert({
    where: { leadId },
    create: { leadId, summary, rawFindings: { stub: true } },
    update: { summary, rawFindings: { stub: true } },
  });
}
