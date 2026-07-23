import { describe, it, expect, vi } from "vitest";
import { embedText, toVectorLiteral } from "./embeddings-client.js";

describe("embeddings", () => {
  it("returns the embedding vector from the client", async () => {
    const client = {
      embeddings: { create: vi.fn(async () => ({ data: [{ embedding: [0.1, 0.2, 0.3] }] })) },
    } as never;
    const v = await embedText(client, "acme");
    expect(v).toEqual([0.1, 0.2, 0.3]);
  });

  it("formats a pgvector literal", () => {
    expect(toVectorLiteral([0.1, 0.2])).toBe("[0.1,0.2]");
  });
});
