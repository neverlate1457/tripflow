import type { Coordinate, LineString } from "./routing";

export const transitModes = ["bus", "metro", "rail", "tram", "ferry"] as const;
export type TransitMode = (typeof transitModes)[number];
export const transitEvidenceKinds = ["scheduled", "realtime_adjusted", "estimated"] as const;
export type TransitEvidenceKind = (typeof transitEvidenceKinds)[number];
export const MAX_TRANSIT_WALK_METERS = 50_000;

export interface TransitJourneyRequest {
  origin: Coordinate;
  destination: Coordinate;
  departureAt?: string;
  arriveBy?: string;
  timezone: string;
  allowedModes?: TransitMode[];
  maxWalkMeters?: number;
}

export interface TransitStop {
  name: string;
  coordinates: Coordinate;
  provider: string;
  providerStopId: string;
  platform?: string;
  parentStation?: { name: string; providerStationId?: string };
  timezone?: string;
}

interface TimedJourneyLeg {
  departureTime: string;
  arrivalTime: string;
  durationSeconds: number;
  geometry?: LineString;
}

export interface TransitWalkLeg extends TimedJourneyLeg {
  type: "walk";
  origin: Coordinate;
  destination: Coordinate;
  distanceMeters?: number;
}

export interface TransitVehicleLeg extends TimedJourneyLeg {
  type: "transit";
  mode: TransitMode;
  boardingStop: TransitStop;
  alightingStop: TransitStop;
  routeName?: string;
  headsign?: string;
  operator?: string;
  providerServiceId?: string;
  providerTripId?: string;
}

export type TransitJourneyLeg = TransitWalkLeg | TransitVehicleLeg;

export interface TransitJourneyEvidence {
  kind: TransitEvidenceKind;
  provider: string;
  retrievedAt: string;
  sourceTimestamp?: string;
  realtimeUpdatedAt?: string;
}

export interface TransitJourney {
  /** Stable only within the provider response; this is not persistence identity. */
  id: string;
  departureTime: string;
  arrivalTime: string;
  durationSeconds: number;
  transfers: number;
  legs: TransitJourneyLeg[];
  evidence: TransitJourneyEvidence;
}

export type TransitJourneyResult =
  | { status: "success"; provider: string; journeys: TransitJourney[] }
  | { status: "no_service"; provider: string; reason?: string }
  | { status: "unsupported"; provider: string; reason: string; capability?: string }
  | { status: "unavailable"; provider: string; reason?: string; retryable: boolean };

export interface TransitJourneyProvider {
  readonly id: string;
  planJourney(
    request: TransitJourneyRequest,
    options?: { signal?: AbortSignal },
  ): Promise<TransitJourneyResult>;
}

export interface TransitJourneyTiming {
  departureTime: string;
  arrivalTime: string;
  effectiveScheduledDurationSeconds: number;
  evidenceKind: TransitEvidenceKind;
}

export function inspectTransitJourney(journey: TransitJourney): TransitJourneyTiming {
  return {
    departureTime: journey.departureTime,
    arrivalTime: journey.arrivalTime,
    effectiveScheduledDurationSeconds: journey.durationSeconds,
    evidenceKind: journey.evidence.kind,
  };
}

const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const exactKeys = (value: Record<string, unknown>, allowed: readonly string[]) =>
  Object.keys(value).every((key) => allowed.includes(key));
const requiredString = (value: unknown) => typeof value === "string" && value.trim().length > 0;
const finiteNonNegative = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0;
const finitePositive = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value > 0;

function validCoordinate(value: unknown): value is Coordinate {
  if (!object(value) || !exactKeys(value, ["latitude", "longitude"])) return false;
  return typeof value.latitude === "number" && Number.isFinite(value.latitude) && value.latitude >= -90 && value.latitude <= 90 &&
    typeof value.longitude === "number" && Number.isFinite(value.longitude) && value.longitude >= -180 && value.longitude <= 180;
}

function validTimezone(value: unknown): value is string {
  if (!requiredString(value)) return false;
  try { new Intl.DateTimeFormat("en", { timeZone: value as string }); return true; } catch { return false; }
}

function timestamp(value: unknown): value is string {
  return typeof value === "string" && /(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value));
}

function assertTimestampOrder(start: string, end: string, code: string) {
  if (Date.parse(end) <= Date.parse(start)) throw new Error(code);
}

export function validateTransitJourneyRequest(value: unknown): TransitJourneyRequest {
  if (!object(value) || !exactKeys(value, ["origin", "destination", "departureAt", "arriveBy", "timezone", "allowedModes", "maxWalkMeters"]))
    throw new Error("INVALID_TRANSIT_JOURNEY_REQUEST");
  if (!validCoordinate(value.origin) || !validCoordinate(value.destination) || !validTimezone(value.timezone))
    throw new Error("INVALID_TRANSIT_JOURNEY_REQUEST");
  if (value.departureAt !== undefined && !timestamp(value.departureAt)) throw new Error("INVALID_TRANSIT_DEPARTURE_TIME");
  if (value.arriveBy !== undefined && !timestamp(value.arriveBy)) throw new Error("INVALID_TRANSIT_ARRIVAL_TIME");
  if (value.departureAt !== undefined && value.arriveBy !== undefined) throw new Error("AMBIGUOUS_TRANSIT_TIME_CONSTRAINT");
  if (value.maxWalkMeters !== undefined && (!finiteNonNegative(value.maxWalkMeters) || value.maxWalkMeters > MAX_TRANSIT_WALK_METERS))
    throw new Error("INVALID_TRANSIT_MAX_WALK_METERS");
  if (value.allowedModes !== undefined && (!Array.isArray(value.allowedModes) || value.allowedModes.length === 0 || value.allowedModes.some((mode) => !transitModes.includes(mode as TransitMode))))
    throw new Error("INVALID_TRANSIT_MODE");
  return value as unknown as TransitJourneyRequest;
}

function validateGeometry(value: unknown): value is LineString {
  return object(value) && exactKeys(value, ["type", "coordinates"]) && value.type === "LineString" && Array.isArray(value.coordinates) && value.coordinates.length >= 2 &&
    value.coordinates.every((point) => Array.isArray(point) && point.length === 2 && point.every((n) => typeof n === "number" && Number.isFinite(n)));
}

function validateStop(value: unknown): value is TransitStop {
  if (!object(value) || !exactKeys(value, ["name", "coordinates", "provider", "providerStopId", "platform", "parentStation", "timezone"])) return false;
  if (!requiredString(value.name) || !validCoordinate(value.coordinates) || !requiredString(value.provider) || !requiredString(value.providerStopId)) return false;
  if (value.platform !== undefined && !requiredString(value.platform)) return false;
  if (value.timezone !== undefined && !validTimezone(value.timezone)) return false;
  if (value.parentStation !== undefined && (!object(value.parentStation) || !exactKeys(value.parentStation, ["name", "providerStationId"]) || !requiredString(value.parentStation.name) || (value.parentStation.providerStationId !== undefined && !requiredString(value.parentStation.providerStationId)))) return false;
  return true;
}

function validateLeg(value: unknown): value is TransitJourneyLeg {
  if (!object(value) || !timestamp(value.departureTime) || !timestamp(value.arrivalTime) || !finitePositive(value.durationSeconds)) return false;
  if (Date.parse(value.arrivalTime) <= Date.parse(value.departureTime)) return false;
  if (value.geometry !== undefined && !validateGeometry(value.geometry)) return false;
  if (value.type === "walk") {
    if (!exactKeys(value, ["type", "origin", "destination", "departureTime", "arrivalTime", "durationSeconds", "distanceMeters", "geometry"])) return false;
    return validCoordinate(value.origin) && validCoordinate(value.destination) && (value.distanceMeters === undefined || finiteNonNegative(value.distanceMeters));
  }
  if (value.type === "transit") {
    if (!exactKeys(value, ["type", "mode", "boardingStop", "alightingStop", "departureTime", "arrivalTime", "durationSeconds", "routeName", "headsign", "operator", "providerServiceId", "providerTripId", "geometry"])) return false;
    if (!transitModes.includes(value.mode as TransitMode) || !validateStop(value.boardingStop) || !validateStop(value.alightingStop)) return false;
    return ["routeName", "headsign", "operator", "providerServiceId", "providerTripId"].every((key) => value[key] === undefined || requiredString(value[key]));
  }
  return false;
}

function validateEvidence(value: unknown): value is TransitJourneyEvidence {
  return object(value) && exactKeys(value, ["kind", "provider", "retrievedAt", "sourceTimestamp", "realtimeUpdatedAt"]) &&
    transitEvidenceKinds.includes(value.kind as TransitEvidenceKind) && requiredString(value.provider) && timestamp(value.retrievedAt) &&
    (value.sourceTimestamp === undefined || timestamp(value.sourceTimestamp)) && (value.realtimeUpdatedAt === undefined || timestamp(value.realtimeUpdatedAt)) &&
    (value.kind === "realtime_adjusted" ? value.realtimeUpdatedAt !== undefined : value.realtimeUpdatedAt === undefined);
}

export function validateTransitJourney(value: unknown): TransitJourney {
  if (!object(value) || !exactKeys(value, ["id", "departureTime", "arrivalTime", "durationSeconds", "transfers", "legs", "evidence"]) ||
    !requiredString(value.id) || !timestamp(value.departureTime) || !timestamp(value.arrivalTime) || !finitePositive(value.durationSeconds) ||
    !Number.isInteger(value.transfers) || (value.transfers as number) < 0 || !Array.isArray(value.legs) || value.legs.length === 0 || !validateEvidence(value.evidence))
    throw new Error("INVALID_TRANSIT_JOURNEY");
  assertTimestampOrder(value.departureTime as string, value.arrivalTime as string, "INVALID_TRANSIT_JOURNEY_CHRONOLOGY");
  if (!value.legs.every(validateLeg)) throw new Error("INVALID_TRANSIT_LEG");
  const legs = value.legs as TransitJourneyLeg[];
  if (legs[0].departureTime !== value.departureTime || legs.at(-1)!.arrivalTime !== value.arrivalTime ||
    legs.some((leg, index) => index > 0 && Date.parse(leg.departureTime) < Date.parse(legs[index - 1].arrivalTime)))
    throw new Error("INVALID_TRANSIT_LEG_CHRONOLOGY");
  const vehicleLegs = legs.filter((leg) => leg.type === "transit").length;
  if (value.transfers !== Math.max(0, vehicleLegs - 1)) throw new Error("INVALID_TRANSIT_TRANSFER_COUNT");
  const elapsedSeconds = (Date.parse(value.arrivalTime as string) - Date.parse(value.departureTime as string)) / 1000;
  if (value.durationSeconds !== elapsedSeconds) throw new Error("INVALID_TRANSIT_JOURNEY_DURATION");
  return value as unknown as TransitJourney;
}

export function validateTransitJourneyResult(value: unknown): TransitJourneyResult {
  if (!object(value) || !requiredString(value.provider) || typeof value.status !== "string") throw new Error("INVALID_TRANSIT_RESULT");
  if (value.status === "success") {
    if (!exactKeys(value, ["status", "provider", "journeys"]) || !Array.isArray(value.journeys) || value.journeys.length === 0) throw new Error("INVALID_TRANSIT_RESULT");
    const journeys = value.journeys.map(validateTransitJourney);
    if (new Set(journeys.map((journey) => journey.id)).size !== journeys.length || journeys.some((journey) => journey.evidence.provider !== value.provider)) throw new Error("INVALID_TRANSIT_RESULT");
    return { status: "success", provider: value.provider as string, journeys };
  }
  if (value.status === "no_service" && exactKeys(value, ["status", "provider", "reason"]) && (value.reason === undefined || requiredString(value.reason))) return value as unknown as TransitJourneyResult;
  if (value.status === "unsupported" && exactKeys(value, ["status", "provider", "reason", "capability"]) && requiredString(value.reason) && (value.capability === undefined || requiredString(value.capability))) return value as unknown as TransitJourneyResult;
  if (value.status === "unavailable" && exactKeys(value, ["status", "provider", "reason", "retryable"]) && typeof value.retryable === "boolean" && (value.reason === undefined || requiredString(value.reason))) return value as unknown as TransitJourneyResult;
  throw new Error("INVALID_TRANSIT_RESULT");
}
