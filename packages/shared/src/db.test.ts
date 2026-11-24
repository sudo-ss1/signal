import { describe, it, expect } from "vitest";
import { prisma } from "./db.js";

// Integration test: needs the docker-compose Postgres and DATABASE_URL (loaded
// from the repo-root .env by vitest.config.ts). Skipped when it isn't set so
// the unit suite runs without infrastructure.
describe.skipIf(!process.env.DATABASE_URL)("db (integration)", () => {
  it("connects and can count leads", async () => {
    const count = await prisma.lead.count();
    expect(typeof count).toBe("number");
  });
});
