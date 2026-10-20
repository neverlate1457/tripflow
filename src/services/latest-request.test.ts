import { describe, expect, it } from "vitest";
import { LatestRequestGate } from "./latest-request";

describe("LatestRequestGate", () => {
  it("rejects an out-of-order response after a newer request begins", () => {
    const gate = new LatestRequestGate();
    const first = gate.begin();
    const second = gate.begin();
    expect(gate.isCurrent(first)).toBe(false);
    expect(gate.isCurrent(second)).toBe(true);
  });

  it("invalidates an in-flight request when the user cancels", () => {
    const gate = new LatestRequestGate();
    const request = gate.begin();
    gate.invalidate();
    expect(gate.isCurrent(request)).toBe(false);
  });

  it("keeps discovery and clarification work correlated to the same current request", () => {
    const gate = new LatestRequestGate();
    const request = gate.begin();
    expect(gate.current()).toBe(request);
    expect(gate.isCurrent(request)).toBe(true);
  });
});
