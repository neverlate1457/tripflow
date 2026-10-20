import type { Candidate, NormalizedPlace, TripItemType } from "./models";
import { generateId } from "@/lib/id";

const categoryRules: Array<[RegExp, TripItemType]> = [
  [/restaurant|cafe|coffee|food|fast_food|bar|bakery/i, "restaurant"],
  [/hotel|hostel|motel|accommodation|guest_house/i, "hotel"],
  [/airport|station|bus|ferry|transport|parking/i, "transport"],
];

export function categoryToTripItemType(category?: string): TripItemType {
  return (
    categoryRules.find(([pattern]) => pattern.test(category ?? ""))?.[1] ??
    "place"
  );
}

export function placeToCandidate(
  place: NormalizedPlace,
  tripId: string,
  id: string = generateId(),
): Candidate {
  return {
    id,
    tripId,
    type: categoryToTripItemType(place.category),
    title: place.name,
    latitude: place.location.latitude,
    longitude: place.location.longitude,
    address: place.address ?? null,
    placeId: place.providerPlaceId,
    provider: place.provider,
    estimatedDuration: place.category?.match(/restaurant|cafe|food/i) ? 60 : 90,
    notes: null,
  };
}

export function hasCandidateForPlace(
  candidates: Candidate[],
  place: NormalizedPlace,
): boolean {
  return candidates.some(
    (candidate) =>
      candidate.provider === place.provider &&
      candidate.placeId === place.providerPlaceId,
  );
}
