import { describe, expect, it } from "vitest";
import type { DayContext, Trip, TripItem } from "./models";
import type { TravelSegment } from "./routing";
import { buildItineraryOverview, flightDisplay, tripDateKeys } from "./itinerary-overview";

const trip: Trip = { id: "trip", name: "Japan", startDate: "2026-10-30", endDate: "2026-10-31", timezone: "Asia/Tokyo", createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" };
const item = (values: Partial<TripItem> & Pick<TripItem, "id" | "startAt" | "endAt">): TripItem => ({
  tripId: trip.id, type: "place", title: values.id, description: null, latitude: 35, longitude: 135, address: null, placeId: null, notes: null, sortOrder: 0, createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z", flexibility: "flexible", schedulingConstraint: null, reservation: null, ...values,
});
const segment = (values: Partial<TravelSegment> = {}): TravelSegment => ({
  id: "a--b", tripId: trip.id, date: "2026-10-30", fromEndpoint: { kind: "trip_item", tripItemId: "a" }, toEndpoint: { kind: "trip_item", tripItemId: "b" }, fromTripItemId: "a", toTripItemId: "b", mode: "driving", durationSeconds: 2460, durationOverrideMinutes: null, effectiveDurationSeconds: 2460, durationSource: "provider", movementSource: "provider_route", boundTransportItemId: null, boundTransportDepartureAt: null, boundTransportArrivalAt: null, boundTransportStatus: null, distanceMeters: 32000, provider: "geoapify", calculatedAt: "2026-01-01T00:00:00Z", status: "loaded", error: null, ...values,
});

describe("itinerary overview projection", () => {
  it("builds every trip day and orders scheduled items chronologically", () => {
    const later = item({ id: "b", startAt: "2026-10-30T03:00:00Z", endAt: "2026-10-30T04:00:00Z" });
    const earlier = item({ id: "a", startAt: "2026-10-30T00:00:00Z", endAt: "2026-10-30T01:00:00Z" });
    const days = buildItineraryOverview(trip, [later, earlier], [], [segment()]);
    expect(tripDateKeys(trip.startDate, trip.endDate)).toEqual(["2026-10-30", "2026-10-31"]);
    expect(days[0].items.map((value) => value.id)).toEqual(["a", "b"]);
    expect(days[1].items).toEqual([]);
  });

  it("projects configured DayContext without fabricating missing values", () => {
    const location = { name: "Yufuin", formattedAddress: null, latitude: 33.2, longitude: 131.3, provider: "geoapify", providerPlaceId: "yufuin", timezone: "Asia/Tokyo" };
    const context: DayContext = { tripId: trip.id, date: "2026-10-30", startLocation: null, baseLocation: location, endLocation: null, createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" };
    expect(buildItineraryOverview(trip, [], [context], [])[0].context).toEqual(context);
    expect(buildItineraryOverview(trip, [], [], [])[0].context).toBeNull();
  });

  it("keeps a standalone Transport as an item but removes bound Transport from the node list", () => {
    const standalone = item({ id: "standalone", type: "transport", startAt: "2026-10-30T01:00:00Z", endAt: "2026-10-30T02:00:00Z", transportDetails: { mode: "train", from: "A", to: "B" } });
    const bound = item({ id: "bound", type: "transport", startAt: "2026-10-30T02:00:00Z", endAt: "2026-10-30T03:00:00Z", transportDetails: { mode: "train", from: "A", to: "B", behavior: "replace_segment", boundFromEndpoint: { kind: "trip_item", tripItemId: "a" }, boundToEndpoint: { kind: "trip_item", tripItemId: "b" } } });
    expect(buildItineraryOverview(trip, [standalone, bound], [], []).flatMap((day) => day.items).map((value) => value.id)).toEqual(["standalone"]);
  });

  it("preserves centralized movement authority and deterministic feasibility", () => {
    const a = item({ id: "a", startAt: "2026-10-30T00:00:00Z", endAt: "2026-10-30T01:00:00Z" });
    const b = item({ id: "b", startAt: "2026-10-30T01:30:00Z", endAt: "2026-10-30T02:30:00Z" });
    const manual = segment({ durationOverrideMinutes: 50, effectiveDurationSeconds: 3000, durationSource: "manual", movementSource: "manual_duration" });
    const day = buildItineraryOverview(trip, [a, b], [], [manual])[0];
    expect(day.movements[0]).toMatchObject({ movementSource: "manual_duration", effectiveDurationSeconds: 3000, durationSeconds: 2460 });
    expect(day.feasibility.issues[0]).toMatchObject({ code: "insufficient_travel" });
  });

  it("renders grounded Flight wall clocks in independent endpoint timezones with exact minutes", () => {
    const flight = item({ id: "flight", type: "flight", title: "TPE to FUK", startAt: "2026-10-30T02:00:00.000Z", endAt: "2026-10-30T04:20:00.000Z", latitude: null, longitude: null, flightDetails: { origin: "TPE", destination: "FUK", airline: "EVA Air", flightNumber: "BR106", originAirport: { name: "Taiwan Taoyuan International Airport", formattedAddress: null, latitude: 25.08, longitude: 121.23, provider: "geoapify", providerPlaceId: "tpe", timezone: "Asia/Taipei", iataCode: "TPE" }, destinationAirport: { name: "Fukuoka Airport", formattedAddress: null, latitude: 33.58, longitude: 130.45, provider: "geoapify", providerPlaceId: "fuk", timezone: "Asia/Tokyo", iataCode: "FUK" } } });
    expect(flightDisplay(flight, trip.timezone)).toMatchObject({ departureTime: "10:00", arrivalTime: "13:20", durationMinutes: 140, originTimezone: "Asia/Taipei", destinationTimezone: "Asia/Tokyo", grounded: true, origin: "TPE", destination: "FUK" });
  });

  it("supports legacy Flights without inventing endpoint grounding", () => {
    const flight = item({ id: "legacy", type: "flight", title: "Legacy", startAt: "2026-10-30T01:07:00Z", endAt: "2026-10-30T02:22:00Z", latitude: null, longitude: null, flightDetails: { origin: "Taipei", destination: "Fukuoka" } });
    expect(flightDisplay(flight, trip.timezone)).toMatchObject({ grounded: false, departureTime: "10:07", arrivalTime: "11:22" });
  });

  it("does not mutate canonical inputs while projecting", () => {
    const canonical = [item({ id: "a", title: "Original", startAt: "2026-10-30T00:00:00Z", endAt: "2026-10-30T01:00:00Z" })];
    const before = JSON.stringify(canonical);
    buildItineraryOverview(trip, canonical, [], []);
    expect(JSON.stringify(canonical)).toBe(before);
  });
});
