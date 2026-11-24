import type { FastifyInstance } from "fastify";
import { prisma } from "@signal/shared";

export async function leadsRoutes(app: FastifyInstance) {
  app.get<{ Params: { id: string } }>("/leads/:id", async (req, reply) => {
    const lead = await prisma.lead.findUnique({
      where: { id: req.params.id },
      include: { enriched: true, research: true, score: true, routing: true },
    });
    if (!lead) return reply.code(404).send({ error: "not found" });
    const { enriched, research, score, routing, ...rest } = lead;
    // At most one routing event per lead (re-routing replaces it). Kept as an
    // array in the response so the API shape is unchanged.
    return { lead: rest, enriched, research, score, routing: routing ? [routing] : [] };
  });
}
