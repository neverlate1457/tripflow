export const itemTypes = [
  "place",
  "restaurant",
  "hotel",
  "transport",
  "flight",
  "note",
] as const;
export type TripItemType = (typeof itemTypes)[number];
export const explicitTransportModes = [
  "train",
  "metro",
  "bus",
  "tram",
  "ferry",
  "flight",
  "car",
  "taxi",
  "shuttle",
  "motorcycle",
  "bicycle",
  "walking",
  "other",
] as const;
export type ExplicitTransportMode = (typeof explicitTransportModes)[number];
export type TransportBehavior = "standalone" | "replace_segment";
export interface ExplicitTransportDetails {
  mode: ExplicitTransportMode;
  from: string;
  to: string;
  service?: string;
  serviceNumber?: string;
  /** Missing on legacy records and interpreted as standalone. */
  behavior?: TransportBehavior;
  boundFromEndpoint?: import("./routing").SegmentEndpoint;
  boundToEndpoint?: import("./routing").SegmentEndpoint;
  boardingPlace?: GroundedPlaceRef | null;
  alightingPlace?: GroundedPlaceRef | null;
}
export interface FlightDetails {
  origin: string;
  destination: string;
  airline?: string;
  flightNumber?: string;
  /** Absent on legacy records; place grounding does not verify the flight schedule. */
  originAirport?: GroundedAirportRef | null;
  destinationAirport?: GroundedAirportRef | null;
}

export interface GroundedAirportRef {
  name: string;
  formattedAddress: string | null;
  latitude: number;
  longitude: number;
  provider: string;
  providerPlaceId: string;
  timezone: string;
  iataCode?: string | null;
  icaoCode?: string | null;
}

export interface Trip {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  timezone: string;
  destination?: TripDestination | null;
  createdAt: string;
  updatedAt: string;
}

export interface GroundedPlaceRef {
  name: string;
  formattedAddress: string | null;
  latitude: number;
  longitude: number;
  provider: string;
  providerPlaceId: string;
  timezone: string | null;
}

export interface DayContext {
  tripId: string;
  date: string;
  startLocation: GroundedPlaceRef | null;
  baseLocation: GroundedPlaceRef | null;
  endLocation: GroundedPlaceRef | null;
  createdAt: string;
  updatedAt: string;
}

export type TripDestination = Omit<
  GroundedPlaceRef,
  "formattedAddress" | "provider" | "timezone"
> & {
  formattedAddress?: string;
  provider: "geoapify";
  timezone?: string;
};

export interface TripItem {
  id: string;
  tripId: string;
  type: TripItemType;
  title: string;
  description: string | null;
  startAt: string;
  endAt: string;
  latitude: number | null;
  longitude: number | null;
  address: string | null;
  placeId: string | null;
  provider?: string | null;
  /** How the routable coordinates entered canonical itinerary state. */
  locationSource?: "manual" | null;
  /** User-entered address/name retained separately from provider formatting. */
  originalLocationInput?: string | null;
  sourceCandidateId?: string | null;
  transportDetails?: ExplicitTransportDetails | null;
  flightDetails?: FlightDetails | null;
  notes: string | null;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
  flexibility: "fixed" | "flexible";
  schedulingConstraint: SchedulingConstraint | null;
  reservation: Reservation | null;
}

export interface ConfirmedManualLocation {
  displayName: string;
  originalInput: string | null;
  formattedAddress: string | null;
  latitude: number;
  longitude: number;
  provider: string | null;
  providerPlaceId: string | null;
  source: "manual";
}

export interface SchedulingConstraint {
  earliestStartAt?: string;
  latestStartAt?: string;
  earliestEndAt?: string;
  latestEndAt?: string;
}
export interface Reservation {
  id: string;
  status: "confirmed" | "pending" | "cancelled";
  provider?: string;
  confirmationCode?: string;
  reservationAt?: string;
  checkInAt?: string;
  checkOutAt?: string;
  url?: string;
  notes?: string;
}
export interface SegmentPreference {
  tripId: string;
  fromEndpointKey: string;
  toEndpointKey: string;
  travelMode: "driving" | "walking" | "cycling" | "transit";
  durationOverrideMinutes?: number | null;
}

export interface Candidate {
  id: string;
  tripId: string;
  type: TripItemType;
  title: string;
  latitude: number | null;
  longitude: number | null;
  address: string | null;
  placeId: string | null;
  provider: string | null;
  estimatedDuration: number;
  notes: string | null;
}

export interface NormalizedPlace {
  provider: string;
  providerPlaceId: string;
  name: string;
  location: { latitude: number; longitude: number };
  address?: string;
  category?: string;
  /** Complete normalized provider category evidence, ordered by provider relevance. */
  categories?: string[];
  rating?: number;
  openingHours?: string;
  attribution?: string;
  timezone?: string;
  iataCode?: string;
  icaoCode?: string;
}

export type PlannerSelection =
  | { type: "tripItem"; id: string }
  | { type: "candidate"; id: string }
  | { type: "searchResult"; id: string }
  | { type: "suggestion"; id: string }
  | { type: "mapPlace"; id: string }
  | { type: "travelSegment"; id: string }
  | null;
