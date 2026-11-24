import { describe, it, expect, afterEach, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("queues", () => {
  it("has ordered stages ending at route", async () => {
    const { STAGES } = await import("./queues.js");
    expect(STAGES[0]).toBe("enrich");
    expect(STAGES[STAGES.length - 1]).toBe("route");
  });
  it("nextStage returns null after the last stage", async () => {
    const { nextStage } = await import("./queues.js");
    expect(nextStage("route")).toBeNull();
    expect(nextStage("enrich")).toBe("research");
  });
  it("getQueue memoizes per stage", async () => {
    vi.stubEnv("DATABASE_URL", "postgresql://x");
    vi.stubEnv("REDIS_URL", "redis://localhost:6380");
    const { getQueue, closeQueues } = await import("./queues.js");
    expect(getQueue("enrich")).toBe(getQueue("enrich"));
    expect(getQueue("enrich")).not.toBe(getQueue("score"));
    await closeQueues();
  });
});

describe("side-effect-free import", () => {
  it("importing the barrel does not parse env", async () => {
    vi.stubEnv("DATABASE_URL", "");
    vi.stubEnv("REDIS_URL", "");
    await expect(import("./index.js")).resolves.toBeDefined();
  });
  it("getConfig throws a clear error when required env is missing", async () => {
    vi.stubEnv("DATABASE_URL", "");
    vi.stubEnv("REDIS_URL", "");
    const { getConfig } = await import("./config.js");
    expect(() => getConfig()).toThrow(/DATABASE_URL|REDIS_URL/);
  });
});
