import { describe, expect, it } from "vitest";
import { filterPlacesWithinRadius, manualLocationFromMap, manualLocationFromPlace } from "./manual-location";
import type { NormalizedPlace } from "./models";

const place = (id: string, latitude: number, longitude: number): NormalizedPlace => ({ provider: "geoapify", providerPlaceId: id, name: id, address: `${id} address`, location: { latitude, longitude } });

describe("manual location grounding", () => {
  it("retains original input and normalized provider evidence", () => {
    expect(manualLocationFromPlace(place("taipei", 25.04, 121.51), " 台北車站 ")).toMatchObject({ originalInput: "台北車站", formattedAddress: "taipei address", provider: "geoapify", source: "manual" });
  });
  it("accepts explicit map coordinates without fabricating provider identity", () => {
    expect(manualLocationFromMap(33.59, 130.42, "Meeting point")).toMatchObject({ provider: null, providerPlaceId: null, displayName: "Meeting point" });
  });
  it("rejects invalid map coordinates", () => expect(() => manualLocationFromMap(95, 121, "Bad")).toThrow("INVALID_MANUAL_LOCATION_COORDINATES"));
  it("enforces the requested nearby radius", () => {
    const results = filterPlacesWithinRadius([place("near", 25.0005, 121), place("far", 25.1, 121)], { latitude: 25, longitude: 121 }, 1000);
    expect(results.map((x) => x.place.providerPlaceId)).toEqual(["near"]);
  });
});
