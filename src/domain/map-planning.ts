import type { NormalizedPlace } from "./models";

export interface MapPlaceHint {
  name: string;
  category?: string;
  latitude: number;
  longitude: number;
}

const normalize = (value: string) =>
  value.normalize("NFKC").toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");

export function distanceMeters(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }) {
  const rad = Math.PI / 180, lat = (b.latitude - a.latitude) * rad, lon = (b.longitude - a.longitude) * rad;
  const x = lon * Math.cos(((a.latitude + b.latitude) / 2) * rad);
  return 6371000 * Math.sqrt(x * x + lat * lat);
}

export function mapPlaceMatchScore(hint: MapPlaceHint, place: NormalizedPlace) {
  const expected = normalize(hint.name), actual = normalize(place.name);
  const name = expected === actual ? 1 : expected && actual && (expected.includes(actual) || actual.includes(expected)) ? 0.78 : 0;
  const distance = distanceMeters(hint, place.location);
  const proximity = distance <= 75 ? 1 : distance <= 250 ? 0.8 : distance <= 750 ? 0.45 : 0;
  const category = hint.category && place.categories?.some((value) => normalize(value).includes(normalize(hint.category!))) ? 1 : 0;
  return { score: name * 0.7 + proximity * 0.25 + category * 0.05, name, distance };
}

export function resolveMapPlace(hint: MapPlaceHint, places: NormalizedPlace[], threshold = 0.72) {
  const ranked = places.map((place) => ({ place, ...mapPlaceMatchScore(hint, place) }))
    .sort((a, b) => b.score - a.score || a.distance - b.distance || a.place.providerPlaceId.localeCompare(b.place.providerPlaceId));
  return ranked[0] && ranked[0].score >= threshold ? ranked[0].place : null;
}

export function isValidMapCoordinate(latitude: number, longitude: number) {
  return Number.isFinite(latitude) && Number.isFinite(longitude) && latitude >= -90 && latitude <= 90 && longitude >= -180 && longitude <= 180;
}
