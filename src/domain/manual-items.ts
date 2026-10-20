import {
  explicitTransportModes,
  type Reservation,
  type Trip,
  type TripItem,
  type TripItemType,
  type ConfirmedManualLocation,
} from "./models";
import { MIN_DURATION_MINUTES, snapMinutes, zonedDateTime } from "./time";
import { generateId } from "@/lib/id";
import { validateGroundedPlaceRef } from "./bound-transport";
import type { SegmentEndpoint } from "./routing";
import { flightInstants, normalizeFlightDetails, validateFlightDetailsShape, validateFlightWallClock } from "./flight";
import { validateManualLocation } from "./manual-location";

export interface MovementEdgeOption {
  id: string;
  label: string;
  fromEndpoint: SegmentEndpoint;
  toEndpoint: SegmentEndpoint;
}

export interface ManualItemInput {
  type: TripItemType;
  title?: string;
  startDate: string;
  startMinutes: number;
  endDate: string;
  endMinutes: number;
  address?: string;
  notes?: string;
  reservation?: Reservation | null;
  transportDetails?: TripItem["transportDetails"];
  flightDetails?: TripItem["flightDetails"];
  location?: ConfirmedManualLocation | null;
}

export type ManualItemField =
  | "title"
  | "from"
  | "to"
  | "mode"
  | "binding"
  | "startDate"
  | "startTime"
  | "endDate"
  | "endTime";
export type ManualItemErrors = Partial<Record<ManualItemField, string>>;

export function validateTransportDetails(
  details: TripItem["transportDetails"],
): ManualItemErrors {
  const errors: ManualItemErrors = {};
  if (!details || !explicitTransportModes.includes(details.mode))
    errors.mode = "Choose a transport mode.";
  if (details?.behavior === "replace_segment") {
    if (!details.boundFromEndpoint || !details.boundToEndpoint) errors.binding = "Choose a travel segment.";
    if (details.boardingPlace != null && !validateGroundedPlaceRef(details.boardingPlace)) errors.from = "Choose a provider-backed boarding place.";
    if (details.alightingPlace != null && !validateGroundedPlaceRef(details.alightingPlace)) errors.to = "Choose a provider-backed alighting place.";
  } else {
    if (!details?.from.trim()) errors.from = "Enter an origin.";
    if (!details?.to.trim()) errors.to = "Enter a destination.";
  }
  return errors;
}
export function validateFlightDetails(
  details: TripItem["flightDetails"],
): ManualItemErrors {
  const errors: ManualItemErrors = {};
  if (!details?.origin.trim()) errors.from = "Enter an origin.";
  if (!details?.destination.trim()) errors.to = "Enter a destination.";
  if (details && !validateFlightDetailsShape(details)) errors.from ??= "Choose valid flight endpoints.";
  return errors;
}

export function validateManualItemInput(
  input: ManualItemInput,
  trip: Trip,
): ManualItemErrors {
  const errors: ManualItemErrors = {};
  if (input.location) {
    try { validateManualLocation(input.location); }
    catch { errors.title = "Choose a valid confirmed location."; }
  }
  if (!input.startDate) errors.startDate = "Choose a departure date.";
  else if (input.startDate < trip.startDate || input.startDate > trip.endDate)
    errors.startDate = "Departure date is outside the trip.";
  if (!input.endDate) errors.endDate = "Choose an arrival date.";
  else if (input.endDate < trip.startDate || input.endDate > trip.endDate)
    errors.endDate = "Arrival date is outside the trip.";
  if (
    !Number.isFinite(input.startMinutes) ||
    input.startMinutes < 0 ||
    input.startMinutes >= 1440
  )
    errors.startTime = "Choose a departure time.";
  if (
    !Number.isFinite(input.endMinutes) ||
    input.endMinutes < 0 ||
    input.endMinutes >= 1440
  )
    errors.endTime = "Choose an arrival time.";
  if (input.type === "transport") {
    Object.assign(errors, validateTransportDetails(input.transportDetails));
  } else if (input.type === "flight") {
    Object.assign(errors, validateFlightDetails(input.flightDetails));
  } else if (!input.title?.trim()) errors.title = "Enter a title.";
  if (input.type === "flight" && input.flightDetails && !errors.from && !errors.to) {
    Object.assign(errors, validateFlightWallClock({ startDate: input.startDate, startMinutes: input.startMinutes, endDate: input.endDate, endMinutes: input.endMinutes, details: input.flightDetails, fallbackTimezone: trip.timezone }, trip));
  } else if (
    !errors.startDate &&
    !errors.endDate &&
    !errors.startTime &&
    !errors.endTime
  ) {
    const startAt = zonedDateTime(
        input.startDate,
        snapMinutes(input.startMinutes),
        trip.timezone,
      ),
      endAt = zonedDateTime(
        input.endDate,
        snapMinutes(input.endMinutes),
        trip.timezone,
      );
    if (Date.parse(endAt) - Date.parse(startAt) < MIN_DURATION_MINUTES * 60000)
      errors.endTime =
        "Arrival must be after departure by at least 15 minutes.";
  }
  return errors;
}

export function firstManualItemError(errors: ManualItemErrors) {
  return Object.values(errors)[0] ?? null;
}

export function createManualTripItem(
  input: ManualItemInput,
  trip: Trip,
  now = new Date().toISOString(),
): TripItem {
  const errors = validateManualItemInput(input, trip),
    message = firstManualItemError(errors);
  if (message) throw new Error(message);
  const exactTransportTime = input.type === "transport" || input.type === "flight";
  const startMinutes = exactTransportTime ? input.startMinutes : snapMinutes(input.startMinutes),
    endMinutes = exactTransportTime ? input.endMinutes : snapMinutes(input.endMinutes),
    defaultStartAt = zonedDateTime(input.startDate, startMinutes, trip.timezone),
    defaultEndAt = zonedDateTime(input.endDate, endMinutes, trip.timezone),
    normalizedFlight = input.type === "flight" ? normalizeFlightDetails(input.flightDetails!) : null,
    groundedFlightInstants = normalizedFlight ? flightInstants({ startDate: input.startDate, startMinutes, endDate: input.endDate, endMinutes, details: normalizedFlight, fallbackTimezone: trip.timezone }) : null,
    startAt = groundedFlightInstants?.startAt ?? defaultStartAt,
    endAt = groundedFlightInstants?.endAt ?? defaultEndAt;
  const derived =
    input.type === "transport"
      ? `${input.transportDetails!.from.trim()} → ${input.transportDetails!.to.trim()}`
      : input.type === "flight"
        ? `${normalizedFlight!.origin} → ${normalizedFlight!.destination}`
        : "";
  const title = input.title?.trim() || derived;
  if (!title) throw new Error("TITLE_REQUIRED");
  return {
    id: generateId(),
    tripId: trip.id,
    type: input.type,
    title,
    description: null,
    startAt,
    endAt,
    latitude: input.location?.latitude ?? null,
    longitude: input.location?.longitude ?? null,
    address: input.location?.formattedAddress ?? input.address?.trim() ?? null,
    placeId: input.location?.providerPlaceId ?? null,
    provider: input.location?.provider ?? null,
    locationSource: input.location?.source ?? null,
    originalLocationInput: input.location?.originalInput ?? null,
    sourceCandidateId: null,
    transportDetails:
      input.type === "transport" ? (input.transportDetails ?? null) : null,
    flightDetails:
      input.type === "flight" ? normalizedFlight : null,
    notes: input.notes?.trim() || null,
    sortOrder: 0,
    createdAt: now,
    updatedAt: now,
    flexibility: "flexible",
    schedulingConstraint: null,
    reservation: input.reservation ?? null,
  };
}
