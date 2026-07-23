import { describe, it, expect } from "vitest";
import { waterfall, type EnrichmentProvider } from "./enrich.js";

const a: EnrichmentProvider = { async enrich() { return { industry: "SaaS", techStack: ["AWS"] }; } };
const b: EnrichmentProvider = { async enrich() { return { employeeCount: 120, techStack: ["GCP"] }; } };

describe("waterfall", () => {
  it("fills gaps from later providers without overwriting earlier ones", async () => {
    const out = await waterfall([a, b], "acme.com");
    expect(out.industry).toBe("SaaS");        // from a
    expect(out.employeeCount).toBe(120);       // filled by b
    expect(out.techStack).toEqual(["AWS"]);    // a wins on conflict
  });
});
