import OpenAI from "openai";
import {
  prisma, getConfig,
  type ScoreResult, type EnrichedAccountData,
} from "@signal/shared";

export const DEFAULT_ICP =
  "B2B SaaS company, 50–500 employees, uses Salesforce, raised Series A or later.";

/** Default scoring model; override with SCORING_MODEL in .env. */
export const DEFAULT_SCORING_MODEL = "gpt-6-luna";

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

/** Who the lead is and why it arrived — the raw signal, not just firmographics. */
export interface LeadContext {
  domain: string;
  companyName?: string | null;
  signalType?: string | null;
  signalPayload?: unknown;
}

export const SYSTEM_PROMPT = [
  "You are a B2B lead qualification analyst. Score the account against the ICP.",
  "Rules:",
  "- Use ONLY the facts provided. Never assume an industry, tech stack, size, or funding stage that is not stated; do not relabel one industry as another (e.g. \"Software\" is not \"B2B SaaS\").",
  "- Assess every ICP criterion as met, not met, or unknown, and say which in the reasoning.",
  "- Unknown is not evidence of fit. Missing data lowers confidence and must not raise the score.",
  "- Tiers, with the score band each must use:",
  "  A (80-100): every ICP criterion is met with evidence.",
  "  B (60-79): the market matches; at most one criterion is unmet or unknown.",
  "  C (30-59): the market matches or is unknown, but two or more criteria are unmet or unknown. An account with little or no data is C with low confidence, never disqualified.",
  "  disqualified (0-29): ONLY when there is evidence the company is in a different market or business model than the ICP (e.g. consumer retail, government, non-software). That evidence must come from the firmographics, or from a company name or domain that unambiguously identifies a well-known organization (e.g. a .gov domain or a famous government agency) — say which in the reasoning. A generic or unfamiliar name is not evidence. Missing a size, funding, or tech criterion alone is never grounds for disqualification.",
  "- Confidence high only when every criterion is backed by provided data; low when key firmographics are missing.",
  "- Each reasoning bullet must cite a specific provided fact (or name the missing one).",
].join("\n");

const KEY_FIELDS: (keyof EnrichedAccountData)[] = [
  "employeeCount", "industry", "fundingStage", "techStack",
];

/** Firmographic fields enrichment could not supply (flagged to the scorer). */
export function missingFields(e: Partial<EnrichedAccountData>): string[] {
  return KEY_FIELDS.filter((k) => {
    const v = e[k];
    return v == null || (Array.isArray(v) && v.length === 0);
  });
}

export function buildScoringPrompt(
  icp: string, lead: LeadContext, enriched: Partial<EnrichedAccountData>, summary: string,
): string {
  const missing = missingFields(enriched);
  const payload =
    lead.signalPayload && typeof lead.signalPayload === "object" &&
    Object.keys(lead.signalPayload).length > 0
      ? JSON.stringify(lead.signalPayload)
      : null;
  return [
    `ICP definition: ${icp}`,
    `Company: ${lead.companyName ?? "(name not provided)"} — domain ${lead.domain}`,
    `Inbound signal: ${lead.signalType ?? "none"}${payload ? ` — ${payload}` : ""}`,
    `Firmographics: ${JSON.stringify(enriched)}`,
    `Missing firmographics: ${missing.length ? missing.join(", ") : "none"}`,
    `Research summary: ${summary || "(none)"}`,
    "Score this account's fit against the ICP. Return your decision as JSON matching the required schema.",
  ].join("\n\n");
}

// `scores.score` is a Prisma `Int` column, but the model may return a
// fractional value. Coerce to a clamped integer at the DB-write boundary so a
// value like 87.5 cannot throw on upsert and dead-letter the lead.
export function clampScore(n: number): number {
  return Math.max(0, Math.min(100, Math.round(n)));
}

export async function scoreAccount(
  client: OpenAI, icp: string, lead: LeadContext,
  enriched: Partial<EnrichedAccountData>, summary: string,
  model: string = DEFAULT_SCORING_MODEL,
): Promise<ScoreResult> {
  const res = await client.chat.completions.create({
    // No temperature: gpt-6-luna only accepts the default. Tier stability is
    // measured with `pnpm eval` (runs each golden case several times).
    model,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: buildScoringPrompt(icp, lead, enriched, summary) },
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

/** Drop nulls so Prisma rows serialize like the `undefined`-based type. */
function toEnrichedData(row: Record<string, unknown> | null): Partial<EnrichedAccountData> {
  if (!row) return { techStack: [] };
  const { leadId: _leadId, ...rest } = row;
  return Object.fromEntries(
    Object.entries(rest).filter(([, v]) => v != null),
  ) as Partial<EnrichedAccountData>;
}

export async function scoreHandler(leadId: string): Promise<void> {
  const { openaiApiKey, scoringModel } = getConfig();
  const client = new OpenAI({ apiKey: openaiApiKey });
  const lead = await prisma.lead.findUniqueOrThrow({ where: { id: leadId } });
  const enriched = await prisma.enrichedAccount.findUnique({ where: { leadId } });
  const research = await prisma.researchFinding.findUnique({ where: { leadId } });
  const result = await scoreAccount(
    client, DEFAULT_ICP,
    {
      domain: lead.domain,
      companyName: lead.companyName,
      signalType: lead.signalType,
      signalPayload: lead.signalPayload,
    },
    toEnrichedData(enriched),
    research?.summary ?? "",
    scoringModel,
  );
  const safeScore = clampScore(result.score);
  await prisma.score.upsert({
    where: { leadId },
    create: { leadId, ...result, score: safeScore },
    update: { ...result, score: safeScore },
  });
}
