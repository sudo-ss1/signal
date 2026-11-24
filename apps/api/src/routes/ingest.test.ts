import { describe, it, expect, vi, beforeEach } from "vitest";

const add = vi.fn(async () => ({}));
let nextId = 0;

// Keep the real validation schema; stub only the DB and queue I/O.
vi.mock("@signal/shared", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@signal/shared")>();
  return {
    ...actual,
    prisma: { lead: { create: vi.fn(async () => ({ id: `lead-${++nextId}` })) } },
    getQueue: vi.fn(() => ({ add })),
  };
});

import { buildServer } from "../server.js";
import { prisma, getQueue } from "@signal/shared";

const csv = (body: string) => ({
  method: "POST" as const,
  url: "/ingest/csv",
  headers: { "content-type": "text/csv" },
  payload: body,
});

describe("POST /ingest", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    nextId = 0;
  });

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
    expect(getQueue).toHaveBeenCalledWith("enrich");
    expect(add).toHaveBeenCalledWith("enrich", { leadId: "lead-1" });
  });

  it("normalizes the domain to lowercase", async () => {
    const app = await buildServer();
    await app.inject({ method: "POST", url: "/ingest", payload: { domain: " Acme.COM ", source: "webhook" } });
    expect(vi.mocked(prisma.lead.create).mock.calls[0][0].data.domain).toBe("acme.com");
  });

  it.each([
    ["missing domain", { source: "webhook" }],
    ["missing source", { domain: "acme.com" }],
    ["unknown source", { domain: "acme.com", source: "carrier-pigeon" }],
    ["unknown signalType", { domain: "acme.com", source: "webhook", signalType: "astrology" }],
    ["non-string domain", { domain: 123, source: "webhook" }],
    ["URL instead of domain", { domain: "https://acme.com/x", source: "webhook" }],
  ])("rejects %s with 400 and no DB write", async (_name, payload) => {
    const app = await buildServer();
    const res = await app.inject({ method: "POST", url: "/ingest", payload });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("invalid lead");
    expect(res.json().details.length).toBeGreaterThan(0);
    expect(prisma.lead.create).not.toHaveBeenCalled();
  });
});

describe("POST /ingest/csv", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    nextId = 0;
  });

  it("ingests each valid row", async () => {
    const app = await buildServer();
    const res = await app.inject(csv("domain,companyName,signalType\nglobex.com,Globex,job_posting\ninitech.com,Initech,\n"));
    expect(res.statusCode).toBe(202);
    expect(res.json()).toEqual({ leadIds: ["lead-1", "lead-2"], errors: [] });
  });

  it("keeps quoted commas inside a field", async () => {
    const app = await buildServer();
    await app.inject(csv('domain,companyName,signalType\nquoted.com,"Acme, Inc",funding\n'));
    const data = vi.mocked(prisma.lead.create).mock.calls[0][0].data;
    expect(data.companyName).toBe("Acme, Inc");
    expect(data.signalType).toBe("funding");
  });

  it("reports invalid rows with their line number and ingests the rest", async () => {
    const app = await buildServer();
    const res = await app.inject(csv("domain,signalType\nok.com,funding\nbad.com,astrology\n,funding\n"));
    expect(res.statusCode).toBe(202);
    const body = res.json();
    expect(body.leadIds).toEqual(["lead-1"]);
    expect(body.errors.map((e: { row: number }) => e.row)).toEqual([3, 4]);
  });

  it.each([
    ["empty body", ""],
    ["header only", "domain,companyName\n"],
    ["no domain column", "company\nAcme\n"],
    ["unterminated quote", 'domain,companyName\nacme.com,"Acme\n'],
    ["only invalid rows", "domain\nnot a domain\n"],
  ])("rejects %s with 400", async (_name, body) => {
    const app = await buildServer();
    const res = await app.inject(csv(body));
    expect(res.statusCode).toBe(400);
    expect(prisma.lead.create).not.toHaveBeenCalled();
  });
});
