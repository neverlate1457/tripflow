import type { DayContext, TripItem } from "./models";

export const travelModes = [
  "driving",
  "walking",
  "cycling",
  "transit",
] as const;
export type TravelMode = (typeof travelModes)[number];
export type Coordinate = { latitude: number; longitude: number };
export type SegmentEndpoint =
  | { kind: "trip_item"; tripItemId: string }
  | { kind: "day_start"; date: string }
  | { kind: "day_end"; date: string };
export const segmentEndpointKey = (endpoint: SegmentEndpoint) =>
  endpoint.kind === "trip_item"
    ? `trip-item:${endpoint.tripItemId}`
    : `${endpoint.kind.replace("_", "-")}:${endpoint.date}`;
export type LineString = {
  type: "LineString";
  coordinates: [number, number][];
};
export interface RouteRequest {
  origin: Coordinate;
  destination: Coordinate;
  mode: TravelMode;
  departureAt?: string;
}
export interface NormalizedRoute {
  provider: string;
  origin: Coordinate;
  destination: Coordinate;
  mode: TravelMode;
  durationSeconds: number;
  distanceMeters: number;
  geometry?: LineString;
}
export interface RoutingProvider {
  capabilities: Record<TravelMode, boolean>;
  route(request: RouteRequest): Promise<NormalizedRoute>;
}
export type RoutingStatus = "idle" | "loading" | "loaded" | "error" | "stale";
export const MAX_DURATION_OVERRIDE_MINUTES = 24 * 60;
export type DurationSource = "provider" | "manual";
export interface EffectiveDuration {
  providerDurationSeconds: number | null;
  durationOverrideMinutes: number | null;
  effectiveDurationSeconds: number | null;
  durationSource: DurationSource | null;
}
export function isValidDurationOverride(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && Number.isInteger(value) && value >= 1 && value <= MAX_DURATION_OVERRIDE_MINUTES;
}
export function resolveEffectiveDuration(providerDurationSeconds: number | null, durationOverrideMinutes?: number | null): EffectiveDuration {
  if (durationOverrideMinutes != null && !isValidDurationOverride(durationOverrideMinutes)) throw new Error("INVALID_DURATION_OVERRIDE");
  return durationOverrideMinutes != null
    ? { providerDurationSeconds, durationOverrideMinutes, effectiveDurationSeconds: durationOverrideMinutes * 60, durationSource: "manual" }
    : { providerDurationSeconds, durationOverrideMinutes: null, effectiveDurationSeconds: providerDurationSeconds, durationSource: providerDurationSeconds == null ? null : "provider" };
}
export interface TravelSegment {
  id: string;
  tripId: string;
  date: string;
  fromEndpoint: SegmentEndpoint;
  toEndpoint: SegmentEndpoint;
  fromTripItemId: string | null;
  toTripItemId: string | null;
  mode: TravelMode;
  durationSeconds: number | null;
  durationOverrideMinutes: number | null;
  effectiveDurationSeconds: number | null;
  durationSource: DurationSource | null;
  movementSource?: import("./bound-transport").MovementAuthority;
  boundTransportItemId?: string | null;
  boundTransportDepartureAt?: string | null;
  boundTransportArrivalAt?: string | null;
  boundTransportStatus?: import("./bound-transport").BoundTransportStatus | null;
  distanceMeters: number | null;
  provider: string | null;
  routeGeometry?: LineString;
  routeEvidenceKey?: string;
  calculatedAt: string | null;
  status: RoutingStatus;
  error: string | null;
}
export interface SegmentSpec {
  id: string;
  tripId: string;
  date: string;
  fromEndpoint: SegmentEndpoint;
  toEndpoint: SegmentEndpoint;
  fromTripItemId: string | null;
  toTripItemId: string | null;
  origin: Coordinate;
  destination: Coordinate;
  departureAt?: string;
}

const localDate = (iso: string, timezone: string) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
// Flight/transport entries already represent movement; notes have no destination semantics.
const routable = (item: TripItem) =>
  !["note", "flight", "transport"].includes(item.type) &&
  item.latitude != null &&
  item.longitude != null;
export function deriveSegmentSpecs(
  items: TripItem[],
  timezone: string,
  dayContexts: DayContext[] = [],
): SegmentSpec[] {
  const byDay = new Map<string, TripItem[]>();
  for (const item of items) {
    const day = localDate(item.startAt, timezone);
    byDay.set(day, [...(byDay.get(day) ?? []), item]);
  }
  const specs: SegmentSpec[] = [];
  for (const [date, dayItems] of byDay) {
    dayItems.sort((a, b) => a.startAt.localeCompare(b.startAt));
    // A bound Transport is the edge authority, never an additional routing node.
    const routingItems = dayItems.filter((item) => !(item.type === "transport" && item.transportDetails?.behavior === "replace_segment"));
    const context = dayContexts.find((value) => value.date === date);
    const first = routingItems[0], last = routingItems.at(-1);
    if (context?.startLocation && first && routable(first)) {
      const fromEndpoint: SegmentEndpoint = { kind: "day_start", date }, toEndpoint: SegmentEndpoint = { kind: "trip_item", tripItemId: first.id };
      specs.push({ id: `${segmentEndpointKey(fromEndpoint)}--${first.id}`, tripId: first.tripId, date, fromEndpoint, toEndpoint, fromTripItemId: null, toTripItemId: first.id, origin: { latitude: context.startLocation.latitude, longitude: context.startLocation.longitude }, destination: { latitude: first.latitude!, longitude: first.longitude! } });
    }
    for (let i = 0; i < routingItems.length - 1; i++) {
      const from = routingItems[i],
        to = routingItems[i + 1];
      if (from.id === to.id || !routable(from) || !routable(to)) continue;
      specs.push({
        id: `${from.id}--${to.id}`,
        tripId: from.tripId,
        date,
        fromEndpoint: { kind: "trip_item", tripItemId: from.id },
        toEndpoint: { kind: "trip_item", tripItemId: to.id },
        fromTripItemId: from.id,
        toTripItemId: to.id,
        origin: { latitude: from.latitude!, longitude: from.longitude! },
        destination: { latitude: to.latitude!, longitude: to.longitude! },
        departureAt: from.endAt,
      });
    }
    if (context?.endLocation && last && routable(last)) {
      const fromEndpoint: SegmentEndpoint = { kind: "trip_item", tripItemId: last.id }, toEndpoint: SegmentEndpoint = { kind: "day_end", date };
      specs.push({ id: `${last.id}--${segmentEndpointKey(toEndpoint)}`, tripId: last.tripId, date, fromEndpoint, toEndpoint, fromTripItemId: last.id, toTripItemId: null, origin: { latitude: last.latitude!, longitude: last.longitude! }, destination: { latitude: context.endLocation.latitude, longitude: context.endLocation.longitude }, departureAt: last.endAt });
    }
  }
  return specs;
}
export function routeCacheKey(provider: string, request: RouteRequest) {
  const coord = (n: number) => n.toFixed(5);
  return [
    provider,
    request.mode,
    coord(request.origin.latitude),
    coord(request.origin.longitude),
    coord(request.destination.latitude),
    coord(request.destination.longitude),
  ].join(":");
}
export function feasibility(
  from: TripItem,
  to: TripItem,
  durationSeconds: number,
) {
  const availableSeconds =
    (new Date(to.startAt).getTime() - new Date(from.endAt).getTime()) / 1000;
  const bufferSeconds = availableSeconds - durationSeconds;
  return {
    availableSeconds,
    bufferSeconds,
    state:
      bufferSeconds > 0
        ? ("feasible" as const)
        : bufferSeconds === 0
          ? ("exact" as const)
          : ("insufficient" as const),
  };
}
export function emptySegment(
  spec: SegmentSpec,
  mode: TravelMode = "driving",
  durationOverrideMinutes: number | null = null,
): TravelSegment {
  const duration = resolveEffectiveDuration(null, durationOverrideMinutes);
  return {
    ...spec,
    mode,
    durationSeconds: null,
    durationOverrideMinutes: duration.durationOverrideMinutes,
    effectiveDurationSeconds: duration.effectiveDurationSeconds,
    durationSource: duration.durationSource,
    movementSource: duration.durationSource === "manual" ? "manual_duration" : duration.durationSource === "provider" ? "provider_route" : "unavailable",
    boundTransportItemId: null,
    boundTransportDepartureAt: null,
    boundTransportArrivalAt: null,
    boundTransportStatus: null,
    distanceMeters: null,
    provider: null,
    calculatedAt: null,
    status: "idle",
    error: null,
  };
}
