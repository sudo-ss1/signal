import { describe, it, expect } from "vitest";
import { decideAction } from "./route.js";

describe("decideAction", () => {
  it("tier A + high confidence → slack_alert (hot)", () => {
    expect(decideAction("A", "high")).toBe("slack_alert");
  });
  it("tier B → crm_push (nurture)", () => {
    expect(decideAction("B", "medium")).toBe("crm_push");
  });
  it("tier C → suppressed", () => {
    expect(decideAction("C", "medium")).toBe("suppressed");
  });
  it("disqualified → suppressed", () => {
    expect(decideAction("disqualified", "low")).toBe("suppressed");
  });
});
