import type { Trip, TripDestination } from "./models";
import { generateId } from "@/lib/id";

export interface TripInput {
  name: string;
  startDate: string;
  endDate: string;
  timezone: string;
  destination?: TripDestination | null;
}
export interface TripValidation {
  valid: boolean;
  errors: Partial<Record<keyof TripInput, string>>;
}

export function validateTripInput(input: TripInput): TripValidation {
  const errors: TripValidation["errors"] = {};
  if (!input.name.trim()) errors.name = "Name is required.";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.startDate))
    errors.startDate = "Start date is required.";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.endDate))
    errors.endDate = "End date is required.";
  if (input.startDate && input.endDate && input.endDate < input.startDate)
    errors.endDate = "End date must be on or after the start date.";
  try {
    new Intl.DateTimeFormat("en", { timeZone: input.timezone }).format();
  } catch {
    errors.timezone = "Choose a valid timezone.";
  }
  if (input.destination !== undefined && input.destination !== null) {
    const destination = input.destination;
    if (
      destination.provider !== "geoapify" ||
      !destination.providerPlaceId ||
      !destination.name.trim() ||
      !Number.isFinite(destination.latitude) ||
      !Number.isFinite(destination.longitude) ||
      destination.latitude < -90 ||
      destination.latitude > 90 ||
      destination.longitude < -180 ||
      destination.longitude > 180
    )
      errors.destination = "Choose a valid destination search result.";
    if (destination.timezone) {
      try {
        new Intl.DateTimeFormat("en", {
          timeZone: destination.timezone,
        }).format();
      } catch {
        errors.destination = "Destination returned an invalid timezone.";
      }
    }
  }
  return { valid: Object.keys(errors).length === 0, errors };
}

export function createTrip(
  input: TripInput,
  id = generateId(),
  now = new Date().toISOString(),
): Trip {
  return {
    id,
    name: input.name.trim(),
    startDate: input.startDate,
    endDate: input.endDate,
    timezone: input.timezone,
    destination: input.destination ?? null,
    createdAt: now,
    updatedAt: now,
  };
}
