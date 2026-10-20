import { describe, expect, it } from "vitest";
import { derivePlanningToolPlan } from "./planning-tool-plan";

describe("planning tool plan", () => {
  it("plans bounded grounding, routing, and discovery for a corridor", () => {
    expect(derivePlanningToolPlan({ type: "discover_places", date: "2026-10-30", categories: ["cafe"], geographicScope: "corridor", corridorReference: { originText: "福岡", destinationText: "小倉" } })).toEqual([
      { capability: "resolve_location", arguments: { text: "福岡" } },
      { capability: "resolve_location", arguments: { text: "小倉" } },
      { capability: "calculate_route", arguments: { mode: "driving" } },
      { capability: "discover_places", arguments: { date: "2026-10-30", geographicScope: "corridor", categories: ["cafe"], maxDetourMinutes: null } },
    ]);
  });

  it("does not grant a canonical mutation capability", () => {
    expect(derivePlanningToolPlan({ type: "repair_day", date: "2026-10-30" }).map((step) => step.capability)).toEqual(["inspect_itinerary", "propose_schedule_change"]);
    expect(derivePlanningToolPlan({ type: "repair_day", date: "2026-10-30", timeWindow: { start: "12:00", end: "18:00" }, preferences: { pace: "compact" } })).toEqual([
      { capability: "inspect_itinerary", arguments: { date: "2026-10-30", timeWindow: { start: "12:00", end: "18:00" } } },
      { capability: "propose_schedule_change", arguments: { intentType: "repair_day", timeWindow: { start: "12:00", end: "18:00" }, pace: "compact", targetItemId: null, targetStartTime: null } },
    ]);
  });
});
