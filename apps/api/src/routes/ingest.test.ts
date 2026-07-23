import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@signal/shared", () => ({
  prisma: { lead: { create: vi.fn(async () => ({ id: "lead-1" })) } },
  queues: { enrich: { add: vi.fn(async () => ({})) } },
}));

import { buildServer } from "../server.js";
import { prisma, queues } from "@signal/shared";

describe("POST /ingest", () => {
  beforeEach(() => vi.clearAllMocks());

  it("creates a lead and enqueues enrich", async () => {
    const app = await buildServer();
    const res = await app.inject({
      method: "POST",
      url: "/ingest",
      payload: { domain: "acme.com", source: "webhook", signalType: "funding" },
    });
    expect(res.statusCode).toBe(202);
    expect(res.json()).toEqual({ leadId: "lead-1" });
    expect(prisma.lead.create).toHaveBeenCalledOnce();
    expect(queues.enrich.add).toHaveBeenCalledWith("enrich", { leadId: "lead-1" });
  });

  it("rejects missing domain", async () => {
    const app = await buildServer();
    const res = await app.inject({ method: "POST", url: "/ingest", payload: { source: "webhook" } });
    expect(res.statusCode).toBe(400);
  });
});
