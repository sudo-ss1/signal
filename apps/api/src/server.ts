import Fastify, { type FastifyInstance } from "fastify";
import { ingestRoutes } from "./routes/ingest.js";

export async function buildServer(): Promise<FastifyInstance> {
  const app = Fastify({ logger: !process.env.VITEST });
  app.addContentTypeParser("text/csv", { parseAs: "string" }, (_req, body, done) =>
    done(null, body),
  );
  app.get("/health", async () => ({ ok: true }));
  await app.register(ingestRoutes);
  return app;
}
