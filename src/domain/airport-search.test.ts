import { describe, expect, it } from "vitest";
import type { NormalizedPlace } from "./models";
import { airportProviderQuery, airportRefFromPlace, normalizedIataQuery, rankAirportResults } from "./airport-search";

const airport = (id: string, name: string, iataCode?: string): NormalizedPlace => ({ provider: "geoapify", providerPlaceId: id, name, address: `${name}, city`, location: { latitude: 25, longitude: 121 }, categories: ["transport.airport"], timezone: "Asia/Taipei", ...(iataCode ? { iataCode } : {}) });

describe("airport search normalization", () => {
  it.each([["TPE", "TPE"], [" tpe ", "TPE"], ["TSA", "TSA"]])("detects exact IATA query %s", (query, expected) => {
    expect(normalizedIataQuery(query)).toBe(expected);
    expect(airportProviderQuery(query)).toBe(expected);
  });
  it("keeps airport names, localized names, and cities searchable", () => {
    expect(airportProviderQuery("Taiwan Taoyuan")).toBe("Taiwan Taoyuan airport");
    expect(airportProviderQuery("桃園")).toBe("桃園 airport");
    expect(airportProviderQuery("Tokyo")).toBe("Tokyo airport");
  });
  it("prioritizes and exclusively accepts the exact provider-backed IATA identity", () => {
    const tpe = airport("tpe", "Taiwan Taoyuan International Airport", "TPE"), tsa = airport("tsa", "Taipei Songshan Airport", "TSA");
    expect(rankAirportResults("tpe", [tsa, tpe]).map((value) => value.providerPlaceId)).toEqual(["tpe"]);
    expect(rankAirportResults("CHS", [tpe, airport("chs-name-only", "Charleston International Airport")])).toEqual([]);
  });
  it("supports partial/localized names and preserves ambiguous city alternatives", () => {
    const hnd = airport("hnd", "Tokyo Haneda Airport", "HND"), nrt = airport("nrt", "Narita International Airport", "NRT"), tpe = airport("tpe", "桃園國際機場", "TPE");
    expect(rankAirportResults("桃園", [hnd, tpe])[0]).toBe(tpe);
    expect(rankAirportResults("Tokyo", [hnd, nrt])).toHaveLength(2);
    expect(rankAirportResults("Narita", [hnd, nrt])[0]).toBe(nrt);
  });
  it("copies verified codes into the canonical airport reference without raw payload", () => {
    expect(airportRefFromPlace(airport("tpe", "Taoyuan Airport", "tpe"))).toMatchObject({ iataCode: "TPE", providerPlaceId: "tpe", timezone: "Asia/Taipei" });
  });
});
