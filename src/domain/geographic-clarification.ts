import type { PlaceSuggestion } from "./discovery";
import type { LineString } from "./routing";
import type { TravelRerankMetadata } from "./travel-relevance";

export interface DiscoveryMapContext {
  anchor: { latitude: number; longitude: number };
  discoveryGeometry: "point" | "corridor";
  geographicScope: "city_area" | "nearby_point" | "corridor";
  routeGeometry?: LineString;
}

export interface GeographicClarificationCandidate {
  candidateId: string;
  provider: string;
  providerPlaceId: string;
  name: string;
  formattedAddress: string | null;
  latitude: number;
  longitude: number;
  featureType: "station" | "airport" | "city_area" | "place";
  attribution: string;
}

export interface GeographicClarificationRequired {
  status: "clarification_required";
  reason: "ambiguous_geography";
  originalRequest: string;
  geographicReference: string;
  geographicScope: "city_area" | "nearby_point" | "corridor";
  corridorEndpoint?: "origin" | "destination";
  clarificationToken: string;
  expiresAt: string;
  candidates: GeographicClarificationCandidate[];
}

export interface DiscoveryReadyResult {
  status: "ready";
  suggestions: PlaceSuggestion[];
  relevanceConfidence?: "full" | "limited";
  context?: DiscoveryMapContext;
  reranking?: TravelRerankMetadata;
}

export interface DiscoveryUnsupportedResult {
  status: "unsupported";
  suggestions: PlaceSuggestion[];
  reason?: string;
}

export type PlaceDiscoveryResult =
  | DiscoveryReadyResult
  | DiscoveryUnsupportedResult
  | GeographicClarificationRequired;
