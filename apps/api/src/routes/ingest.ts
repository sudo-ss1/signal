import type { FastifyInstance } from "fastify";
import { prisma, getQueue, rawLeadInputSchema, type RawLead } from "@signal/shared";
import { parseCsvRecords } from "../csv.js";

async function createLead(raw: RawLead): Promise<string> {
  const lead = await prisma.lead.create({
    data: {
      domain: raw.domain,
      companyName: raw.companyName ?? null,
      source: raw.source,
      signalType: raw.signalType ?? null,
      signalPayload: (raw.signalPayload ?? {}) as object,
      status: "queued",
    },
  });
  await getQueue("enrich").add("enrich", { leadId: lead.id });
  return lead.id;
}

// Structural type so the API needs no direct zod dependency.
function describe(err: { issues: { path: (string | number)[]; message: string }[] }): string[] {
  return err.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`);
}

export async function ingestRoutes(app: FastifyInstance) {
  app.post("/ingest", async (req, reply) => {
    const parsed = rawLeadInputSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid lead", details: describe(parsed.error) });
    }
    const leadId = await createLead({ ...parsed.data, receivedAt: new Date().toISOString() });
    return reply.code(202).send({ leadId });
  });

  // Body is the raw CSV text (Content-Type: text/csv). Header row required;
  // recognised columns: domain (required), companyName, signalType.
  // Valid rows are ingested; invalid rows are reported back, not dropped silently.
  app.post("/ingest/csv", async (req, reply) => {
    const text = typeof req.body === "string" ? req.body : "";
    let records: Record<string, string>[];
    try {
      records = parseCsvRecords(text);
    } catch (e) {
      return reply.code(400).send({ error: `malformed CSV: ${(e as Error).message}` });
    }
    if (records.length === 0) {
      return reply.code(400).send({ error: "CSV must have a header row and at least one data row" });
    }
    if (!("domain" in records[0])) {
      return reply.code(400).send({ error: "CSV header must include a 'domain' column" });
    }

    const leadIds: string[] = [];
    const errors: { row: number; details: string[] }[] = [];
    for (const [i, row] of records.entries()) {
      const parsed = rawLeadInputSchema.safeParse({
        domain: row.domain,
        companyName: row.companyName || undefined,
        source: "csv",
        signalType: row.signalType || undefined,
      });
      if (!parsed.success) {
        errors.push({ row: i + 2, details: describe(parsed.error) }); // +2: 1-based, after header
        continue;
      }
      leadIds.push(await createLead({ ...parsed.data, receivedAt: new Date().toISOString() }));
    }
    if (leadIds.length === 0) {
      return reply.code(400).send({ error: "no valid rows", leadIds, errors });
    }
    return reply.code(202).send({ leadIds, errors });
  });
}
