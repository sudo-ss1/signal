import { describe, it, expect } from "vitest";
import { prisma } from "./db.js";

describe("db", () => {
  it("connects and can count leads", async () => {
    const count = await prisma.lead.count();
    expect(typeof count).toBe("number");
  });
});
