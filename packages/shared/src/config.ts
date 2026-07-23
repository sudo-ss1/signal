import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  ANTHROPIC_API_KEY: z.string().default(""),
  OPENAI_API_KEY: z.string().default(""),
  RESEARCH_CACHE_DAYS: z.coerce.number().default(7),
});

const parsed = schema.parse(process.env);

export const config = {
  databaseUrl: parsed.DATABASE_URL,
  redisUrl: parsed.REDIS_URL,
  anthropicApiKey: parsed.ANTHROPIC_API_KEY,
  openaiApiKey: parsed.OPENAI_API_KEY,
  researchCacheDays: parsed.RESEARCH_CACHE_DAYS,
};
