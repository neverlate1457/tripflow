import type { ConfirmedManualLocation, NormalizedPlace } from "./models";
import { distanceMeters, isValidMapCoordinate } from "./map-planning";

export const MAX_MANUAL_LOCATION_TEXT = 300;

export function manualLocationFromPlace(
  place: NormalizedPlace,
  originalInput: string,
  displayName = place.name,
): ConfirmedManualLocation {
  const location: ConfirmedManualLocation = {
    displayName: displayName.trim() || place.name,
    originalInput: originalInput.trim() || null,
    formattedAddress: place.address?.trim() || null,
    latitude: place.location.latitude,
    longitude: place.location.longitude,
    provider: place.provider,
    providerPlaceId: place.providerPlaceId,
    source: "manual",
  };
  validateManualLocation(location);
  return location;
}

export function manualLocationFromMap(
  latitude: number,
  longitude: number,
  displayName: string,
): ConfirmedManualLocation {
  const location: ConfirmedManualLocation = {
    displayName: displayName.trim(),
    originalInput: null,
    formattedAddress: null,
    latitude,
    longitude,
    provider: null,
    providerPlaceId: null,
    source: "manual",
  };
  validateManualLocation(location);
  return location;
}

export function validateManualLocation(value: ConfirmedManualLocation) {
  if (!value.displayName.trim() || value.displayName.length > MAX_MANUAL_LOCATION_TEXT)
    throw new Error("INVALID_MANUAL_LOCATION_NAME");
  if (value.originalInput != null && value.originalInput.length > MAX_MANUAL_LOCATION_TEXT)
    throw new Error("INVALID_MANUAL_LOCATION_INPUT");
  if (!isValidMapCoordinate(value.latitude, value.longitude))
    throw new Error("INVALID_MANUAL_LOCATION_COORDINATES");
  if ((value.provider == null) !== (value.providerPlaceId == null))
    throw new Error("INVALID_MANUAL_LOCATION_PROVIDER_IDENTITY");
  if (value.source !== "manual") throw new Error("INVALID_MANUAL_LOCATION_SOURCE");
  return value;
}

export function filterPlacesWithinRadius(
  places: NormalizedPlace[],
  center: { latitude: number; longitude: number },
  radiusMeters: number,
) {
  return places
    .map((place) => ({ place, distanceMeters: distanceMeters(center, place.location) }))
    .filter(({ distanceMeters }) => distanceMeters <= radiusMeters)
    .sort((a, b) => a.distanceMeters - b.distanceMeters || a.place.providerPlaceId.localeCompare(b.place.providerPlaceId));
}
