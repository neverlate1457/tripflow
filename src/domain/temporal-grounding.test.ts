import { describe, expect, it } from "vitest";
import { validateInterpretation, type AITripContext } from "./ai-planning";
import { groundTemporalExpression, temporalInterpretationFailure } from "./temporal-grounding";
import { implicitDiscoveryIntent } from "@/services/planning-ai-provider";
import { resolvePlanningEntities } from "@/services/planning-entity-resolution";

const context: AITripContext = {
  trip: { id: "trip", name: "QA", timezone: "Asia/Tokyo", startDate: "2026-10-24", endDate: "2026-10-31" },
  selectedDate: "2026-10-24",
  items: [],
  candidates: [
    { id: "a", title: "A", type: "place", estimatedDuration: 60 },
    { id: "b", title: "B", type: "place", estimatedDuration: 60 },
    { id: "c", title: "C", type: "place", estimatedDuration: 60 },
  ],
  issues: [],
  proposalIds: [],
};

describe("natural-language temporal grounding", () => {
  it.each([
    ["早上10點到晚上8點", "10:00", "20:00"],
    ["上午10點到下午6點", "10:00", "18:00"],
    ["10am to 8pm", "10:00", "20:00"],
    ["10 AM 到晚上 8 點", "10:00", "20:00"],
    ["10點到20點", "10:00", "20:00"],
    ["10:00 到 18:00", "10:00", "18:00"],
    ["下午2點到5點", "14:00", "17:00"],
    ["下午12點到6點", "12:00", "18:00"],
    ["晚上6點到10點", "18:00", "22:00"],
    ["今晚6點到10點", "18:00", "22:00"],
  ])("normalizes %s from explicit linguistic evidence", (message, start, end) => {
    expect(groundTemporalExpression(message, context)).toMatchObject({ status: "resolved", timeWindow: { start, end }, timezone: "Asia/Tokyo" });
  });

  it("requires clarification for an unqualified 12-hour range", () => {
    const result = groundTemporalExpression("10點到8點", context);
    expect(result).toMatchObject({ status: "ambiguous", reason: "unqualified_12_hour_range" });
    expect(temporalInterpretationFailure(result)?.status).toBe("clarification_required");
  });

  it("only propagates a leading daypart when it produces a valid same-day range", () => {
    expect(groundTemporalExpression("下午2點到5點", context)).toMatchObject({ status: "resolved", reason: "shared_leading_daypart" });
    expect(groundTemporalExpression("早上10點到8點", context)).toMatchObject({ status: "ambiguous", reason: "partial_daypart_inversion" });
  });

  it("truthfully rejects a cross-midnight window", () => {
    const result = groundTemporalExpression("晚上10點到凌晨2點", context);
    expect(result).toMatchObject({ status: "unsupported", reason: "cross_midnight_not_supported" });
    expect(temporalInterpretationFailure(result)).toMatchObject({ status: "unsupported" });
  });

  it("resolves relative dates from selected date while retaining the trip timezone", () => {
    expect(groundTemporalExpression("今天下午2點到5點", context).resolvedDate).toBe("2026-10-24");
    expect(groundTemporalExpression("明天早上9點到下午3點", context)).toMatchObject({ resolvedDate: "2026-10-25", timeWindow: { start: "09:00", end: "15:00" } });
    expect(groundTemporalExpression("後天早上9點到11點", context).resolvedDate).toBe("2026-10-26");
  });

  it("does not silently move an out-of-trip relative date onto the selected day", () => {
    const oneDay = { ...context, trip: { ...context.trip, endDate: context.selectedDate } },
      date = groundTemporalExpression("明天下午2點到5點", oneDay).resolvedDate;
    expect(date).toBe("2026-10-25");
    expect(() => validateInterpretation({ status: "resolved", intent: { type: "discover_places", date, timeWindow: { start: "14:00", end: "17:00" } } }, oneDay)).toThrow("INVALID_INTENT");
  });

  it("uses the same normalized window for discovery and canonical Candidate scheduling", () => {
    const discovery = implicitDiscoveryIntent("明天下午2點到5點由布院附近有什麼？", context)!;
    const scheduling = resolvePlanningEntities({ message: "把這三個地方排到明天下午2點到5點", context });
    expect(discovery).toMatchObject({ date: "2026-10-25", timeWindow: { start: "14:00", end: "17:00" } });
    expect(scheduling.deterministicInterpretation).toMatchObject({ status: "resolved", intent: { type: "insert_candidates", date: "2026-10-25", timeWindow: { start: "14:00", end: "17:00" } } });
  });

  it("does not interpret a detour duration as a clock range", () => {
    const result = groundTemporalExpression("大分到由布院路上找咖啡廳，最多繞路15分鐘", context);
    expect(result).toMatchObject({ status: "none" });
    expect(result.timeWindow).toBeUndefined();
  });
});
