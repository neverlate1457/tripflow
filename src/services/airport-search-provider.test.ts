import { describe, expect, it, vi } from "vitest";
import type { NormalizedPlace } from "@/domain/models";
import { AirportSearchProvider, parseAirportIndex } from "./airport-search-provider";

const place = (id: string, name: string, iataCode?: string): NormalizedPlace => ({ provider: "geoapify", providerPlaceId: id, name, location: { latitude: 25, longitude: 121 }, address: `${name}, city`, categories: ["airport", "airport.international"], timezone: "Asia/Taipei", ...(iataCode ? { iataCode } : {}) });

describe("airport search provider", () => {
  it("parses a maintainable quoted airport CSV index", () => {
    const index = parseAirportIndex('name,latitude_deg,longitude_deg,iata_code\n"Charleston International Airport",32.8986,-80.0405,CHS\n"Airport, With Comma",25.1,121.2,TPE');
    expect(index.get("CHS")).toMatchObject({ name: "Charleston International Airport", latitude: 32.8986 });
    expect(index.get("TPE")?.name).toBe("Airport, With Comma");
  });
  it("grounds an exact IATA seed through named Geoapify candidates and rejects mismatches", async () => {
    const search = vi.fn().mockResolvedValue([place("chs", "Charleston International Airport"), place("wrong", "Other Airport")]);
    const getDetails = vi.fn(async (id: string) => id === "chs" ? place("chs", "Charleston International Airport", "CHS") : place("wrong", "Other Airport", "OTH"));
    const provider = new AirportSearchProvider({ places: { search, getDetails, getDetailsAtCoordinates: vi.fn() }, loadIndex: async () => new Map([["CHS", { iataCode: "CHS", name: "Charleston International Airport", latitude: 32.9, longitude: -80.04 }]]) });
    await expect(provider.search("chs")).resolves.toEqual([expect.objectContaining({ providerPlaceId: "chs", iataCode: "CHS" })]);
    expect(search).toHaveBeenCalledWith("Charleston International Airport", expect.objectContaining({ latitude: 32.9, longitude: -80.04 }));
    await expect(provider.search("ZZZ")).resolves.toEqual([]);
  });
  it("enriches name and city candidates through Place Details while keeping alternatives", async () => {
    const hnd = place("hnd", "Tokyo Haneda Airport", "HND"), nrt = place("nrt", "Narita International Airport", "NRT");
    const provider = new AirportSearchProvider({ places: { search: vi.fn().mockResolvedValue([hnd, nrt]), getDetails: vi.fn(async (id: string) => id === "hnd" ? hnd : nrt), getDetailsAtCoordinates: vi.fn() } });
    const results = await provider.search("Tokyo");
    expect(results.map((result) => result.iataCode)).toEqual(["HND", "NRT"]);
  });
});
