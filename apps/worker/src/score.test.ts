import { describe, it, expect, vi } from "vitest";
import { scoreAccount } from "./score.js";

function fakeClient(result: unknown) {
  return {
    messages: {
      create: vi.fn(async () => ({
        content: [{ type: "tool_use", name: "emit_score", input: result }],
      })),
    },
  } as never;
}

describe("scoreAccount", () => {
  it("returns the structured tool output", async () => {
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

  it("throws if the model did not call the tool", async () => {
    const client = { messages: { create: vi.fn(async () => ({ content: [{ type: "text", text: "no" }] })) } } as never;
    await expect(scoreAccount(client, "icp", { techStack: [] }, "s")).rejects.toThrow(/tool/i);
  });
});
