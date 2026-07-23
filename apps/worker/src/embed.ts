import OpenAI from "openai";
import { prisma, config, type EnrichedAccountData } from "@signal/shared";
import { embedText, toVectorLiteral } from "./embeddings-client.js";

export interface SimilarMatch {
  accountId: string;
  companyName: string;
  similarity: number;
}

export function buildEmbedText(e: Partial<EnrichedAccountData>, summary: string): string {
  return [
    e.industry ?? "",
    e.fundingStage ?? "",
    (e.techStack ?? []).join(" "),
    summary,
  ].filter(Boolean).join(" — ");
}

export async function findSimilar(vec: number[], limit = 3): Promise<SimilarMatch[]> {
  const lit = toVectorLiteral(vec);
  const rows = await prisma.$queryRawUnsafe<
    { account_id: string; company_name: string; similarity: number }[]
  >(
    `SELECT id AS account_id, company_name,
            1 - (embedding <=> $1::vector) AS similarity
     FROM closed_won_accounts
     ORDER BY embedding <=> $1::vector
     LIMIT ${Number(limit)}`,
    lit,
  );
  return rows.map((r) => ({
    accountId: r.account_id,
    companyName: r.company_name,
    similarity: Number(r.similarity),
  }));
}

export async function embedHandler(leadId: string): Promise<void> {
  const openai = new OpenAI({ apiKey: config.openaiApiKey });
  const enriched = await prisma.enrichedAccount.findUnique({ where: { leadId } });
  const research = await prisma.researchFinding.findUnique({ where: { leadId } });
  const text = buildEmbedText(
    enriched
      ? {
          industry: enriched.industry ?? undefined,
          fundingStage: enriched.fundingStage ?? undefined,
          techStack: enriched.techStack,
        }
      : { techStack: [] },
    research?.summary ?? "",
  );
  const vec = await embedText(openai, text);

  await prisma.$executeRawUnsafe(
    `INSERT INTO embeddings (lead_id, source_text, embedding)
     VALUES ($1, $2, $3::vector)
     ON CONFLICT (lead_id) DO UPDATE SET source_text = EXCLUDED.source_text, embedding = EXCLUDED.embedding`,
    leadId, text, toVectorLiteral(vec),
  );
}
