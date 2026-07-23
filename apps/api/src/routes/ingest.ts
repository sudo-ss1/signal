import type { FastifyInstance } from "fastify";
import { prisma, queues, type RawLead } from "@signal/shared";

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
  await queues.enrich.add("enrich", { leadId: lead.id });
  return lead.id;
}

export async function ingestRoutes(app: FastifyInstance) {
  app.post<{ Body: RawLead }>("/ingest", async (req, reply) => {
    if (!req.body?.domain) return reply.code(400).send({ error: "domain required" });
    const leadId = await createLead({ ...req.body, receivedAt: new Date().toISOString() });
    return reply.code(202).send({ leadId });
  });

  app.post("/ingest/csv", { config: { rawBody: true } }, async (req, reply) => {
    const text = typeof req.body === "string" ? req.body : "";
    const lines = text.trim().split("\n");
    const header = lines[0].split(",").map((h) => h.trim());
    const ids: string[] = [];
    for (const line of lines.slice(1)) {
      const cols = line.split(",");
      const row = Object.fromEntries(header.map((h, i) => [h, cols[i]?.trim()]));
      if (!row.domain) continue;
      ids.push(
        await createLead({
          domain: row.domain,
          companyName: row.companyName,
          source: "csv",
          signalType: row.signalType as RawLead["signalType"],
          receivedAt: new Date().toISOString(),
        }),
      );
    }
    return reply.code(202).send({ leadIds: ids });
  });
}
