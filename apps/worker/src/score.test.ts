import { describe, it, expect, vi } from "vitest";
import { scoreAccount, clampScore, buildScoringPrompt, missingFields } from "./score.js";

const LEAD = { domain: "acme.com", companyName: "Acme Corp", signalType: "funding" };

function fakeClient(result: unknown) {
  return {
    chat: {
      completions: {
        create: vi.fn(async () => ({
          choices: [{ message: { content: JSON.stringify(result) } }],
        })),
      },
    },
  } as never;
}

describe("scoreAccount", () => {
  it("returns the structured JSON schema output", async () => {
    const client = fakeClient({
      score: 82, tier: "A",
      reasoning: ["Series B budget signal", "RevOps hire = tooling gap"],
      confidence: "high",
    });
    const out = await scoreAccount(client, "B2B SaaS", LEAD, { techStack: [] }, "summary");
    expect(out.tier).toBe("A");
    expect(out.score).toBe(82);
    expect(out.reasoning).toHaveLength(2);
  });

  it("requests strict structured output from gpt-6-luna by default, without temperature", async () => {
    const client = fakeClient({ score: 50, tier: "C", reasoning: ["x"], confidence: "low" });
    await scoreAccount(client, "icp", LEAD, { techStack: [] }, "s");
    const req = (client as any).chat.completions.create.mock.calls[0][0];
    expect(req.model).toBe("gpt-6-luna");
    expect(req).not.toHaveProperty("temperature"); // gpt-6-luna rejects non-default values
    expect(req.response_format.json_schema.strict).toBe(true);
  });

  it("uses the model it is given", async () => {
    const client = fakeClient({ score: 50, tier: "C", reasoning: ["x"], confidence: "low" });
    await scoreAccount(client, "icp", LEAD, { techStack: [] }, "s", "gpt-4o-mini");
    expect((client as any).chat.completions.create.mock.calls[0][0].model).toBe("gpt-4o-mini");
  });

  it("throws if the model refused or returned no content", async () => {
    const client = {
      chat: {
        completions: {
          create: vi.fn(async () => ({
            choices: [{ message: { content: null, refusal: "cannot" } }],
          })),
        },
      },
    } as never;
    await expect(scoreAccount(client, "icp", LEAD, { techStack: [] }, "s")).rejects.toThrow();
  });
});

describe("clampScore", () => {
  it("rounds half up to an integer", () => {
    expect(clampScore(87.5)).toBe(88);
  });

  it("rounds down below the half boundary", () => {
    expect(clampScore(87.4)).toBe(87);
  });

  it("clamps values above 100 to 100", () => {
    expect(clampScore(120)).toBe(100);
  });

  it("clamps negative values to 0", () => {
    expect(clampScore(-5)).toBe(0);
  });
});

describe("buildScoringPrompt", () => {
  it("includes the lead's identity and inbound signal", () => {
    const p = buildScoringPrompt("ICP", { ...LEAD, signalPayload: { round: "Series B" } }, { techStack: [] }, "s");
    expect(p).toContain("Acme Corp");
    expect(p).toContain("acme.com");
    expect(p).toContain("funding");
    expect(p).toContain("Series B");
  });

  it("flags missing firmographics to the scorer", () => {
    const p = buildScoringPrompt("ICP", LEAD, { industry: "B2B SaaS", techStack: [] }, "");
    expect(p).toMatch(/Missing firmographics: employeeCount, fundingStage, techStack/);
  });

  it("says none when nothing is missing", () => {
    expect(missingFields({ employeeCount: 1, industry: "x", fundingStage: "y", techStack: ["z"] })).toEqual([]);
  });
});

