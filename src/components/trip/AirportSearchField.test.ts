import { describe, expect, it } from "vitest";
import type { NormalizedPlace } from "@/domain/models";
import { hasAirportEvidence } from "./AirportSearchField";

const place = (overrides: Partial<NormalizedPlace>): NormalizedPlace => ({
  provider: "geoapify",
  providerPlaceId: "place",
  name: "Place",
  location: { latitude: 25, longitude: 121 },
  ...overrides,
});

describe("airport grounding eligibility", () => {
  it("accepts explicit provider airport categories", () => {
    expect(hasAirportEvidence(place({ categories: ["airport.international"] }))).toBe(true);
  });

  it("accepts explicit airport terminology returned by geocoding", () => {
    expect(hasAirportEvidence(place({ name: "Taiwan Taoyuan International Airport" }))).toBe(true);
    expect(hasAirportEvidence(place({ name: "福岡空港" }))).toBe(true);
  });

  it("does not accept an ordinary place merely because it has coordinates and timezone", () => {
    expect(hasAirportEvidence(place({ name: "Airport Cafe", categories: ["catering.cafe"] }))).toBe(false);
    expect(hasAirportEvidence(place({ name: "Central Cafe", categories: ["catering.cafe"] }))).toBe(false);
  });
});
