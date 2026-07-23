import { describe, it, expect } from "vitest";
import { buildEmbedText } from "./embed.js";

describe("buildEmbedText", () => {
  it("combines firmographics and research summary", () => {
    const t = buildEmbedText({ industry: "B2B SaaS", fundingStage: "Series B", techStack: ["Salesforce"] }, "Growing fast.");
    expect(t).toContain("B2B SaaS");
    expect(t).toContain("Salesforce");
    expect(t).toContain("Growing fast.");
  });
});
