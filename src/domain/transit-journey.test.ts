import { describe, expect, it } from "vitest";
import {
  inspectTransitJourney,
  validateTransitJourney,
  validateTransitJourneyRequest,
  validateTransitJourneyResult,
  type TransitJourney,
  type TransitJourneyLeg,
} from "./transit-journey";
import { resolveEffectiveDuration, type NormalizedRoute } from "./routing";

const coordinate = (latitude: number, longitude: number) => ({ latitude, longitude });
const stop = (name: string, latitude: number, longitude: number) => ({
  name,
  coordinates: coordinate(latitude, longitude),
  provider: "test-provider",
  providerStopId: `stop-${name}`,
});
const walk = (departureTime: string, arrivalTime: string): TransitJourneyLeg => ({
  type: "walk",
  origin: coordinate(25.0478, 121.517),
  destination: coordinate(25.048, 121.518),
  departureTime,
  arrivalTime,
  durationSeconds: (Date.parse(arrivalTime) - Date.parse(departureTime)) / 1000,
  distanceMeters: 350,
});
const vehicle = (
  mode: "bus" | "metro" | "rail",
  departureTime: string,
  arrivalTime: string,
  from = "A",
  to = "B",
): TransitJourneyLeg => ({
  type: "transit",
  mode,
  boardingStop: stop(from, 25.048, 121.518),
  alightingStop: stop(to, 25.033, 121.565),
  departureTime,
  arrivalTime,
  durationSeconds: (Date.parse(arrivalTime) - Date.parse(departureTime)) / 1000,
  routeName: mode === "bus" ? "R30" : "Red Line",
});
const journey = (
  kind: TransitJourney["evidence"]["kind"] = "scheduled",
  legs: TransitJourneyLeg[] = [vehicle("rail", "2026-10-24T13:00:00+08:00", "2026-10-24T13:30:00+08:00")],
): TransitJourney => ({
  id: `result-${kind}`,
  departureTime: legs[0].departureTime,
  arrivalTime: legs.at(-1)!.arrivalTime,
  durationSeconds: (Date.parse(legs.at(-1)!.arrivalTime) - Date.parse(legs[0].departureTime)) / 1000,
  transfers: Math.max(0, legs.filter((leg) => leg.type === "transit").length - 1),
  legs,
  evidence: {
    kind,
    provider: "test-provider",
    retrievedAt: "2026-10-20T01:00:00Z",
    ...(kind === "realtime_adjusted" ? { realtimeUpdatedAt: "2026-10-20T00:59:00Z" } : {}),
  },
});

describe("TransitJourney domain boundary", () => {
  it.each(["scheduled", "realtime_adjusted", "estimated"] as const)("validates %s evidence", (kind) => {
    const value = validateTransitJourney(journey(kind));
    expect(inspectTransitJourney(value)).toEqual({
      departureTime: value.departureTime,
      arrivalTime: value.arrivalTime,
      effectiveScheduledDurationSeconds: value.durationSeconds,
      evidenceKind: kind,
    });
  });

  it("represents walk + train + walk without provider payloads", () => {
    const value = journey("scheduled", [
      walk("2026-10-24T13:00:00+08:00", "2026-10-24T13:05:00+08:00"),
      vehicle("rail", "2026-10-24T13:08:00+08:00", "2026-10-24T13:28:00+08:00"),
      walk("2026-10-24T13:28:00+08:00", "2026-10-24T13:35:00+08:00"),
    ]);
    expect(validateTransitJourney(value).legs.map((leg) => leg.type)).toEqual(["walk", "transit", "walk"]);
    expect(() => validateTransitJourney({ ...value, rawProviderPayload: {} })).toThrow("INVALID_TRANSIT_JOURNEY");
  });

  it("represents bus to metro transfer", () => {
    const value = journey("realtime_adjusted", [
      vehicle("bus", "2026-10-24T13:00:00+08:00", "2026-10-24T13:15:00+08:00", "Bus A", "Transfer"),
      walk("2026-10-24T13:15:00+08:00", "2026-10-24T13:20:00+08:00"),
      vehicle("metro", "2026-10-24T13:22:00+08:00", "2026-10-24T13:42:00+08:00", "Transfer", "Metro B"),
    ]);
    expect(validateTransitJourney(value).transfers).toBe(1);
  });

  it("preserves multiple provider-ordered alternatives", () => {
    const first = journey();
    const second = { ...journey("estimated"), id: "later", departureTime: "2026-10-24T14:00:00+08:00", arrivalTime: "2026-10-24T14:30:00+08:00", legs: [vehicle("rail", "2026-10-24T14:00:00+08:00", "2026-10-24T14:30:00+08:00")] };
    const result = validateTransitJourneyResult({ status: "success", provider: "test-provider", journeys: [second, first] });
    expect(result.status === "success" && result.journeys.map((value) => value.id)).toEqual(["later", first.id]);
  });

  it("supports an unambiguous cross-midnight journey", () => {
    const value = journey("scheduled", [vehicle("rail", "2026-10-24T23:40:00+08:00", "2026-10-25T00:25:00+08:00")]);
    expect(validateTransitJourney(value).durationSeconds).toBe(45 * 60);
  });

  it("validates requests strictly", () => {
    const valid = { origin: coordinate(25, 121), destination: coordinate(25.1, 121.5), departureAt: "2026-10-24T13:00:00+08:00", timezone: "Asia/Taipei", allowedModes: ["bus", "metro"], maxWalkMeters: 1500 };
    expect(validateTransitJourneyRequest(valid)).toEqual(valid);
    expect(() => validateTransitJourneyRequest({ ...valid, origin: coordinate(91, 121) })).toThrow("INVALID_TRANSIT_JOURNEY_REQUEST");
    expect(() => validateTransitJourneyRequest({ ...valid, departureAt: "tomorrow" })).toThrow("INVALID_TRANSIT_DEPARTURE_TIME");
    expect(() => validateTransitJourneyRequest({ ...valid, arriveBy: "2026-10-24T14:00:00+08:00" })).toThrow("AMBIGUOUS_TRANSIT_TIME_CONSTRAINT");
    expect(() => validateTransitJourneyRequest({ ...valid, allowedModes: ["walking"] })).toThrow("INVALID_TRANSIT_MODE");
  });

  it("rejects invalid journey and leg chronology", () => {
    const value = journey();
    expect(() => validateTransitJourney({ ...value, arrivalTime: "2026-10-24T12:00:00+08:00" })).toThrow("INVALID_TRANSIT_JOURNEY_CHRONOLOGY");
    const overlapping = journey("scheduled", [
      vehicle("bus", "2026-10-24T13:00:00+08:00", "2026-10-24T13:20:00+08:00"),
      vehicle("metro", "2026-10-24T13:10:00+08:00", "2026-10-24T13:40:00+08:00"),
    ]);
    expect(() => validateTransitJourney(overlapping)).toThrow("INVALID_TRANSIT_LEG_CHRONOLOGY");
  });

  it("rejects invalid stop coordinates", () => {
    const value = journey();
    const leg = value.legs[0] as Extract<TransitJourneyLeg, { type: "transit" }>;
    expect(() => validateTransitJourney({ ...value, legs: [{ ...leg, boardingStop: { ...leg.boardingStop, coordinates: coordinate(100, 121) } }] })).toThrow("INVALID_TRANSIT_LEG");
  });

  it("keeps ordinary result outcomes distinct", () => {
    expect(validateTransitJourneyResult({ status: "no_service", provider: "p", reason: "No departures" }).status).toBe("no_service");
    expect(validateTransitJourneyResult({ status: "unsupported", provider: "p", reason: "Outside coverage" }).status).toBe("unsupported");
    expect(validateTransitJourneyResult({ status: "unavailable", provider: "p", retryable: true }).status).toBe("unavailable");
  });

  it("preserves provenance and rejects a provider mismatch", () => {
    expect(validateTransitJourney(journey()).evidence.provider).toBe("test-provider");
    expect(() => validateTransitJourneyResult({ status: "success", provider: "other", journeys: [journey()] })).toThrow("INVALID_TRANSIT_RESULT");
  });

  it("keeps manual transit budgets and generic routes separate", () => {
    expect(resolveEffectiveDuration(null, 55)).toMatchObject({ effectiveDurationSeconds: 3300, durationSource: "manual" });
    const route: NormalizedRoute = { provider: "geoapify", origin: coordinate(1, 2), destination: coordinate(3, 4), mode: "walking", durationSeconds: 600, distanceMeters: 800 };
    expect(route).not.toHaveProperty("legs");
    expect(route).not.toHaveProperty("departureTime");
  });
});
