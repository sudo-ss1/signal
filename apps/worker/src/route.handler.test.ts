import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@signal/shared", () => ({
  prisma: {
    score: { findUnique: vi.fn(async () => ({ score: 90, tier: "A", confidence: "high", reasoning: ["r"] })) },
    $queryRawUnsafe: vi.fn(async () => []),
    routingEvent: { upsert: vi.fn(async () => ({})), create: vi.fn() },
  },
}));

import { routeHandler } from "./route.js";
import { prisma } from "@signal/shared";

describe("routeHandler", () => {
  beforeEach(() => vi.clearAllMocks());

  it("upserts one routing event keyed on leadId, so re-runs don't duplicate", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    await routeHandler("lead-1");
    await routeHandler("lead-1");
    expect(prisma.routingEvent.create).not.toHaveBeenCalled();
    expect(prisma.routingEvent.upsert).toHaveBeenCalledTimes(2);
    for (const [arg] of vi.mocked(prisma.routingEvent.upsert).mock.calls) {
      expect(arg.where).toEqual({ leadId: "lead-1" });
      expect(arg.update.action).toBe("slack_alert");
    }
  });

  it("throws when the lead has no score", async () => {
    vi.mocked(prisma.score.findUnique).mockResolvedValueOnce(null);
    await expect(routeHandler("lead-x")).rejects.toThrow(/no score/);
  });
});
