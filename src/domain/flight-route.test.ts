import { describe, expect, it } from "vitest";
import type { GroundedAirportRef, TripItem } from "./models";
import { greatCircleRoute, selectedFlightRoute } from "./flight-route";

const airport = (iataCode: string, latitude: number, longitude: number): GroundedAirportRef => ({
  name: `${iataCode} Airport`, formattedAddress: null, latitude, longitude,
  provider: "geoapify", providerPlaceId: iataCode, timezone: "UTC", iataCode,
});
const flight = (origin = airport("TPE", 25.0797, 121.2342), destination = airport("NRT", 35.772, 140.3929)) => ({
  id: "flight-1", type: "flight", flightDetails: { origin: "TPE", destination: "NRT", originAirport: origin, destinationAirport: destination },
} as TripItem);

describe("flight route preview", () => {
  it("generates a great-circle route with exact grounded endpoints", () => {
    const geometry = greatCircleRoute(airport("TPE", 25.0797, 121.2342), airport("NRT", 35.772, 140.3929), 16)!;
    expect(geometry.coordinates).toHaveLength(17);
    expect(geometry.coordinates[0]).toEqual([121.2342, 25.0797]);
    expect(geometry.coordinates.at(-1)).toEqual([140.3929, 35.772]);
    expect(geometry.coordinates[8][1]).not.toBeCloseTo((25.0797 + 35.772) / 2, 3);
  });
  it("unwraps International Date Line crossings without map-spanning jumps", () => {
    const geometry = greatCircleRoute(airport("NRT", 35.77, 140.39), airport("HNL", 21.32, -157.92), 32)!;
    expect(Math.max(...geometry.coordinates.slice(1).map((point, index) => Math.abs(point[0] - geometry.coordinates[index][0])))).toBeLessThan(180);
    expect(geometry.coordinates.some(([longitude]) => longitude > 180)).toBe(true);
  });
  it("returns a preview only for a selected grounded Flight", () => {
    expect(selectedFlightRoute({ type: "tripItem", id: "flight-1" }, [flight()])?.origin.iataCode).toBe("TPE");
    expect(selectedFlightRoute({ type: "travelSegment", id: "segment" }, [flight()])).toBeNull();
    expect(selectedFlightRoute({ type: "tripItem", id: "legacy" }, [{ ...flight(), id: "legacy", flightDetails: { origin: "Taipei", destination: "Tokyo" } }])).toBeNull();
  });
  it("rejects missing or invalid airport coordinates", () => {
    expect(greatCircleRoute(airport("BAD", 95, 121), airport("NRT", 35, 140))).toBeNull();
    expect(greatCircleRoute(airport("BAD", 25, Number.NaN), airport("NRT", 35, 140))).toBeNull();
  });
});
