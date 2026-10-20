import { describe, expect, it, vi } from "vitest";
import { normalizeGeoapifyFeature } from "./geoapify-place-provider";
import { GeoapifyPlaceProvider } from "./geoapify-place-provider";

describe("Geoapify normalization", () => {
  it("normalizes provider output without leaking its raw response", () => {
    const result = normalizeGeoapifyFeature({
      properties: {
        place_id: "abc",
        name: "Taipei 101",
        formatted: "Taipei City",
        categories: ["tourism.sights"],
        datasource: { attribution: "© OpenStreetMap" },
      },
      geometry: { coordinates: [121.5645, 25.0339] },
    });
    expect(result).toEqual({
      provider: "geoapify",
      providerPlaceId: "abc",
      name: "Taipei 101",
      location: { longitude: 121.5645, latitude: 25.0339 },
      address: "Taipei City",
      category: "tourism.sights",
      categories: ["tourism.sights"],
      attribution: "© OpenStreetMap",
    });
    expect(result).not.toHaveProperty("properties");
  });
  it("retains provider-backed unnamed parking by using its formatted address as the label", () => {
    expect(normalizeGeoapifyFeature({ properties: { place_id: "p1", formatted: "Station Parking, Yufu", categories: ["parking", "parking.cars"] }, geometry: { coordinates: [131.35, 33.26] } }))
      .toMatchObject({ providerPlaceId: "p1", name: "Station Parking, Yufu", categories: ["parking", "parking.cars"] });
  });
  it("retains normalized airport categories and provider IANA timezone", () => {
    const result = normalizeGeoapifyFeature({ properties: { place_id: "tpe", name: "Taiwan Taoyuan International Airport", formatted: "Taoyuan, Taiwan", categories: [], timezone: { name: "Asia/Taipei" }, datasource: { raw: { aeroway: "aerodrome", iata: "TPE", icao: "RCTP" } } }, geometry: { coordinates: [121.23, 25.08] } });
    expect(result).toMatchObject({ providerPlaceId: "tpe", categories: ["transport.airport"], timezone: "Asia/Taipei", iataCode: "TPE", icaoCode: "RCTP" });
    expect(result).not.toHaveProperty("raw");
  });
  it("uses representative provider coordinates when airport details contain polygon geometry", () => {
    const result = normalizeGeoapifyFeature({
      properties: {
        place_id: "tpe-polygon", name: "Taiwan Taoyuan International Airport",
        lat: 25.0793, lon: 121.2063, timezone: { name: "Asia/Taipei" },
        datasource: { raw: { aeroway: "aerodrome", iata: "TPE" } },
      },
      geometry: { coordinates: [[[121.2, 25.07], [121.21, 25.08], [121.2, 25.07]]] },
    });
    expect(result?.location).toEqual({ latitude: 25.0793, longitude: 121.2063 });
    expect(result?.iataCode).toBe("TPE");
  });
  it("retrieves normalized airport details by coordinates without exposing raw provider data", async () => {
    const provider = new GeoapifyPlaceProvider("secret", async () => Response.json({ features: [{ properties: { place_id: "nrt", name: "Narita International Airport", categories: ["airport.international"], timezone: { name: "Asia/Tokyo" }, datasource: { raw: { iata: "nrt", icao: "rjaa", aeroway: "aerodrome" } } }, geometry: { coordinates: [140.39, 35.77] } }] }));
    const result = await provider.getDetailsAtCoordinates(35.77, 140.39);
    expect(result[0]).toMatchObject({ iataCode: "NRT", icaoCode: "RJAA", timezone: "Asia/Tokyo" });
    expect(result[0]).not.toHaveProperty("raw");
  });
});
it("normalizes a grounded destination and valid provider timezone", async () => {
  const provider = new GeoapifyPlaceProvider("secret", async () => {
    return Response.json({ features: [{ properties: { place_id: "c1", city: "Choshi", formatted: "Choshi, Chiba, Japan", timezone: { name: "Asia/Tokyo" } }, geometry: { coordinates: [140.86, 35.7] } }] });
  });
  await expect(provider.searchDestination("銚子")).resolves.toEqual([{ name: "Choshi", formattedAddress: "Choshi, Chiba, Japan", latitude: 35.7, longitude: 140.86, provider: "geoapify", providerPlaceId: "c1", timezone: "Asia/Tokyo" }]);
});
it("uses bounded provider categories and proximity for discovery", async () => {
  const fetcher = vi.fn(
      async (_input: RequestInfo | URL) =>
        new Response(
          JSON.stringify({
            features: [
              {
                properties: {
                  place_id: "sea-1",
                  name: "Grounded Beach",
                  categories: ["beach"],
                },
                geometry: { coordinates: [127.7, 26.2] },
              },
            ],
          }),
          { status: 200 },
        ),
    ),
    provider = new GeoapifyPlaceProvider("key", fetcher as typeof fetch),
    results = await provider.discover({
      categories: ["beach"],
      latitude: 26.2,
      longitude: 127.7,
      limit: 20,
    });
  expect(results[0]).toMatchObject({
    provider: "geoapify",
    providerPlaceId: "sea-1",
  });
  const url = String(fetcher.mock.calls[0][0]);
  expect(url).toContain("categories=beach");
  expect(url).toContain("filter=circle");
});
it("requests precise cafe and coastal provider categories", async () => {
  const fetcher = vi.fn(async (_input: RequestInfo | URL) =>
      Response.json({ features: [] }),
    ),
    provider = new GeoapifyPlaceProvider("key", fetcher as typeof fetch);
  await provider.discover({
    categories: ["cafe", "beach"],
    latitude: 1,
    longitude: 2,
  });
  const url = decodeURIComponent(String(fetcher.mock.calls[0][0]));
  expect(url).toContain("catering.cafe.coffee_shop");
  expect(url).toContain("maritime.marina");
  expect(url).toContain("man_made.pier");
  expect(url).toContain("natural.coastal");
  expect(url).toContain("tourism.sights.lighthouse");
});
it("maps an explicit parking request to the bounded provider parking category", async () => {
  const fetcher = vi.fn(async (_input: RequestInfo | URL) => Response.json({ features: [] })),
    provider = new GeoapifyPlaceProvider("key", fetcher as typeof fetch);
  await provider.discover({ categories: ["parking"], latitude: 33.26, longitude: 131.35 });
  expect(decodeURIComponent(String(fetcher.mock.calls[0][0]))).toContain("categories=parking");
});
it("retains normalized geographic candidate evidence for deterministic resolution",async()=>{
  const provider=new GeoapifyPlaceProvider("key",async()=>Response.json({features:[{properties:{place_id:"station",name:"熊本站",formatted:"Kumamoto Station, Japan",categories:["public_transport.train"],result_type:"amenity",city:"Kumamoto",state:"Kumamoto",country:"Japan",rank:{confidence:0.98}},geometry:{coordinates:[130.69,32.79]}}]}));
  await expect(provider.searchGeographicCandidates("熊本站")).resolves.toMatchObject([{providerPlaceId:"station",categories:["public_transport.train"],resultType:"amenity",city:"Kumamoto",region:"Kumamoto",country:"Japan",confidence:0.98,providerRank:0}]);
});
it("uses a provider place boundary for city-area discovery",async()=>{
  const fetcher=vi.fn(async(_input:RequestInfo|URL)=>Response.json({features:[]})),provider=new GeoapifyPlaceProvider("key",fetcher as typeof fetch);
  await provider.discover({categories:["museum"],latitude:35,longitude:135,providerAreaPlaceId:"kyoto-area"});
  expect(decodeURIComponent(String(fetcher.mock.calls[0][0]))).toContain("filter=place:kyoto-area");
});
it("reports raw and normalized counts without exposing provider payloads", async () => {
  const fetcher = vi.fn(async () =>
      Response.json({
        features: [
          {
            properties: { place_id: "valid", name: "Cape" },
            geometry: { coordinates: [140.86, 35.7] },
          },
          { properties: { place_id: "missing-name" } },
        ],
      }),
    ),
    provider = new GeoapifyPlaceProvider("key", fetcher as typeof fetch),
    result = await provider.discoverWithDiagnostics({
      categories: ["attraction"],
      latitude: 35.7,
      longitude: 140.86,
    });
  expect(result).toMatchObject({ rawCount: 2, normalizedCount: 1 });
  expect(result.places).toHaveLength(1);
});
