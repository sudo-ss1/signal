import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  OPENAI_API_KEY: z.string().default(""),
  SCORING_MODEL: z.string().min(1).default("gpt-6-luna"),
  RESEARCH_CACHE_DAYS: z.coerce.number().default(7),
});

export interface Config {
  databaseUrl: string;
  redisUrl: string;
  openaiApiKey: string;
  scoringModel: string;
  researchCacheDays: number;
}

let cached: Config | undefined;

// Parsed on first use, not at import time, so importing a type or a pure
// helper from @signal/shared never throws for a missing env var.
export function getConfig(): Config {
  if (!cached) {
    const parsed = schema.parse(process.env);
    cached = {
      databaseUrl: parsed.DATABASE_URL,
      redisUrl: parsed.REDIS_URL,
      openaiApiKey: parsed.OPENAI_API_KEY,
      scoringModel: parsed.SCORING_MODEL,
      researchCacheDays: parsed.RESEARCH_CACHE_DAYS,
    };
  }
  return cached;
}
