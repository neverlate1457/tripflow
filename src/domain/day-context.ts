import type { DayContext, GroundedPlaceRef, Trip } from "./models";

const exactKeys = (value: Record<string, unknown>, keys: string[]) =>
  Object.keys(value).every((key) => keys.includes(key));

export function isGroundedPlaceRef(value: unknown): value is GroundedPlaceRef {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const place = value as Record<string, unknown>;
  return exactKeys(place, ["name", "formattedAddress", "latitude", "longitude", "provider", "providerPlaceId", "timezone"]) &&
    typeof place.name === "string" && Boolean(place.name.trim()) &&
    (place.formattedAddress === null || typeof place.formattedAddress === "string") &&
    typeof place.latitude === "number" && Number.isFinite(place.latitude) && place.latitude >= -90 && place.latitude <= 90 &&
    typeof place.longitude === "number" && Number.isFinite(place.longitude) && place.longitude >= -180 && place.longitude <= 180 &&
    typeof place.provider === "string" && Boolean(place.provider.trim()) &&
    typeof place.providerPlaceId === "string" && Boolean(place.providerPlaceId.trim()) && place.providerPlaceId.length <= 512 &&
    (place.timezone === null || typeof place.timezone === "string");
}

export function isValidDayContextDate(date: string, trip: Pick<Trip, "startDate" | "endDate">) {
  return /^\d{4}-\d{2}-\d{2}$/.test(date) && date >= trip.startDate && date <= trip.endDate;
}

export function validateDayContext(value: unknown, trip: Pick<Trip, "id" | "startDate" | "endDate">): value is DayContext {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const context = value as Record<string, unknown>;
  if (!exactKeys(context, ["tripId", "date", "startLocation", "baseLocation", "endLocation", "createdAt", "updatedAt"]) ||
    context.tripId !== trip.id || typeof context.date !== "string" || !isValidDayContextDate(context.date, trip) ||
    typeof context.createdAt !== "string" || typeof context.updatedAt !== "string") return false;
  return [context.startLocation, context.baseLocation, context.endLocation].every((location) => location === null || isGroundedPlaceRef(location));
}

export function isEmptyDayContext(value: Pick<DayContext, "startLocation" | "baseLocation" | "endLocation">) {
  return value.startLocation === null && value.baseLocation === null && value.endLocation === null;
}

export function createDayContext(trip: Trip, date: string, input: Pick<DayContext, "startLocation" | "baseLocation" | "endLocation">, now = new Date().toISOString()): DayContext {
  const value: DayContext = { tripId: trip.id, date, ...input, createdAt: now, updatedAt: now };
  if (!validateDayContext(value, trip)) throw new Error("INVALID_DAY_CONTEXT");
  return value;
}
