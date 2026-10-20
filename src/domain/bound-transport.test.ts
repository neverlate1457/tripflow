import { describe, expect, it } from "vitest";
import type { DayContext, TripItem } from "./models";
import { activeBoundTransportsForSegment, applyEffectiveMovement, bindingIsValid, isBoundTransport, resolveEffectiveMovement, transportBehavior, validateGroundedPlaceRef } from "./bound-transport";
import { analyzeDay } from "./constraints";
import { deriveSegmentSpecs, emptySegment, type SegmentSpec, type TravelSegment } from "./routing";

const item = (id: string, startAt: string, endAt: string, latitude = 25, longitude = 121): TripItem => ({ id, tripId: "trip", type: "place", title: id, description: null, startAt, endAt, latitude, longitude, address: null, placeId: null, notes: null, sortOrder: 0, createdAt: "", updatedAt: "", flexibility: "flexible", schedulingConstraint: null, reservation: null, transportDetails: null, flightDetails: null });
const a = item("a", "2026-10-31T01:00:00Z", "2026-10-31T02:00:00Z");
const b = item("b", "2026-10-31T03:00:00Z", "2026-10-31T04:00:00Z", 25.1, 121.1);
const c = item("c", "2026-10-31T05:00:00Z", "2026-10-31T06:00:00Z", 25.2, 121.2);
const bound = (from = "a", to = "b", startAt = "2026-10-31T02:10:00Z", endAt = "2026-10-31T03:15:00Z"): TripItem => ({ ...item("transport", startAt, endAt, 0, 0), type: "transport", title: "JR Kyushu", latitude: null, longitude: null, transportDetails: { behavior: "replace_segment", mode: "train", from, to, service: "JR Kyushu", boundFromEndpoint: { kind: "trip_item", tripItemId: from }, boundToEndpoint: { kind: "trip_item", tripItemId: to } } });
const spec = (): SegmentSpec => deriveSegmentSpecs([a, b], "UTC")[0];
const segment = (): TravelSegment => ({ ...emptySegment(spec()), durationSeconds: 41 * 60, durationOverrideMinutes: 50, effectiveDurationSeconds: 50 * 60, durationSource: "manual", provider: "geoapify", distanceMeters: 32_000, routeGeometry: { type: "LineString", coordinates: [[121,25],[121.1,25.1]] }, status: "loaded" });

describe("bound Manual Transport", () => {
  it("treats legacy and new standalone Transport as standalone", () => {
    expect(transportBehavior({ ...bound(), transportDetails: { mode: "train", from: "A", to: "B" } })).toBe("standalone");
    expect(transportBehavior({ ...bound(), transportDetails: { behavior: "standalone", mode: "train", from: "A", to: "B" } })).toBe("standalone");
  });

  it("binds only an exact adjacent TripItem edge", () => {
    const specs = deriveSegmentSpecs([a, b, c], "UTC");
    expect(bindingIsValid(bound().transportDetails, specs)).toBe(true);
    expect(bindingIsValid(bound("a", "c").transportDetails, specs)).toBe(false);
  });

  it("supports Day Start and Day End edges, but Base creates none", () => {
    const place = (name: string) => ({ name, formattedAddress: null, latitude: 24, longitude: 120, provider: "geoapify", providerPlaceId: name, timezone: "Asia/Taipei" });
    const context: DayContext = { tripId: "trip", date: "2026-10-31", startLocation: place("start"), baseLocation: place("base"), endLocation: place("end"), createdAt: "", updatedAt: "" };
    const specs = deriveSegmentSpecs([a, b], "UTC", [context]);
    expect(specs.map((value) => [value.fromEndpoint.kind, value.toEndpoint.kind])).toEqual([["day_start", "trip_item"], ["trip_item", "trip_item"], ["trip_item", "day_end"]]);
    expect(deriveSegmentSpecs([a, b], "UTC", [{ ...context, startLocation: null, endLocation: null }])).toHaveLength(1);
  });

  it("uses bound transport above manual override and provider evidence without mutating either", () => {
    const original = segment(), result = applyEffectiveMovement(original, [a, b, bound()]);
    expect(result).toMatchObject({ movementSource: "bound_transport", effectiveDurationSeconds: 65 * 60, durationSeconds: 41 * 60, durationOverrideMinutes: 50, provider: "geoapify", distanceMeters: 32_000, boundTransportItemId: "transport" });
    expect(original).toMatchObject({ effectiveDurationSeconds: 50 * 60, durationSeconds: 41 * 60 });
  });

  it("falls back from removed binding to manual override, then provider", () => {
    expect(resolveEffectiveMovement(segment(), [a,b]).source).toBe("manual_duration");
    expect(resolveEffectiveMovement(segment(), [a,b]).effectiveDurationSeconds).toBe(50 * 60);
    const provider = { ...segment(), durationOverrideMinutes: null, effectiveDurationSeconds: 41 * 60, durationSource: "provider" as const };
    expect(resolveEffectiveMovement(provider, [a,b])).toMatchObject({ source: "provider_route", effectiveDurationSeconds: 41 * 60 });
  });

  it("does not double-count a bound transport as a routing node", () => {
    const specs = deriveSegmentSpecs([a, bound(), b], "UTC");
    expect(specs).toHaveLength(1);
    expect(specs[0]).toMatchObject({ fromTripItemId: "a", toTripItemId: "b" });
  });

  it("makes a deleted or non-adjacent binding inactive without retargeting", () => {
    const ac = bound("a", "c"), specs = deriveSegmentSpecs([a, ac, b, c], "UTC");
    expect(activeBoundTransportsForSegment(specs[0], [a, ac, b, c])).toEqual([]);
    expect(isBoundTransport(ac)).toBe(true);
  });

  it("does not arbitrarily activate duplicate bindings", () => {
    const duplicate = { ...bound(), id: "duplicate" };
    expect(resolveEffectiveMovement(segment(), [a,b,bound(),duplicate])).toMatchObject({ boundTransportStatus: "conflict", source: "manual_duration", boundTransport: null });
  });

  it("uses explicit transport timestamps for feasibility", () => {
    const missed = applyEffectiveMovement(segment(), [a,b,bound("a","b","2026-10-31T01:50:00Z","2026-10-31T03:15:00Z")]);
    expect(analyzeDay([a,b,bound()], [missed]).issues.map((issue) => issue.code)).toEqual(["transport_departure_missed", "transport_arrival_late"]);
  });

  it("supports cross-midnight transport duration", () => {
    const overnight = bound("a", "b", "2026-10-31T23:40:00+08:00", "2026-11-01T00:25:00+08:00");
    expect(applyEffectiveMovement(segment(), [a,b,overnight]).effectiveDurationSeconds).toBe(45 * 60);
  });

  it("accepts only normalized grounded physical places and creates no access/egress edges", () => {
    const station = { name: "Yufuin Station", formattedAddress: null, latitude: 33.26, longitude: 131.35, provider: "geoapify", providerPlaceId: "station", timezone: null };
    expect(validateGroundedPlaceRef(station)).toBe(true);
    expect(validateGroundedPlaceRef({ ...station, raw: { provider: "payload" } })).toBe(false);
    const transport = bound(); transport.transportDetails = { ...transport.transportDetails!, boardingPlace: station, alightingPlace: { ...station, name: "Hakata", providerPlaceId: "hakata" } };
    expect(deriveSegmentSpecs([a, transport, b], "UTC")).toHaveLength(1);
  });
});
