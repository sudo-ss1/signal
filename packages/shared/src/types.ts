export interface RawLead {
  domain: string;
  companyName?: string;
  source: "csv" | "webhook";
  signalType?: "job_posting" | "funding" | "tech_change" | "form_fill";
  signalPayload?: Record<string, unknown>;
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
