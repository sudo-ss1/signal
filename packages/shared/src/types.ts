import { z } from "zod";

export const SIGNAL_TYPES = ["job_posting", "funding", "tech_change", "form_fill"] as const;
export const LEAD_SOURCES = ["csv", "webhook"] as const;

// Domain: hostname-like (labels of letters/digits/hyphens separated by dots).
const domainSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/, {
    message: "must be a bare domain such as acme.com",
  });

/** Validation for an incoming lead, shared by the JSON and CSV ingest paths. */
export const rawLeadInputSchema = z.object({
  domain: domainSchema,
  companyName: z.string().trim().min(1).max(200).optional(),
  source: z.enum(LEAD_SOURCES),
  signalType: z.enum(SIGNAL_TYPES).optional(),
  signalPayload: z.record(z.unknown()).optional(),
});

export type RawLeadInput = z.infer<typeof rawLeadInputSchema>;

export interface RawLead extends RawLeadInput {
  receivedAt: string;
}

export interface EnrichedAccountData {
  employeeCount?: number;
  industry?: string;
  techStack: string[];
  fundingStage?: string;
  hqLocation?: string;
}

export type Tier = "A" | "B" | "C" | "disqualified";
export type Confidence = "high" | "medium" | "low";

export interface ScoreResult {
  score: number;
  tier: Tier;
  reasoning: string[];
  confidence: Confidence;
}

export interface LeadJob {
  leadId: string;
}
