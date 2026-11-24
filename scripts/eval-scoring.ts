// Scoring eval (Phase 2 design §5): runs scoreAccount against a labeled golden
// set of synthetic accounts and reports expected vs. actual tier, plus how
// stable the tier is across repeated runs. Hits the live OpenAI API; not part
// of the unit gate. Usage: pnpm eval [runsPerCase=3]
import OpenAI from "openai";
import { getConfig, type EnrichedAccountData, type Tier } from "@signal/shared";
import { scoreAccount, DEFAULT_ICP, type LeadContext } from "../apps/worker/src/score.js";
import { buildStubSummary } from "../apps/worker/src/research.js";

interface Case {
  lead: LeadContext;
  enriched: EnrichedAccountData;
  expected: Tier[]; // acceptable tiers
}

const GOLDEN: Case[] = [
  { lead: { domain: "acme.com", companyName: "Acme Corp", signalType: "funding" },
    enriched: { employeeCount: 220, industry: "B2B SaaS", techStack: ["Salesforce", "AWS"], fundingStage: "Series B" },
    expected: ["A"] },
  { lead: { domain: "ledgerly.io", companyName: "Ledgerly", signalType: "job_posting" },
    enriched: { employeeCount: 75, industry: "B2B SaaS", techStack: ["Salesforce"], fundingStage: "Series A" },
    expected: ["A"] },
  { lead: { domain: "northwind.io", companyName: "Northwind", signalType: "form_fill" },
    enriched: { employeeCount: 120, industry: "B2B SaaS", techStack: ["HubSpot", "GCP"], fundingStage: "Series A" },
    expected: ["B"] },
  { lead: { domain: "bigco.com", companyName: "BigCo", signalType: "tech_change" },
    enriched: { employeeCount: 900, industry: "B2B SaaS", techStack: ["Salesforce"], fundingStage: "Series D" },
    expected: ["B", "C"] },
  { lead: { domain: "seedly.app", companyName: "Seedly", signalType: "form_fill" },
    enriched: { employeeCount: 25, industry: "B2B SaaS", techStack: ["Salesforce"], fundingStage: "Seed" },
    expected: ["B", "C"] },
  { lead: { domain: "unknown-co.com", companyName: "Unknown Co" },
    enriched: { techStack: [] },
    expected: ["C"] },
  { lead: { domain: "nasa.gov", companyName: "NASA", signalType: "job_posting" },
    enriched: { techStack: [] },
    expected: ["disqualified"] },
  { lead: { domain: "brightbakery.com", companyName: "Bright Bakery", signalType: "form_fill" },
    enriched: { employeeCount: 35, industry: "Food & Beverage Retail", techStack: ["Shopify"], fundingStage: "Bootstrapped" },
    expected: ["disqualified"] },
  { lead: { domain: "cityhall.gov", companyName: "City of Springfield", signalType: "job_posting" },
    enriched: { employeeCount: 3000, industry: "Government", techStack: ["Oracle"], fundingStage: "Public sector" },
    expected: ["disqualified"] },
];

const runs = Number(process.argv[2] ?? 3);
const { openaiApiKey, scoringModel } = getConfig();
const client = new OpenAI({ apiKey: openaiApiKey });

let matches = 0, total = 0, unstable = 0;
const scores: number[] = [];
console.log(`Model: ${scoringModel}\nICP: ${DEFAULT_ICP}\nRuns per case: ${runs}\n`);
console.log("company".padEnd(22) + "expected".padEnd(16) + "actual (per run)".padEnd(46) + "scores".padEnd(18) + "ok");
for (const c of GOLDEN) {
  const results = [];
  for (let i = 0; i < runs; i++) {
    results.push(await scoreAccount(client, DEFAULT_ICP, c.lead, c.enriched, buildStubSummary(c.enriched), scoringModel));
  }
  const tiers = results.map((r) => `${r.tier}/${r.confidence[0]}`);
  const ok = results.filter((r) => c.expected.includes(r.tier)).length;
  matches += ok; total += results.length;
  if (new Set(results.map((r) => r.tier)).size > 1) unstable++;
  scores.push(...results.map((r) => Math.round(r.score)));
  console.log(
    (c.lead.companyName ?? c.lead.domain).padEnd(22) +
    c.expected.join("|").padEnd(16) +
    tiers.join(" ").padEnd(46) +
    results.map((r) => Math.round(r.score)).join(",").padEnd(18) +
    `${ok}/${runs}`,
  );
}
scores.sort((a, b) => a - b);
console.log(`\nTier agreement: ${matches}/${total} (${Math.round((100 * matches) / total)}%)`);
console.log(`Cases with an unstable tier across runs: ${unstable}/${GOLDEN.length}`);
console.log(`Score distribution: min ${scores[0]}, median ${scores[Math.floor(scores.length / 2)]}, max ${scores[scores.length - 1]}`);
