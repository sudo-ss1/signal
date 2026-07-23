import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@signal/shared", () => ({
  prisma: {
    lead: {
      findUnique: vi.fn(async () => ({
        id: "lead-1",
        domain: "acme.com",
        status: "done",
        enriched: { industry: "B2B SaaS", techStack: ["Salesforce"] },
        research: { summary: "Growing." },
        score: { score: 82, tier: "A", reasoning: ["budget signal"], confidence: "high" },
        routing: [{ action: "slack_alert", payload: {} }],
      })),
    },
  },
  queues: {},
}));

import { buildServer } from "../server.js";

describe("GET /leads/:id", () => {
  beforeEach(() => vi.clearAllMocks());
  it("returns the full pipeline view", async () => {
    const app = await buildServer();
    const res = await app.inject({ method: "GET", url: "/leads/lead-1" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.score.tier).toBe("A");
    expect(body.enriched.industry).toBe("B2B SaaS");
  });
});
