import { describe, expect, it } from "vitest";
import { buildAIContext, validateInterpretation } from "@/domain/ai-planning";
import { demoCandidates, demoItems, demoTrip } from "@/data/demo-trip";
import { describeDiscoverySemanticContradiction, normalizePlanningProviderInterpretation, removeInventedDiscoveryConstraints } from "./planning-ai-provider";

const context = buildAIContext(demoTrip, demoItems, demoCandidates, "2026-10-26");
const cases = [
  ["Chinese nearby", "博多附近找咖啡廳", { type: "discover_places", date: "2026-10-26", categories: ["cafe"], geographicReference: { text: "博多" }, geographicScope: "nearby_point" }],
  ["Japanese city", "京都で博物館を探して", { type: "discover_places", date: "2026-10-26", categories: ["museum"], geographicReference: { text: "京都" }, geographicScope: "city_area" }],
  ["English corridor", "Find cafes between Fukuoka and Kokura", { type: "discover_places", date: "2026-10-26", categories: ["cafe"], corridorReference: { originText: "Fukuoka", destinationText: "Kokura" }, geographicScope: "corridor" }],
  ["trip context", "What can I do nearby?", { type: "discover_places", date: "2026-10-26", categories: [], geographicScope: "trip_context" }],
  ["schedule", "Make this day relaxed", { type: "repair_day", date: "2026-10-26", preferences: { pace: "relaxed" } }],
] as const;

describe("LLM-first semantic evaluation contract", () => {
  it.each(cases)("accepts a validated %s interpretation without rewriting it", (_label, message, intent) => {
    const raw = { status: "resolved", intent };
    const normalized = normalizePlanningProviderInterpretation(raw, { message, context }, "ollama");
    expect(normalized).toBe(raw);
    expect(validateInterpretation(normalized, context)).toMatchObject({ status: "resolved", intent });
  });

  it("keeps provider ambiguity non-canonical", () => {
    expect(validateInterpretation({ status: "clarification_required", question: "Which location did you mean?" }, context)).toEqual({ status: "clarification_required", question: "Which location did you mean?" });
  });

  it("rejects unsupported mutation intents", () => {
    expect(() => validateInterpretation({ status: "resolved", intent: { type: "delete_item", itemId: "x" } }, context)).toThrow();
  });

  it.each(["Sapporo", "Oita", "Fukuoka"])("flags cross-city discovery rejection independently of a %s trip", (tripName) => {
    const tripContext = { ...context, trip: { ...context.trip, name: `${tripName} trip` } };
    expect(describeDiscoverySemanticContradiction({ status: "unsupported", reason: "outside trip" }, { message: "推薦宮崎市景點", context: tripContext })).toContain("Explicit geography may be outside");
    expect(describeDiscoverySemanticContradiction({ status: "resolved", intent: { type: "discover_places", date: tripContext.selectedDate, categories: ["attraction"], geographicScope: "city_area", geographicReference: { text: "宮崎市" } } }, { message: "推薦宮崎市景點", context: tripContext })).toBeNull();
  });

  it("reports geography and category loss together for Miyazaki structured repair", () => {
    const issue = describeDiscoverySemanticContradiction(
      { status: "resolved", intent: { type: "discover_places", date: context.selectedDate, geographicReference: { text: "宮崎市" } } },
      { message: "找宮崎市景點", context },
    );
    expect(issue).toContain("geographicScope=city_area");
    expect(issue).toContain('["attraction"]');
    expect(describeDiscoverySemanticContradiction(
      { status: "resolved", intent: { type: "discover_places", date: context.selectedDate, categories: ["attraction"], geographicScope: "city_area", geographicReference: { text: "宮崎市" } } },
      { message: "推薦宮崎市景點", context },
    )).toBeNull();
  });

  it("preserves a provider corridor when heuristic preprocessing mistakes the route phrase for one city", () => {
    const message = "找福岡到小倉的咖啡廳";
    const validCorridor = { status: "resolved", intent: { type: "discover_places", date: context.selectedDate, categories: ["cafe"], geographicScope: "corridor", corridorReference: { originText: "福岡", destinationText: "小倉" } } };
    expect(describeDiscoverySemanticContradiction(validCorridor, { message, context })).toBeNull();
    const malformed = { status: "resolved", intent: { type: "discover_places", date: context.selectedDate, geographicScope: "corridor", geographicReference: { text: "福岡から小倉" } } };
    const issue = describeDiscoverySemanticContradiction(malformed, { message, context });
    expect(issue).toContain("two distinct corridorReference endpoints");
    expect(issue).toContain("remove geographicReference");
    expect(issue).toContain('["cafe"]');
  });

  it("rejects corridor endpoints that are absent, duplicated, or invented relative to the original request", () => {
    const message = "找福岡到小倉的咖啡廳";
    for (const corridorReference of [
      { originText: "福岡", destinationText: "福岡" },
      { originText: "福岡", destinationText: "大阪" },
    ]) expect(describeDiscoverySemanticContradiction(
      { status: "resolved", intent: { type: "discover_places", date: context.selectedDate, categories: ["cafe"], geographicScope: "corridor", corridorReference } },
      { message, context },
    )).toContain("copied from the original user request");
  });

  it.each([
    ["推薦宮崎縣景點", "宮崎縣", "city_area", "attraction"],
    ["Find cafes near Hakata Station", "Hakata Station", "nearby_point", "cafe"],
  ] as const)("preserves explicit geography for %s", (message, reference, scope, category) => {
    const resolved = { status: "resolved", intent: { type: "discover_places", date: context.selectedDate, categories: [category], geographicScope: scope, geographicReference: { text: reference } } };
    expect(describeDiscoverySemanticContradiction(resolved, { message, context })).toBeNull();
    expect(describeDiscoverySemanticContradiction({ status: "unsupported", reason: "outside trip" }, { message, context })).toContain("Explicit geography may be outside");
  });

  it("requires unnamed nearby discovery to retain trip-context fallback semantics", () => {
    expect(describeDiscoverySemanticContradiction({ status: "resolved", intent: { type: "discover_places", date: context.selectedDate, categories: ["attraction"], geographicScope: "city_area", geographicReference: { text: "Sapporo" } } }, { message: "推薦附近景點", context })).toContain("named no geography");
    expect(describeDiscoverySemanticContradiction({ status: "resolved", intent: { type: "discover_places", date: context.selectedDate, categories: ["attraction"], geographicScope: "trip_context" } }, { message: "推薦附近景點", context })).toBeNull();
    expect(describeDiscoverySemanticContradiction({ status: "clarification_required", question: "Where?" }, { message: "推薦附近景點", context })).toContain("geographicScope=trip_context");
  });

  it("does not convert explicit scheduling language into discovery", () => {
    expect(describeDiscoverySemanticContradiction({ status: "unsupported", reason: "Direct mutation unsupported" }, { message: "把宮崎景點排進今天", context }, true)).toBeNull();
  });

  it("removes only model-invented optional discovery constraints", () => {
    const raw = { status: "resolved", intent: { type: "discover_places", date: context.selectedDate, categories: ["attraction"], geographicScope: "trip_context", timeWindow: { start: "09:00", end: "22:00" }, durationMinutes: 120 } };
    expect(removeInventedDiscoveryConstraints(raw, { message: "推薦附近景點", context })).toEqual({ status: "resolved", intent: { type: "discover_places", date: context.selectedDate, categories: ["attraction"], geographicScope: "trip_context" } });
    const timed = { ...raw, intent: { ...raw.intent, timeWindow: { start: "12:00", end: "18:00" } } };
    expect(removeInventedDiscoveryConstraints(timed, { message: "下午推薦附近景點", context })).toMatchObject({ intent: { timeWindow: { start: "12:00", end: "18:00" } } });
  });
});
