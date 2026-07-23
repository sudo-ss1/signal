import { describe, it, expect, vi } from "vitest";
import { scoreAccount, clampScore } from "./score.js";

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
    const out = await scoreAccount(client, "B2B SaaS", { techStack: [] }, "summary");
    expect(out.tier).toBe("A");
    expect(out.score).toBe(82);
    expect(out.reasoning).toHaveLength(2);
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
    await expect(scoreAccount(client, "icp", { techStack: [] }, "s")).rejects.toThrow();
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
