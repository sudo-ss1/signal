import OpenAI from "openai";
import { prisma, config } from "@signal/shared";
import { embedText, toVectorLiteral } from "../apps/worker/src/embeddings-client.js";

const ACCOUNTS = [
  { companyName: "Acme Corp", firmographics: { employeeCount: 240, industry: "B2B SaaS", fundingStage: "Series C" },
    sourceText: "B2B SaaS, 240 employees, Series C, uses Salesforce and Segment, RevOps-heavy GTM." },
  { companyName: "Globex", firmographics: { employeeCount: 130, industry: "B2B SaaS", fundingStage: "Series B" },
    sourceText: "B2B SaaS, 130 employees, Series B, Salesforce shop, expanding sales team." },
  { companyName: "Initech", firmographics: { employeeCount: 90, industry: "Fintech SaaS", fundingStage: "Series A" },
    sourceText: "Fintech SaaS, 90 employees, Series A, modern data stack, hiring RevOps." },
];

const openai = new OpenAI({ apiKey: config.openaiApiKey });

for (const a of ACCOUNTS) {
  const vec = await embedText(openai, a.sourceText);
  const id = crypto.randomUUID();
  await prisma.$executeRawUnsafe(
    `INSERT INTO closed_won_accounts (id, company_name, firmographics, source_text, embedding)
     VALUES ($1, $2, $3::jsonb, $4, $5::vector)`,
    id, a.companyName, JSON.stringify(a.firmographics), a.sourceText, toVectorLiteral(vec),
  );
  console.log(`seeded ${a.companyName}`);
}
await prisma.$disconnect();
