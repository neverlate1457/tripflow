import type { NormalizedPlace } from "@/domain/models";
import { normalizedIataQuery, rankAirportResults } from "@/domain/airport-search";
import { GeoapifyPlaceProvider } from "./geoapify-place-provider";
import { distanceMeters } from "@/domain/map-planning";

const AIRPORTS_CSV_URL = "https://ourairports.com/data/airports.csv";
interface AirportIndexEntry { iataCode: string; name: string; latitude: number; longitude: number; }

function csvRow(line: string) {
  const values: string[] = [];
  let value = "", quoted = false;
  for (let index = 0; index < line.length; index++) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') { value += '"'; index++; }
      else quoted = !quoted;
    } else if (character === "," && !quoted) { values.push(value); value = ""; }
    else value += character;
  }
  values.push(value);
  return values;
}

export function parseAirportIndex(csv: string) {
  const lines = csv.replace(/^\uFEFF/, "").split(/\r?\n/).filter(Boolean);
  const headers = csvRow(lines.shift() ?? ""), at = (name: string) => headers.indexOf(name);
  const iata = at("iata_code"), name = at("name"), latitude = at("latitude_deg"), longitude = at("longitude_deg");
  if ([iata, name, latitude, longitude].some((index) => index < 0)) throw new Error("Malformed airport index");
  const index = new Map<string, AirportIndexEntry>();
  for (const line of lines) {
    const row = csvRow(line), code = row[iata]?.trim().toUpperCase(), lat = Number(row[latitude]), lon = Number(row[longitude]);
    if (/^[A-Z]{3}$/.test(code) && Number.isFinite(lat) && Number.isFinite(lon)) index.set(code, { iataCode: code, name: row[name], latitude: lat, longitude: lon });
  }
  return index;
}

let airportIndexPromise: Promise<Map<string, AirportIndexEntry>> | null = null;
async function defaultAirportIndex(signal?: AbortSignal) {
  if (!airportIndexPromise) airportIndexPromise = fetch(AIRPORTS_CSV_URL, { signal }).then((response) => {
    if (!response.ok) throw new Error("Airport code index unavailable");
    return response.text();
  }).then(parseAirportIndex).catch((error) => { airportIndexPromise = null; throw error; });
  return airportIndexPromise;
}

export interface AirportSearchDependencies {
  places: Pick<GeoapifyPlaceProvider, "search" | "getDetails" | "getDetailsAtCoordinates">;
  loadIndex?: (signal?: AbortSignal) => Promise<Map<string, AirportIndexEntry>>;
}

const airportEvidence = (place: NormalizedPlace) => (place.categories ?? []).some((category) => /(^|\.)airport($|\.)|aerodrome/i.test(category));

export class AirportSearchProvider {
  constructor(private readonly dependencies: AirportSearchDependencies) {}
  async search(query: string, signal?: AbortSignal) {
    const iata = normalizedIataQuery(query);
    if (iata) {
      const indexed = await (this.dependencies.loadIndex ?? defaultAirportIndex)(signal), seed = indexed.get(iata);
      if (!seed) return [];
      const candidates = await this.dependencies.places.search(seed.name, { latitude: seed.latitude, longitude: seed.longitude, signal });
      const detailed = await Promise.all(candidates.slice(0, 8).map(async (candidate) => {
        try { return await this.dependencies.places.getDetails(candidate.providerPlaceId, signal); }
        catch { return null; }
      }));
      return detailed
        .filter((place): place is NormalizedPlace => place !== null && airportEvidence(place) && place.iataCode?.toUpperCase() === iata)
        .sort((a, b) => distanceMeters(seed, a.location) - distanceMeters(seed, b.location) || a.providerPlaceId.localeCompare(b.providerPlaceId));
    }
    const candidates = await this.dependencies.places.search(`${query.trim()} airport`, { signal });
    const detailed = await Promise.all(candidates.slice(0, 8).map(async (candidate) => {
      try { return await this.dependencies.places.getDetails(candidate.providerPlaceId, signal); }
      catch { return null; }
    }));
    return rankAirportResults(query, detailed.filter((place): place is NormalizedPlace => place !== null && airportEvidence(place)));
  }
}
