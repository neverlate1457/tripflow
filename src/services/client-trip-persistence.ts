import {
  explicitTransportModes,
  itemTypes,
  type Candidate,
  type Trip,
  type TripItem,
} from "@/domain/models";
import type { TripSnapshot } from "./trip-repository";
import { validateConstraint, validateReservation } from "@/domain/constraints";
import { validateDayContext } from "@/domain/day-context";
import { validateGroundedPlaceRef } from "@/domain/bound-transport";
import { normalizeFlightDetails, validateFlightDetailsShape, validatePersistedFlight } from "@/domain/flight";
import { isValidMapCoordinate } from "@/domain/map-planning";

export interface TripPersistence {
  loadTrip(id: string): Promise<TripSnapshot>;
  saveTrip(snapshot: TripSnapshot): Promise<void>;
}

export class TripNotFoundError extends Error {}
export class MalformedTripResponseError extends Error {}

function isString(value: unknown): value is string {
  return typeof value === "string";
}
function isNullableString(value: unknown): value is string | null {
  return value === null || isString(value);
}
function isNullableNumber(value: unknown): value is number | null {
  return value === null || typeof value === "number";
}

function isTrip(value: unknown): value is Trip {
  if (!value || typeof value !== "object") return false;
  const trip = value as Record<string, unknown>;
  const base = [
    "id",
    "name",
    "startDate",
    "endDate",
    "timezone",
    "createdAt",
    "updatedAt",
  ].every((key) => isString(trip[key]));
  const destination = trip.destination;
  return base && (destination === undefined || destination === null || (
    typeof destination === "object" &&
    (destination as Record<string, unknown>).provider === "geoapify" &&
    isString((destination as Record<string, unknown>).providerPlaceId) &&
    isString((destination as Record<string, unknown>).name) &&
    typeof (destination as Record<string, unknown>).latitude === "number" &&
    typeof (destination as Record<string, unknown>).longitude === "number"
  ));
}

function isTripItem(value: unknown, trip: Trip): value is TripItem {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return (
    isString(item.id) &&
    isString(item.tripId) &&
    itemTypes.includes(item.type as TripItem["type"]) &&
    isString(item.title) &&
    isNullableString(item.description) &&
    isString(item.startAt) &&
    isString(item.endAt) &&
    isNullableNumber(item.latitude) &&
    isNullableNumber(item.longitude) &&
    isNullableString(item.address) &&
    isNullableString(item.placeId) &&
    (item.provider === undefined || isNullableString(item.provider)) &&
    (item.locationSource === undefined || item.locationSource === null || item.locationSource === "manual") &&
    (item.originalLocationInput === undefined || isNullableString(item.originalLocationInput)) &&
    (item.locationSource !== "manual" || (typeof item.latitude === "number" && typeof item.longitude === "number" && isValidMapCoordinate(item.latitude, item.longitude))) &&
    (item.sourceCandidateId === undefined ||
      isNullableString(item.sourceCandidateId)) &&
    validTransportDetails(item.transportDetails) &&
    validFlightDetails(item.flightDetails) &&
    isNullableString(item.notes) &&
    typeof item.sortOrder === "number" &&
    isString(item.createdAt) &&
    isString(item.updatedAt) &&
    (item.flexibility === undefined ||
      ["fixed", "flexible"].includes(item.flexibility as string)) &&
    (item.schedulingConstraint === undefined ||
      item.schedulingConstraint === null ||
      typeof item.schedulingConstraint === "object") &&
    (item.reservation === undefined ||
      item.reservation === null ||
      typeof item.reservation === "object") &&
    validateConstraint(
      (item.schedulingConstraint ?? null) as TripItem["schedulingConstraint"],
    ).length === 0 &&
    validateReservation((item.reservation ?? null) as TripItem["reservation"])
      .length === 0 &&
    (item.type !== "flight" || validatePersistedFlight(item as unknown as TripItem, trip))
  );
}

function validTransportDetails(value: unknown) {
  if (value === undefined || value === null) return true;
  if (typeof value !== "object") return false;
  const data = value as Record<string, unknown>;
  if (!Object.keys(data).every((key) => ["mode", "from", "to", "service", "serviceNumber", "behavior", "boundFromEndpoint", "boundToEndpoint", "boardingPlace", "alightingPlace"].includes(key))) return false;
  const endpoint = (entry: unknown) => !!entry && typeof entry === "object" && (((entry as Record<string, unknown>).kind === "trip_item" && isString((entry as Record<string, unknown>).tripItemId)) || (["day_start", "day_end"].includes((entry as Record<string, unknown>).kind as string) && isString((entry as Record<string, unknown>).date)));
  const behavior = data.behavior ?? "standalone";
  return (
    explicitTransportModes.includes(data.mode as never) &&
    isString(data.from) &&
    isString(data.to) &&
    ["standalone", "replace_segment"].includes(behavior as string) &&
    (behavior !== "replace_segment" || (endpoint(data.boundFromEndpoint) && endpoint(data.boundToEndpoint))) &&
    (data.boardingPlace === undefined || data.boardingPlace === null || validateGroundedPlaceRef(data.boardingPlace)) &&
    (data.alightingPlace === undefined || data.alightingPlace === null || validateGroundedPlaceRef(data.alightingPlace)) &&
    (data.service === undefined || isString(data.service)) &&
    (data.serviceNumber === undefined || isString(data.serviceNumber))
  );
}
function validFlightDetails(value: unknown) {
  if (value === undefined || value === null) return true;
  return validateFlightDetailsShape(value);
}

function isCandidate(value: unknown): value is Candidate {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    isString(candidate.id) &&
    isString(candidate.tripId) &&
    itemTypes.includes(candidate.type as Candidate["type"]) &&
    isString(candidate.title) &&
    isNullableNumber(candidate.latitude) &&
    isNullableNumber(candidate.longitude) &&
    isNullableString(candidate.address) &&
    isNullableString(candidate.placeId) &&
    isNullableString(candidate.provider) &&
    typeof candidate.estimatedDuration === "number" &&
    isNullableString(candidate.notes)
  );
}

export function parseTripSnapshot(value: unknown): TripSnapshot {
  if (!value || typeof value !== "object")
    throw new MalformedTripResponseError("Malformed trip response");
  const snapshot = value as Record<string, unknown>;
  if (
    !isTrip(snapshot.trip) ||
    !Array.isArray(snapshot.items) ||
    !snapshot.items.every((item) => isTripItem(item, snapshot.trip as Trip)) ||
    !Array.isArray(snapshot.candidates) ||
    !snapshot.candidates.every(isCandidate)
  ) {
    throw new MalformedTripResponseError("Malformed trip response");
  }
  const preferences = snapshot.segmentPreferences ?? [];
  if (
    !Array.isArray(preferences) ||
    !preferences.every(
      (value) =>
        value &&
        typeof value === "object" &&
        typeof value.tripId === "string" &&
        typeof value.fromEndpointKey === "string" &&
        typeof value.toEndpointKey === "string" &&
        (value.durationOverrideMinutes === undefined || value.durationOverrideMinutes === null || (typeof value.durationOverrideMinutes === "number" && Number.isInteger(value.durationOverrideMinutes) && value.durationOverrideMinutes >= 1 && value.durationOverrideMinutes <= 1440)) &&
        ["driving", "walking", "cycling", "transit"].includes(value.travelMode),
    )
  )
    throw new MalformedTripResponseError("Malformed trip response");
  const dayContexts = snapshot.dayContexts ?? [];
  if (!Array.isArray(dayContexts) || !dayContexts.every((value) => validateDayContext(value, snapshot.trip as Trip)))
    throw new MalformedTripResponseError("Malformed trip response");
  return {
    trip: snapshot.trip,
    items: snapshot.items.map((item) => ({
      ...item,
      provider: item.provider ?? null,
      locationSource: item.locationSource ?? null,
      originalLocationInput: item.originalLocationInput ?? null,
      sourceCandidateId: item.sourceCandidateId ?? null,
      transportDetails: item.transportDetails ? { ...item.transportDetails, behavior: item.transportDetails.behavior ?? "standalone", boardingPlace: item.transportDetails.boardingPlace ?? null, alightingPlace: item.transportDetails.alightingPlace ?? null } : null,
      flightDetails: item.flightDetails ? normalizeFlightDetails(item.flightDetails) : null,
      ...(item.type === "flight" ? { address: item.address?.trim() || null, notes: item.notes?.trim() || null } : {}),
      flexibility: item.flexibility ?? "flexible",
      schedulingConstraint: item.schedulingConstraint ?? null,
      reservation: item.reservation ?? null,
    })),
    candidates: snapshot.candidates,
    segmentPreferences: preferences.map((preference) => ({ ...preference, durationOverrideMinutes: preference.durationOverrideMinutes ?? null })),
    dayContexts,
  };
}

export class HttpTripPersistence implements TripPersistence {
  constructor(private readonly fetcher: typeof fetch = fetch) {}
  private url(id: string) {
    const path = `/api/trips/${encodeURIComponent(id)}`;
    return typeof window === "undefined"
      ? path
      : new URL(path, window.location.origin).toString();
  }
  async loadTrip(id: string): Promise<TripSnapshot> {
    const fetcher = this.fetcher;
    const response = await fetcher(this.url(id));
    if (response.status === 404) throw new TripNotFoundError("Trip not found");
    if (!response.ok) throw new Error("Unable to load trip");
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new MalformedTripResponseError("Malformed trip response");
    }
    return parseTripSnapshot(body);
  }
  async saveTrip(snapshot: TripSnapshot): Promise<void> {
    const fetcher = this.fetcher;
    const response = await fetcher(this.url(snapshot.trip.id), {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(snapshot),
    });
    if (!response.ok) throw new Error("Unable to save trip");
  }
}

export class PersistenceCoordinator {
  private queue: Promise<void> = Promise.resolve();
  constructor(private readonly persistence: TripPersistence) {}
  loadTrip(id: string) {
    return this.persistence.loadTrip(id);
  }
  saveTrip(snapshot: TripSnapshot): Promise<void> {
    const operation = this.queue
      .catch(() => undefined)
      .then(() => this.persistence.saveTrip(snapshot));
    this.queue = operation;
    return operation;
  }
}
