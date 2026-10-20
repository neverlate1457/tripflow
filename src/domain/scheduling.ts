import type { Candidate, TripItem } from "./models";
import { generateId } from "@/lib/id";
import {
  MIN_DURATION_MINUTES,
  clampStartMinutes,
  durationMinutes,
  snapMinutes,
  zonedDateTime,
} from "./time";

export type UnscheduleEligibility =
  { eligible: true } | { eligible: false; reason: string };

export function unscheduleEligibility(item: TripItem): UnscheduleEligibility {
  if (item.flexibility === "fixed")
    return {
      eligible: false,
      reason: "Fixed activities cannot be unscheduled.",
    };
  if (item.reservation)
    return {
      eligible: false,
      reason: "Reserved activities must be edited explicitly.",
    };
  if (!["place", "restaurant", "hotel"].includes(item.type))
    return {
      eligible: false,
      reason: "This activity type cannot become a saved place.",
    };
  if (!item.placeId || !item.provider)
    return {
      eligible: false,
      reason: "Only provider-backed places can be moved to Want to go.",
    };
  return { eligible: true };
}

export function tripItemToCandidate(item: TripItem): Candidate {
  const eligibility = unscheduleEligibility(item);
  if (!eligibility.eligible) throw new Error("ITEM_NOT_UNSCHEDULABLE");
  return {
    id: item.sourceCandidateId ?? generateId(),
    tripId: item.tripId,
    type: item.type,
    title: item.title,
    latitude: item.latitude,
    longitude: item.longitude,
    address: item.address,
    placeId: item.placeId,
    provider: item.provider ?? null,
    estimatedDuration: durationMinutes(item),
    notes: item.notes,
  };
}

export function candidateToTripItem(
  candidate: Candidate,
  dateKey: string,
  startMinutes: number,
  timezone: string,
  now = new Date().toISOString(),
): TripItem {
  const duration = Math.max(
    MIN_DURATION_MINUTES,
    snapMinutes(candidate.estimatedDuration),
  );
  const startAt = zonedDateTime(
    dateKey,
    clampStartMinutes(snapMinutes(startMinutes), duration),
    timezone,
  );
  return {
    id: `item-${candidate.id}-${Date.now()}`,
    tripId: candidate.tripId,
    type: candidate.type,
    title: candidate.title,
    description: null,
    startAt,
    endAt: new Date(
      new Date(startAt).getTime() + duration * 60_000,
    ).toISOString(),
    latitude: candidate.latitude,
    longitude: candidate.longitude,
    address: candidate.address,
    placeId: candidate.placeId,
    provider: candidate.provider,
    sourceCandidateId: candidate.id,
    notes: candidate.notes,
    sortOrder: 0,
    createdAt: now,
    updatedAt: now,
    flexibility: "flexible",
    schedulingConstraint: null,
    reservation: null,
  };
}
