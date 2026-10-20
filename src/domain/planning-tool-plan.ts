import type { PlanningIntent } from "./ai-planning";

export type PlanningCapability =
  | "resolve_location"
  | "discover_places"
  | "calculate_route"
  | "inspect_itinerary"
  | "propose_schedule_change";

export interface PlanningToolStep {
  capability: PlanningCapability;
  arguments: Record<string, unknown>;
}

/**
 * Converts an already validated intent into a bounded application plan.
 * This is descriptive orchestration: only existing application services may
 * execute these capabilities, and none grants canonical mutation authority.
 */
export function derivePlanningToolPlan(intent: PlanningIntent): PlanningToolStep[] {
  if (intent.type === "discover_places") {
    const locations = intent.corridorReference
      ? [intent.corridorReference.originText, intent.corridorReference.destinationText]
      : intent.geographicReference
        ? [intent.geographicReference.text]
        : [];
    return [
      ...locations.map((text) => ({ capability: "resolve_location" as const, arguments: { text } })),
      ...(intent.geographicScope === "corridor" ? [{ capability: "calculate_route" as const, arguments: { mode: intent.travelMode ?? "driving" } }] : []),
      { capability: "discover_places", arguments: { date: intent.date, geographicScope: intent.geographicScope ?? "trip_context", categories: intent.categories ?? [], maxDetourMinutes: intent.maxDetourMinutes ?? null } },
    ];
  }
  if (intent.type === "repair_day" || intent.type === "insert_candidate" || intent.type === "insert_candidates")
    return [
      { capability: "inspect_itinerary", arguments: { date: intent.date, ...(intent.type === "repair_day" && intent.timeWindow ? { timeWindow: intent.timeWindow } : {}) } },
      { capability: "propose_schedule_change", arguments: intent.type === "repair_day" ? { intentType: intent.type, timeWindow: intent.timeWindow ?? null, pace: intent.preferences?.pace ?? null, targetItemId: intent.targetItemId ?? null, targetStartTime: intent.targetStartTime ?? null } : { intentType: intent.type } },
    ];
  return [{ capability: "inspect_itinerary", arguments: intent.type === "explain_issues" ? { date: intent.date } : { proposalId: intent.proposalId } }];
}
