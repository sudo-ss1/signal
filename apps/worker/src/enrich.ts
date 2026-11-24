import { prisma, type EnrichedAccountData } from "@signal/shared";

export interface EnrichmentProvider {
  enrich(domain: string): Promise<Partial<EnrichedAccountData>>;
}

const REQUIRED: (keyof EnrichedAccountData)[] = ["employeeCount", "industry"];

export async function waterfall(
  providers: EnrichmentProvider[],
  domain: string,
): Promise<EnrichedAccountData> {
  const merged: Partial<EnrichedAccountData> = {};
  for (const p of providers) {
    if (REQUIRED.every((k) => merged[k] != null)) break;
    const part = await p.enrich(domain);
    for (const [k, v] of Object.entries(part)) {
      if (merged[k as keyof EnrichedAccountData] == null && v != null) {
        (merged as Record<string, unknown>)[k] = v;
      }
    }
  }
  return { techStack: [], ...merged } as EnrichedAccountData;
}

// Seeded mock firmographics keyed by domain. Unknown domains return nothing:
// fabricating the same "plausible default" for every domain made unrelated
// companies indistinguishable to the scorer. Missing fields are flagged to the
// scorer instead (see missingFields in score.ts).
const SEED: Record<string, EnrichedAccountData> = {
  "acme.com": {
    employeeCount: 220, industry: "B2B SaaS",
    techStack: ["Salesforce", "AWS", "Segment"], fundingStage: "Series B",
    hqLocation: "San Francisco, CA",
  },
  "northwind.io": {
    employeeCount: 120, industry: "B2B SaaS",
    techStack: ["HubSpot", "GCP"], fundingStage: "Series A",
    hqLocation: "Austin, TX",
  },
  "brightbakery.com": {
    employeeCount: 35, industry: "Food & Beverage Retail",
    techStack: ["Shopify", "Square"], fundingStage: "Bootstrapped",
    hqLocation: "Portland, OR",
  },
};

export const MockProvider: EnrichmentProvider = {
  async enrich(domain) {
    return SEED[domain] ?? {};
  },
};

export async function enrichHandler(leadId: string): Promise<void> {
  const lead = await prisma.lead.findUniqueOrThrow({ where: { id: leadId } });
  const data = await waterfall([MockProvider], lead.domain);
  await prisma.enrichedAccount.upsert({
    where: { leadId },
    create: { leadId, ...data },
    update: { ...data },
  });
}
