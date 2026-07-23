import { describe, it, expect, afterAll } from "vitest";
import { STAGES, nextStage, queues } from "./queues.js";

describe("queues", () => {
  it("has ordered stages ending at route", () => {
    expect(STAGES[0]).toBe("enrich");
    expect(STAGES[STAGES.length - 1]).toBe("route");
  });
  it("nextStage returns null after the last stage", () => {
    expect(nextStage("route")).toBeNull();
    expect(nextStage("enrich")).toBe("research");
  });
});

// Importing queues.ts instantiates BullMQ Queue objects, which open Redis
// connections at module-load time. Close them so the test process exits
// cleanly with no open handles.
afterAll(async () => {
  await Promise.all(Object.values(queues).map((q) => q.close()));
});
