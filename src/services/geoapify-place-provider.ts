import type { NormalizedPlace } from "@/domain/models";
import type {
  PlaceDiscoverySearch,
  PlaceProvider,
  PlaceSearchContext,
  GeographicCandidate,
} from "./place-provider";

interface GeoapifyFeature {
  properties?: {
    place_id?: string;
    name?: string;
    formatted?: string;
    categories?: string[];
    lat?: number;
    lon?: number;
    datasource?: { attribution?: string; raw?: { aeroway?: string; iata?: string; icao?: string } };
    timezone?: { name?: string };
    city?: string;
    county?: string;
    state?: string;
    country?: string;
    result_type?: string;
    rank?: { confidence?: number };
  };
  geometry?: { coordinates?: unknown };
}

const geoapifyPointCoordinates = (coordinates: unknown): [number, number] | undefined =>
  Array.isArray(coordinates) && typeof coordinates[0] === "number" && typeof coordinates[1] === "number"
    ? [coordinates[0], coordinates[1]]
    : undefined;

export function normalizeGeoapifyFeature(
  feature: GeoapifyFeature,
): NormalizedPlace | null {
  const properties = feature.properties ?? {};
  const coordinates = feature.geometry?.coordinates;
  const pointCoordinates = geoapifyPointCoordinates(coordinates);
  // Place Details may return a Polygon for large features such as airports.
  // Geoapify's representative lon/lat remains the canonical point in that case.
  const longitude = properties.lon ?? pointCoordinates?.[0];
  const latitude = properties.lat ?? pointCoordinates?.[1];
  const parking = properties.categories?.some((category) =>
    /(?:^|\.)parking(?:\.|$)/.test(category),
  );
  const normalizedName = properties.name ?? (parking ? properties.formatted : undefined);
  const raw = properties.datasource?.raw;
  const airportEvidence = raw?.aeroway === "aerodrome" || raw?.aeroway === "airport";
  const categories = [...new Set([...(properties.categories ?? []), ...(airportEvidence ? ["transport.airport"] : [])])];
  if (
    !properties.place_id ||
    !normalizedName ||
    latitude == null ||
    longitude == null
  )
    return null;
  return {
    provider: "geoapify",
    providerPlaceId: properties.place_id,
    name: normalizedName,
    location: { latitude, longitude },
    address: properties.formatted,
    category: categories[0],
    categories,
    attribution: properties.datasource?.attribution ?? "Powered by Geoapify",
    ...(properties.timezone?.name ? { timezone: properties.timezone.name } : {}),
    ...(raw?.iata && /^[A-Za-z]{3}$/.test(raw.iata.trim()) ? { iataCode: raw.iata.trim().toUpperCase() } : {}),
    ...(raw?.icao && /^[A-Za-z0-9]{4}$/.test(raw.icao.trim()) ? { icaoCode: raw.icao.trim().toUpperCase() } : {}),
  };
}

export class GeoapifyPlaceProvider implements PlaceProvider {
  constructor(
    private readonly apiKey: string,
    private readonly fetcher: typeof fetch = fetch,
  ) {}
  async search(query: string, context: PlaceSearchContext = {}) {
    const url = new URL("https://api.geoapify.com/v1/geocode/search");
    url.searchParams.set("text", query);
    url.searchParams.set("format", "geojson");
    url.searchParams.set("limit", "8");
    url.searchParams.set("apiKey", this.apiKey);
    if (context.language) url.searchParams.set("lang", context.language);
    if (context.latitude != null && context.longitude != null)
      url.searchParams.set(
        "bias",
        `proximity:${context.longitude},${context.latitude}`,
      );
    const fetcher = this.fetcher;
    const response = await fetcher(url, { signal: context.signal });
    if (!response.ok) throw new Error("Place provider request failed");
    const body = (await response.json()) as { features?: GeoapifyFeature[] };
    return (body.features ?? [])
      .map(normalizeGeoapifyFeature)
      .filter((place): place is NormalizedPlace => place !== null);
  }
  async searchGeographicCandidates(query: string, signal?: AbortSignal): Promise<GeographicCandidate[]> {
    const url = new URL("https://api.geoapify.com/v1/geocode/search");
    url.searchParams.set("text", query);
    url.searchParams.set("format", "geojson");
    url.searchParams.set("limit", "8");
    url.searchParams.set("apiKey", this.apiKey);
    const response = await this.fetcher(url, { signal });
    if (!response.ok) throw new Error("Geocoding provider request failed");
    const body = (await response.json()) as { features?: GeoapifyFeature[] };
    return (body.features ?? []).flatMap((feature, providerRank) => {
      const properties = feature.properties ?? {},
        coordinates = feature.geometry?.coordinates,
        pointCoordinates = geoapifyPointCoordinates(coordinates),
        longitude = properties.lon ?? pointCoordinates?.[0],
        latitude = properties.lat ?? pointCoordinates?.[1];
      if (
        !properties.place_id ||
        latitude == null ||
        longitude == null ||
        !properties.formatted
      )
        return [];
      const timezone = properties.timezone?.name;
      let validTimezone: string | undefined;
      if (timezone)
        try {
          new Intl.DateTimeFormat("en", { timeZone: timezone }).format();
          validTimezone = timezone;
        } catch {
          validTimezone = undefined;
        }
      return [{
        name: properties.name ?? properties.city ?? properties.formatted,
        formattedAddress: properties.formatted,
        latitude,
        longitude,
        provider: "geoapify" as const,
        providerPlaceId: properties.place_id,
        resultType: properties.result_type,
        categories: properties.categories ?? [],
        city: properties.city,
        region: properties.state ?? properties.county,
        country: properties.country,
        confidence: properties.rank?.confidence,
        providerRank,
        ...(validTimezone ? { timezone: validTimezone } : {}),
      }];
    });
  }
  async searchDestination(query: string, signal?: AbortSignal) {
    const candidates = await this.searchGeographicCandidates(query, signal);
    return candidates.map(({ resultType: _resultType, categories: _categories, city: _city, region: _region, country: _country, confidence: _confidence, providerRank: _providerRank, ...destination }) => destination);
  }
  async getDetails(id: string, signal?: AbortSignal) {
    const url = new URL("https://api.geoapify.com/v2/place-details");
    url.searchParams.set("id", id);
    url.searchParams.set("apiKey", this.apiKey);
    const fetcher = this.fetcher;
    const response = await fetcher(url, { signal });
    if (!response.ok) throw new Error("Place provider request failed");
    const body = (await response.json()) as { features?: GeoapifyFeature[] };
    const place =
      body.features?.[0] && normalizeGeoapifyFeature(body.features[0]);
    if (!place) throw new Error("Place not found");
    return place;
  }
  async getDetailsAtCoordinates(latitude: number, longitude: number, signal?: AbortSignal) {
    const url = new URL("https://api.geoapify.com/v2/place-details");
    url.searchParams.set("lat", String(latitude));
    url.searchParams.set("lon", String(longitude));
    url.searchParams.set("apiKey", this.apiKey);
    const response = await this.fetcher(url, { signal });
    if (!response.ok) throw new Error("Place provider request failed");
    const body = (await response.json()) as { features?: GeoapifyFeature[] };
    return (body.features ?? []).map(normalizeGeoapifyFeature).filter((place): place is NormalizedPlace => place !== null);
  }
  private async discoverResponse(request: PlaceDiscoverySearch) {
    const map: Record<string, string[]> = {
      attraction: ["tourism.attraction", "tourism.sights"],
      museum: ["entertainment.museum"],
      park: ["leisure.park"],
      beach: [
        "beach",
        "natural.coastal",
        "maritime.marina",
        "man_made.pier",
        "man_made.lighthouse",
        "tourism.sights.lighthouse",
      ],
      viewpoint: ["tourism.attraction.viewpoint"],
      shopping: ["commercial"],
      restaurant: ["catering.restaurant"],
      cafe: [
        "catering.cafe",
        "catering.cafe.coffee",
        "catering.cafe.coffee_shop",
      ],
      nightlife: ["adult.nightclub"],
      parking: ["parking"],
    };
    const providerCategories = [
      ...new Set(request.categories.flatMap((x) => map[x] ?? [])),
    ];
    const url = new URL("https://api.geoapify.com/v2/places");
    url.searchParams.set(
      "categories",
      providerCategories.join(",") || "tourism",
    );
    url.searchParams.set("filter", request.providerAreaPlaceId ? `place:${request.providerAreaPlaceId}` : `circle:${request.longitude},${request.latitude},${request.radiusMeters ?? 20000}`);
    url.searchParams.set(
      "bias",
      `proximity:${request.longitude},${request.latitude}`,
    );
    url.searchParams.set("limit", String(Math.min(20, request.limit ?? 20)));
    url.searchParams.set("apiKey", this.apiKey);
    if (request.language) url.searchParams.set("lang", request.language);
    if (request.query) url.searchParams.set("name", request.query);
    const response = await this.fetcher(url, { signal: request.signal });
    if (!response.ok) throw new Error("Place provider request failed");
    const body = (await response.json()) as { features?: GeoapifyFeature[] };
    const raw = body.features ?? [];
    const places = raw
      .map(normalizeGeoapifyFeature)
      .filter((place): place is NormalizedPlace => place !== null);
    return { places, rawCount: raw.length, normalizedCount: places.length };
  }

  async discover(request: PlaceDiscoverySearch) {
    return (await this.discoverResponse(request)).places;
  }

  async discoverWithDiagnostics(request: PlaceDiscoverySearch) {
    return this.discoverResponse(request);
  }
}
