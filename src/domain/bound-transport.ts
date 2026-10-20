import type { ExplicitTransportDetails, GroundedPlaceRef, TripItem } from "./models";
import { durationMinutes } from "./time";
import { segmentEndpointKey, type SegmentSpec, type TravelSegment } from "./routing";

export type MovementAuthority = "bound_transport" | "manual_duration" | "provider_route" | "unavailable";
export type BoundTransportStatus = "active" | "inactive" | "conflict";

export const transportBehavior = (item: Pick<TripItem, "type" | "transportDetails">) =>
  item.type === "transport" && item.transportDetails?.behavior === "replace_segment" ? "replace_segment" : "standalone";

export const isBoundTransport = (item: Pick<TripItem, "type" | "transportDetails">) => transportBehavior(item) === "replace_segment";

export function transportBindingKey(details: ExplicitTransportDetails | null | undefined): string | null {
  if (details?.behavior !== "replace_segment" || !details.boundFromEndpoint || !details.boundToEndpoint) return null;
  return `${segmentEndpointKey(details.boundFromEndpoint)}--${segmentEndpointKey(details.boundToEndpoint)}`;
}

export const segmentBindingKey = (segment: Pick<TravelSegment | SegmentSpec, "fromEndpoint" | "toEndpoint">) =>
  `${segmentEndpointKey(segment.fromEndpoint)}--${segmentEndpointKey(segment.toEndpoint)}`;

export function activeBoundTransportsForSegment(segment: Pick<TravelSegment | SegmentSpec, "fromEndpoint" | "toEndpoint" | "tripId">, items: TripItem[]) {
  const key = segmentBindingKey(segment);
  return items.filter((item) => item.tripId === segment.tripId && isBoundTransport(item) && transportBindingKey(item.transportDetails) === key);
}

export interface EffectiveMovement {
  source: MovementAuthority;
  effectiveDurationSeconds: number | null;
  boundTransport: TripItem | null;
  boundTransportStatus: BoundTransportStatus | null;
}

export function resolveEffectiveMovement(segment: TravelSegment, items: TripItem[]): EffectiveMovement {
  const matches = activeBoundTransportsForSegment(segment, items);
  if (matches.length > 1) return { source: segment.durationOverrideMinutes != null ? "manual_duration" : segment.durationSeconds != null ? "provider_route" : "unavailable", effectiveDurationSeconds: segment.durationOverrideMinutes != null ? segment.durationOverrideMinutes * 60 : segment.durationSeconds, boundTransport: null, boundTransportStatus: "conflict" };
  if (matches.length === 1) return { source: "bound_transport", effectiveDurationSeconds: durationMinutes(matches[0]) * 60, boundTransport: matches[0], boundTransportStatus: "active" };
  return {
    source: segment.durationOverrideMinutes != null ? "manual_duration" : segment.durationSeconds != null ? "provider_route" : "unavailable",
    effectiveDurationSeconds: segment.durationOverrideMinutes != null ? segment.durationOverrideMinutes * 60 : segment.durationSeconds,
    boundTransport: null,
    boundTransportStatus: null,
  };
}

export function applyEffectiveMovement(segment: TravelSegment, items: TripItem[]): TravelSegment {
  const resolved = resolveEffectiveMovement(segment, items);
  return {
    ...segment,
    effectiveDurationSeconds: resolved.effectiveDurationSeconds,
    movementSource: resolved.source,
    boundTransportItemId: resolved.boundTransport?.id ?? null,
    boundTransportDepartureAt: resolved.boundTransport?.startAt ?? null,
    boundTransportArrivalAt: resolved.boundTransport?.endAt ?? null,
    boundTransportStatus: resolved.boundTransportStatus,
  };
}

export function validateGroundedPlaceRef(value: unknown): value is GroundedPlaceRef {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const place = value as Record<string, unknown>;
  return Object.keys(place).every((key) => ["name", "formattedAddress", "latitude", "longitude", "provider", "providerPlaceId", "timezone"].includes(key)) && typeof place.name === "string" && typeof place.latitude === "number" && Number.isFinite(place.latitude) && place.latitude >= -90 && place.latitude <= 90 && typeof place.longitude === "number" && Number.isFinite(place.longitude) && place.longitude >= -180 && place.longitude <= 180 && typeof place.provider === "string" && !!place.provider && typeof place.providerPlaceId === "string" && !!place.providerPlaceId && (place.formattedAddress === null || typeof place.formattedAddress === "string") && (place.timezone === null || typeof place.timezone === "string");
}

export function bindingIsValid(details: ExplicitTransportDetails | null | undefined, specs: SegmentSpec[]) {
  const key = transportBindingKey(details);
  return key != null && specs.some((spec) => segmentBindingKey(spec) === key);
}
