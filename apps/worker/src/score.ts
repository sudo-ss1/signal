import OpenAI from "openai";
import {
  prisma, config,
  type ScoreResult, type EnrichedAccountData,
} from "@signal/shared";

export const DEFAULT_ICP =
  "B2B SaaS company, 50–500 employees, uses Salesforce, raised Series A or later.";

// OpenAI strict Structured Outputs schema. Note: strict mode does not support
// validation keywords like `minItems`/`minimum`, so they are intentionally omitted.
export const SCORE_SCHEMA = {
  type: "object" as const,
  properties: {
    score: { type: "number", description: "0-100 fit score" },
    tier: { type: "string", enum: ["A", "B", "C", "disqualified"] },
    reasoning: { type: "array", items: { type: "string" } },
    confidence: { type: "string", enum: ["high", "medium", "low"] },
  },
  required: ["score", "tier", "reasoning", "confidence"],
  additionalProperties: false,
};

export function buildScoringPrompt(
  icp: string, enriched: Partial<EnrichedAccountData>, summary: string,
): string {
  return [
    `ICP definition: ${icp}`,
    `Firmographics: ${JSON.stringify(enriched)}`,
    `Research summary: ${summary}`,
    "Score this account's fit against the ICP. Return your decision as JSON matching the required schema.",
    "Reasoning must be concrete, evidence-based bullets a sales rep can trust.",
  ].join("\n\n");
}

// `scores.score` is a Prisma `Int` column, but the model may return a
// fractional value. Coerce to a clamped integer at the DB-write boundary so a
// value like 87.5 cannot throw on upsert and dead-letter the lead.
export function clampScore(n: number): number {
  return Math.max(0, Math.min(100, Math.round(n)));
}

export async function scoreAccount(
  client: OpenAI, icp: string,
  enriched: Partial<EnrichedAccountData>, summary: string,
): Promise<ScoreResult> {
  const res = await client.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      {
        role: "system",
        content:
          "You are a B2B lead qualification analyst. Score the account against the ICP and give concrete, evidence-based reasoning a sales rep can trust.",
      },
      { role: "user", content: buildScoringPrompt(icp, enriched, summary) },
    ],
    response_format: {
      type: "json_schema",
      json_schema: { name: "emit_score", strict: true, schema: SCORE_SCHEMA },
    },
  });
  const message = res.choices[0]?.message;
  if (!message || message.refusal || !message.content) {
    throw new Error("Model refused or returned no structured score content");
  }
  return JSON.parse(message.content) as ScoreResult;
}

export async function scoreHandler(leadId: string): Promise<void> {
  const client = new OpenAI({ apiKey: config.openaiApiKey });
  const enriched = await prisma.enrichedAccount.findUnique({ where: { leadId } });
  const research = await prisma.researchFinding.findUnique({ where: { leadId } });
  const result = await scoreAccount(
    // Prisma returns nullable columns as `null`; the value is only serialized
    // into the prompt, so a cast to the `undefined`-based shape is safe here.
    client, DEFAULT_ICP,
    (enriched ?? { techStack: [] }) as Partial<EnrichedAccountData>,
    research?.summary ?? "",
  );
  const safeScore = clampScore(result.score);
  await prisma.score.upsert({
    where: { leadId },
    create: { leadId, ...result, score: safeScore },
    update: { ...result, score: safeScore },
  });
}
