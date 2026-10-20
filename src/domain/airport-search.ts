import type { GroundedAirportRef, NormalizedPlace } from "./models";
import { validateGroundedAirportRef } from "./flight";

const normalize = (value: string) => value.normalize("NFKC").trim().toLocaleLowerCase();

export function normalizedIataQuery(query: string): string | null {
  const value = query.trim().toUpperCase();
  return /^[A-Z]{3}$/.test(value) ? value : null;
}

export function airportProviderQuery(query: string) {
  const value = query.trim();
  const iata = normalizedIataQuery(value);
  return iata ?? `${value} airport`;
}

export function hasAirportEvidence(place: NormalizedPlace) {
  if ((place.categories ?? []).some((category) => /(^|\.)airport($|\.)|aerodrome/i.test(category))) return true;
  if ((place.categories ?? []).length > 0) return false;
  const providerText = `${place.name} ${place.address ?? ""}`.toLocaleLowerCase();
  return /airport|aerodrome|airfield|空港|機場|机场/.test(providerText);
}

export function rankAirportResults(query: string, places: NormalizedPlace[]) {
  const trimmed = query.trim(), iata = normalizedIataQuery(trimmed), requested = normalize(trimmed);
  const eligible = places.filter((place) => hasAirportEvidence(place) && !!place.timezone);
  // A code lookup is identity-like: never substitute a merely similar airport.
  if (iata) return eligible
    .filter((place) => place.iataCode?.toUpperCase() === iata)
    .sort((a, b) => a.providerPlaceId.localeCompare(b.providerPlaceId));
  return eligible
    .map((place, providerRank) => {
      const name = normalize(place.name), address = normalize(place.address ?? "");
      const match = name === requested ? 3 : name.startsWith(requested) ? 2 : name.includes(requested) || address.includes(requested) ? 1 : 0;
      return { place, match, providerRank };
    })
    .sort((a, b) => b.match - a.match || a.providerRank - b.providerRank || a.place.providerPlaceId.localeCompare(b.place.providerPlaceId))
    .map(({ place }) => place);
}

export function airportRefFromPlace(place: NormalizedPlace): GroundedAirportRef | null {
  const airport: GroundedAirportRef = {
    name: place.name,
    formattedAddress: place.address ?? null,
    latitude: place.location.latitude,
    longitude: place.location.longitude,
    provider: place.provider,
    providerPlaceId: place.providerPlaceId,
    timezone: place.timezone ?? "",
    ...(place.iataCode ? { iataCode: place.iataCode.toUpperCase() } : {}),
    ...(place.icaoCode ? { icaoCode: place.icaoCode.toUpperCase() } : {}),
  };
  return validateGroundedAirportRef(airport) ? airport : null;
}

export function airportLabel(airport: Pick<GroundedAirportRef, "name" | "iataCode">) {
  return airport.iataCode ? `${airport.iataCode} — ${airport.name}` : airport.name;
}
