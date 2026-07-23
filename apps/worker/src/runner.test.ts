import { describe, it, expect } from "vitest";
import { nextStage, STAGES } from "@signal/shared";

describe("runner stage wiring", () => {
  it("advances every non-final stage to a valid next stage", () => {
    for (const s of STAGES.slice(0, -1)) {
      const n = nextStage(s);
      expect(n).not.toBeNull();
      expect(STAGES).toContain(n!);
    }
  });
});
