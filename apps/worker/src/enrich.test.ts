import { describe, it, expect } from "vitest";
import { waterfall, MockProvider, type EnrichmentProvider } from "./enrich.js";

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

describe("MockProvider", () => {
  it("returns seeded firmographics for a known domain", async () => {
    expect((await MockProvider.enrich("acme.com")).industry).toBe("B2B SaaS");
  });
  it("returns nothing for an unknown domain instead of inventing data", async () => {
    expect(await MockProvider.enrich("unknown-co.com")).toEqual({});
    expect(await waterfall([MockProvider], "unknown-co.com")).toEqual({ techStack: [] });
  });
});
