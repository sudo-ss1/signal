import { describe, it, expect } from "vitest";
import { buildStubSummary } from "./research.js";

describe("buildStubSummary", () => {
  it("mentions industry and funding stage", () => {
    const s = buildStubSummary({ industry: "B2B SaaS", fundingStage: "Series B", techStack: ["Salesforce"] });
    expect(s).toContain("B2B SaaS");
    expect(s).toContain("Series B");
  });
});
