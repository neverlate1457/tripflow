import type { FlightDetails, GroundedAirportRef, Trip, TripItem } from "./models";
import { isValidTimezone } from "@/lib/timezones";
import { MIN_DURATION_MINUTES, localDateKey, zonedDateTime } from "./time";

export const FLIGHT_ENDPOINT_MAX_LENGTH = 160;
export const FLIGHT_METADATA_MAX_LENGTH = 120;
export const FLIGHT_ADDRESS_MAX_LENGTH = 500;
export const FLIGHT_NOTES_MAX_LENGTH = 5000;

export type FlightValidationField =
  | "from" | "to" | "startDate" | "startTime" | "endDate" | "endTime" | "details";
export type FlightValidationErrors = Partial<Record<FlightValidationField, string>>;

const exactKeys = (value: Record<string, unknown>, keys: string[]) =>
  Object.keys(value).every((key) => keys.includes(key));
const bounded = (value: unknown, maximum: number, required = false) =>
  typeof value === "string" && (!required || value.trim().length > 0) && value.trim().length <= maximum;
const validCoordinate = (latitude: unknown, longitude: unknown) =>
  typeof latitude === "number" && Number.isFinite(latitude) && latitude >= -90 && latitude <= 90 &&
  typeof longitude === "number" && Number.isFinite(longitude) && longitude >= -180 && longitude <= 180;

export function validateGroundedAirportRef(value: unknown): value is GroundedAirportRef {
  if (!value || typeof value !== "object") return false;
  const airport = value as Record<string, unknown>;
  if (!exactKeys(airport, ["name", "formattedAddress", "latitude", "longitude", "provider", "providerPlaceId", "timezone", "iataCode", "icaoCode"])) return false;
  return bounded(airport.name, FLIGHT_ENDPOINT_MAX_LENGTH, true) &&
    (airport.formattedAddress === null || bounded(airport.formattedAddress, FLIGHT_ADDRESS_MAX_LENGTH)) &&
    validCoordinate(airport.latitude, airport.longitude) &&
    bounded(airport.provider, FLIGHT_METADATA_MAX_LENGTH, true) &&
    bounded(airport.providerPlaceId, FLIGHT_ENDPOINT_MAX_LENGTH, true) &&
    typeof airport.timezone === "string" && isValidTimezone(airport.timezone) &&
    (airport.iataCode === undefined || airport.iataCode === null || (typeof airport.iataCode === "string" && /^[A-Z]{3}$/.test(airport.iataCode))) &&
    (airport.icaoCode === undefined || airport.icaoCode === null || (typeof airport.icaoCode === "string" && /^[A-Z0-9]{4}$/.test(airport.icaoCode)));
}

export function isGroundedFlight(details: FlightDetails | null | undefined) {
  return !!details?.originAirport && !!details.destinationAirport;
}

export function validateFlightDetailsShape(value: unknown): value is FlightDetails {
  if (!value || typeof value !== "object") return false;
  const details = value as Record<string, unknown>;
  if (!exactKeys(details, ["origin", "destination", "airline", "flightNumber", "originAirport", "destinationAirport"])) return false;
  if (!bounded(details.origin, FLIGHT_ENDPOINT_MAX_LENGTH, true) || !bounded(details.destination, FLIGHT_ENDPOINT_MAX_LENGTH, true)) return false;
  if (details.airline !== undefined && !bounded(details.airline, FLIGHT_METADATA_MAX_LENGTH)) return false;
  if (details.flightNumber !== undefined && !bounded(details.flightNumber, FLIGHT_METADATA_MAX_LENGTH)) return false;
  const origin = details.originAirport, destination = details.destinationAirport;
  if ((origin == null) !== (destination == null)) return false;
  return origin == null || (validateGroundedAirportRef(origin) && validateGroundedAirportRef(destination));
}

const optional = (value: string | undefined, maximum: number) => {
  const normalized = value?.trim();
  return normalized ? normalized.slice(0, maximum) : undefined;
};
const normalizeAirport = (airport: GroundedAirportRef): GroundedAirportRef => ({
  name: airport.name.trim(), formattedAddress: airport.formattedAddress?.trim() || null,
  latitude: airport.latitude, longitude: airport.longitude, provider: airport.provider.trim(),
  providerPlaceId: airport.providerPlaceId.trim(), timezone: airport.timezone,
  ...(optional(airport.iataCode ?? undefined, 3) ? { iataCode: optional(airport.iataCode ?? undefined, 3)!.toUpperCase() } : {}),
  ...(optional(airport.icaoCode ?? undefined, 4) ? { icaoCode: optional(airport.icaoCode ?? undefined, 4)!.toUpperCase() } : {}),
});

export function normalizeFlightDetails(details: FlightDetails): FlightDetails {
  const originAirport = details.originAirport ? normalizeAirport(details.originAirport) : undefined;
  const destinationAirport = details.destinationAirport ? normalizeAirport(details.destinationAirport) : undefined;
  return {
    origin: (originAirport?.iataCode || originAirport?.name || details.origin).trim(),
    destination: (destinationAirport?.iataCode || destinationAirport?.name || details.destination).trim(),
    ...(optional(details.airline, FLIGHT_METADATA_MAX_LENGTH) ? { airline: optional(details.airline, FLIGHT_METADATA_MAX_LENGTH) } : {}),
    ...(optional(details.flightNumber, FLIGHT_METADATA_MAX_LENGTH) ? { flightNumber: optional(details.flightNumber, FLIGHT_METADATA_MAX_LENGTH) } : {}),
    ...(originAirport ? { originAirport } : {}),
    ...(destinationAirport ? { destinationAirport } : {}),
  };
}

export function flightRouteLabel(item: Pick<TripItem, "title" | "flightDetails">) {
  const details = item.flightDetails;
  const origin = details?.originAirport?.iataCode || details?.originAirport?.name || details?.origin;
  const destination = details?.destinationAirport?.iataCode || details?.destinationAirport?.name || details?.destination;
  return origin && destination ? `${origin} → ${destination}` : item.title;
}

export interface FlightWallClockInput {
  startDate: string; startMinutes: number; endDate: string; endMinutes: number;
  details: FlightDetails; fallbackTimezone: string;
}

export function flightInstants(input: FlightWallClockInput) {
  const originTimezone = input.details.originAirport?.timezone ?? input.fallbackTimezone;
  const destinationTimezone = input.details.destinationAirport?.timezone ?? input.fallbackTimezone;
  return {
    startAt: zonedDateTime(input.startDate, input.startMinutes, originTimezone),
    endAt: zonedDateTime(input.endDate, input.endMinutes, destinationTimezone),
    originTimezone, destinationTimezone,
  };
}

export function validateFlightWallClock(input: FlightWallClockInput, trip: Trip): FlightValidationErrors {
  const errors: FlightValidationErrors = {};
  if (!validateFlightDetailsShape(input.details)) errors.details = "Choose valid flight endpoints.";
  if (!input.details.origin.trim()) errors.from = "Enter an origin.";
  if (!input.details.destination.trim()) errors.to = "Enter a destination.";
  if (!input.startDate || input.startDate < trip.startDate || input.startDate > trip.endDate) errors.startDate = "Departure local date is outside the trip.";
  if (!input.endDate || input.endDate < trip.startDate || input.endDate > trip.endDate) errors.endDate = "Arrival local date is outside the trip.";
  if (!Number.isInteger(input.startMinutes) || input.startMinutes < 0 || input.startMinutes >= 1440) errors.startTime = "Choose a departure time.";
  if (!Number.isInteger(input.endMinutes) || input.endMinutes < 0 || input.endMinutes >= 1440) errors.endTime = "Choose an arrival time.";
  if (!Object.keys(errors).length) {
    const { startAt, endAt } = flightInstants(input);
    if (Date.parse(endAt) - Date.parse(startAt) < MIN_DURATION_MINUTES * 60_000)
      errors.endTime = `Arrival must be after departure by at least ${MIN_DURATION_MINUTES} minutes.`;
  }
  return errors;
}

export function validatePersistedFlight(item: TripItem, trip: Trip): boolean {
  if (item.type !== "flight" || !validateFlightDetailsShape(item.flightDetails)) return false;
  if (!Number.isFinite(Date.parse(item.startAt)) || !Number.isFinite(Date.parse(item.endAt))) return false;
  if (Date.parse(item.endAt) - Date.parse(item.startAt) < MIN_DURATION_MINUTES * 60_000) return false;
  if (item.address != null && !bounded(item.address, FLIGHT_ADDRESS_MAX_LENGTH)) return false;
  if (item.notes != null && !bounded(item.notes, FLIGHT_NOTES_MAX_LENGTH)) return false;
  const originTimezone = item.flightDetails.originAirport?.timezone ?? trip.timezone;
  const destinationTimezone = item.flightDetails.destinationAirport?.timezone ?? trip.timezone;
  const departureDate = localDateKey(item.startAt, originTimezone), arrivalDate = localDateKey(item.endAt, destinationTimezone);
  return departureDate >= trip.startDate && departureDate <= trip.endDate && arrivalDate >= trip.startDate && arrivalDate <= trip.endDate;
}
