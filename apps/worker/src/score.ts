import Anthropic from "@anthropic-ai/sdk";
import {
  prisma, config,
  type ScoreResult, type EnrichedAccountData,
} from "@signal/shared";

export const DEFAULT_ICP =
  "B2B SaaS company, 50–500 employees, uses Salesforce, raised Series A or later.";

export const SCORE_TOOL = {
  name: "emit_score",
  description: "Emit the qualification score for the account.",
  input_schema: {
    type: "object" as const,
    properties: {
      score: { type: "number", description: "0-100 fit score" },
      tier: { type: "string", enum: ["A", "B", "C", "disqualified"] },
      reasoning: { type: "array", items: { type: "string" }, minItems: 1 },
      confidence: { type: "string", enum: ["high", "medium", "low"] },
    },
    required: ["score", "tier", "reasoning", "confidence"],
  },
};

export function buildScoringPrompt(
  icp: string, enriched: Partial<EnrichedAccountData>, summary: string,
): string {
  return [
    `ICP definition: ${icp}`,
    `Firmographics: ${JSON.stringify(enriched)}`,
    `Research summary: ${summary}`,
    "Score this account's fit against the ICP. Call emit_score with your decision.",
    "Reasoning must be concrete, evidence-based bullets a sales rep can trust.",
  ].join("\n\n");
}

export async function scoreAccount(
  client: Anthropic, icp: string,
  enriched: Partial<EnrichedAccountData>, summary: string,
): Promise<ScoreResult> {
  const res = await client.messages.create({
    model: "claude-sonnet-5",
    max_tokens: 1024,
    tools: [SCORE_TOOL],
    tool_choice: { type: "tool", name: "emit_score" },
    messages: [{ role: "user", content: buildScoringPrompt(icp, enriched, summary) }],
  });
  const block = res.content.find((b) => b.type === "tool_use");
  if (!block || block.type !== "tool_use") {
    throw new Error("Model did not call the emit_score tool");
  }
  return block.input as ScoreResult;
}

export async function scoreHandler(leadId: string): Promise<void> {
  const client = new Anthropic({ apiKey: config.anthropicApiKey });
  const enriched = await prisma.enrichedAccount.findUnique({ where: { leadId } });
  const research = await prisma.researchFinding.findUnique({ where: { leadId } });
  const result = await scoreAccount(
    // Prisma returns nullable columns as `null`; the value is only serialized
    // into the prompt, so a cast to the `undefined`-based shape is safe here.
    client, DEFAULT_ICP,
    (enriched ?? { techStack: [] }) as Partial<EnrichedAccountData>,
    research?.summary ?? "",
  );
  await prisma.score.upsert({
    where: { leadId },
    create: { leadId, ...result, reasoning: result.reasoning },
    update: { ...result, reasoning: result.reasoning },
  });
}
