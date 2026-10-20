import { describe, expect, it } from "vitest";
import type { FlightDetails, GroundedAirportRef, Trip } from "./models";
import { createManualTripItem } from "./manual-items";
import { durationMinutes, editTripItem, localDateKey, minutesOfDay } from "./time";
import { flightRouteLabel, validateFlightDetailsShape, validateGroundedAirportRef, validatePersistedFlight } from "./flight";

const trip: Trip = { id: "trip", name: "Asia", startDate: "2026-10-29", endDate: "2026-11-01", timezone: "UTC", createdAt: "now", updatedAt: "now" };
const airport = (name: string, timezone: string, id = name): GroundedAirportRef => ({ name, formattedAddress: `${name} Airport`, latitude: 25, longitude: 121, provider: "geoapify", providerPlaceId: id, timezone });
const details = (origin: GroundedAirportRef, destination: GroundedAirportRef): FlightDetails => ({ origin: origin.name, destination: destination.name, originAirport: origin, destinationAirport: destination, airline: "  EVA Air  ", flightNumber: "  BR 100  " });
const input = (flightDetails: FlightDetails, startDate: string, startMinutes: number, endDate: string, endMinutes: number) => ({ type: "flight" as const, title: "", startDate, startMinutes, endDate, endMinutes, address: "  Terminal 1  ", notes: "  Window seat  ", reservation: null, flightDetails, transportDetails: null });

describe("grounded Flight semantics", () => {
  it("uses each endpoint timezone for TPE to FUK", () => {
    const item = createManualTripItem(input(details(airport("TPE", "Asia/Taipei"), airport("FUK", "Asia/Tokyo")), "2026-10-30", 600, "2026-10-30", 800), trip);
    expect(item.startAt).toBe("2026-10-30T02:00:00.000Z");
    expect(item.endAt).toBe("2026-10-30T04:20:00.000Z");
    expect(durationMinutes(item)).toBe(140);
  });
  it("handles HND to TPE across midnight as 240 minutes", () => {
    const item = createManualTripItem(input(details(airport("HND", "Asia/Tokyo"), airport("TPE", "Asia/Taipei")), "2026-10-30", 1410, "2026-10-31", 150), trip);
    expect(durationMinutes(item)).toBe(240);
  });
  it("supports cross-midnight and westbound wall clocks using absolute instants", () => {
    const sameZone = createManualTripItem(input(details(airport("A", "Asia/Tokyo"), airport("B", "Asia/Tokyo")), "2026-10-30", 1410, "2026-10-31", 90), trip);
    expect(durationMinutes(sameZone)).toBe(120);
    const westbound = createManualTripItem(input(details(airport("NRT", "Asia/Tokyo"), airport("HNL", "Pacific/Honolulu")), "2026-10-30", 1080, "2026-10-30", 390), trip);
    expect(durationMinutes(westbound)).toBe(450);
  });
  it("rejects non-positive absolute chronology", () => {
    expect(() => createManualTripItem(input(details(airport("TPE", "Asia/Taipei"), airport("FUK", "Asia/Tokyo")), "2026-10-30", 600, "2026-10-30", 600), trip)).toThrow(/Arrival must be after/);
  });
  it("preserves exact minutes without planning-grid snapping", () => {
    const item = createManualTripItem(input(details(airport("TPE", "Asia/Taipei"), airport("KHH", "Asia/Taipei")), "2026-10-30", 607, "2026-10-30", 682), trip);
    expect(minutesOfDay(item.startAt, "Asia/Taipei")).toBe(607);
    expect(minutesOfDay(item.endAt, "Asia/Taipei")).toBe(682);
    expect(durationMinutes(item)).toBe(75);
  });
  it("normalizes metadata while retaining airport identity", () => {
    const item = createManualTripItem(input(details(airport("TPE", "Asia/Taipei"), airport("FUK", "Asia/Tokyo")), "2026-10-30", 600, "2026-10-30", 800), trip);
    expect(item.flightDetails).toMatchObject({ airline: "EVA Air", flightNumber: "BR 100", originAirport: { providerPlaceId: "TPE", timezone: "Asia/Taipei" } });
    expect(item).toMatchObject({ address: "Terminal 1", notes: "Window seat" });
  });
  it("uses verified IATA codes for compact schedule labels with readable fallbacks", () => {
    const origin = { ...airport("Taiwan Taoyuan International Airport", "Asia/Taipei"), iataCode: "TPE" };
    const destination = { ...airport("Charleston International Airport", "America/New_York"), iataCode: "CHS" };
    expect(flightRouteLabel({ title: "Flight", flightDetails: details(origin, destination) })).toBe("TPE → CHS");
    expect(flightRouteLabel({ title: "Flight", flightDetails: details(origin, airport("Charleston International Airport", "America/New_York")) })).toBe("TPE → Charleston International Airport");
    expect(flightRouteLabel({ title: "Legacy", flightDetails: { origin: "Taipei", destination: "Charleston" } })).toBe("Taipei → Charleston");
  });
  it("rejects invalid airport evidence, unknown raw payload, and excessive metadata", () => {
    expect(validateGroundedAirportRef({ ...airport("TPE", "Mars/Olympus") })).toBe(false);
    expect(validateGroundedAirportRef({ ...airport("TPE", "Asia/Taipei"), latitude: 91 })).toBe(false);
    expect(validateGroundedAirportRef({ ...airport("TPE", "Asia/Taipei"), provider: "" })).toBe(false);
    expect(validateGroundedAirportRef({ ...airport("TPE", "Asia/Taipei"), raw: {} })).toBe(false);
    expect(validateGroundedAirportRef({ ...airport("TPE", "Asia/Taipei"), iataCode: "RCTP" })).toBe(false);
    expect(validateGroundedAirportRef({ ...airport("TPE", "Asia/Taipei"), icaoCode: "TPE" })).toBe(false);
    expect(validateFlightDetailsShape({ origin: "A", destination: "B", airline: "x".repeat(121) })).toBe(false);
  });
  it("edits grounded local clocks using the same endpoint timezone semantics", () => {
    const original = createManualTripItem(input(details(airport("TPE", "Asia/Taipei"), airport("FUK", "Asia/Tokyo")), "2026-10-30", 600, "2026-10-30", 800), trip);
    const edited = editTripItem(original, { startDate: "2026-10-30", startMinutes: 607, endDate: "2026-10-30", endMinutes: 822, flightDetails: original.flightDetails }, trip.timezone);
    expect(localDateKey(edited.startAt, "Asia/Taipei")).toBe("2026-10-30");
    expect(minutesOfDay(edited.startAt, "Asia/Taipei")).toBe(607);
    expect(minutesOfDay(edited.endAt, "Asia/Tokyo")).toBe(822);
    expect(validatePersistedFlight(edited, trip)).toBe(true);
  });
});
