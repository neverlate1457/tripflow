import { randomUUID } from "node:crypto";
import type { DiscoverPlacesIntent } from "@/domain/discovery";
import {
  geographicCandidateFeatureKind,
  geographicReferenceKind,
  type ScoredGeographicCandidate,
} from "@/domain/geographic-resolution";
import type { GeographicClarificationCandidate } from "@/domain/geographic-clarification";
import type { GeographicCandidate } from "./place-provider";

const SESSION_TTL_MS = 5 * 60_000;
const SESSION_LIMIT = 50;
const CANDIDATE_LIMIT = 5;

interface StoredCandidate {
  candidateId: string;
  candidate: GeographicCandidate;
}

export interface GeographicClarificationSession {
  token: string;
  tripId: string;
  tripUpdatedAt: string;
  date: string;
  originalRequest: string;
  geographicReference: string;
  geographicScope: "city_area" | "nearby_point" | "corridor";
  corridorEndpoint?: "origin" | "destination";
  intent: DiscoverPlacesIntent;
  requestId?: string;
  candidates: StoredCandidate[];
  expiresAt: number;
  consumed: boolean;
}

const sessions = new Map<string, GeographicClarificationSession>();

function cleanup(now: number) {
  for (const [token, session] of sessions)
    if (session.expiresAt <= now) sessions.delete(token);
  while (sessions.size >= SESSION_LIMIT)
    sessions.delete(sessions.keys().next().value!);
}

function publicCandidate(entry: StoredCandidate): GeographicClarificationCandidate {
  const candidate = entry.candidate;
  return {
    candidateId: entry.candidateId,
    provider: candidate.provider,
    providerPlaceId: candidate.providerPlaceId,
    name: candidate.name,
    formattedAddress: candidate.formattedAddress ?? null,
    latitude: candidate.latitude,
    longitude: candidate.longitude,
    featureType: geographicCandidateFeatureKind(candidate),
    attribution: candidate.provider === "geoapify" ? "Powered by Geoapify" : candidate.provider,
  };
}

export function relevantClarificationCandidates(
  reference: string,
  scope: "city_area" | "nearby_point" | "corridor",
  scored: ScoredGeographicCandidate[],
) {
  const kind = geographicReferenceKind(reference, scope);
  const minimumScore = kind === "place" ? 10 : 20;
  return scored
    .filter(
      ({ candidate, score }) =>
        score >= minimumScore &&
        (kind === "place" || geographicCandidateFeatureKind(candidate) === kind),
    )
    .slice(0, CANDIDATE_LIMIT);
}

export function createGeographicClarificationSession(input: {
  tripId: string;
  tripUpdatedAt: string;
  date: string;
  originalRequest: string;
  geographicReference: string;
  geographicScope: "city_area" | "nearby_point" | "corridor";
  intent: DiscoverPlacesIntent;
  candidates: ScoredGeographicCandidate[];
  corridorEndpoint?: "origin" | "destination";
  requestId?: string;
  now?: number;
}) {
  const now = input.now ?? Date.now();
  cleanup(now);
  const token = randomUUID();
  const candidates = input.candidates.slice(0, CANDIDATE_LIMIT).map(({ candidate }) => ({
    candidateId: randomUUID(),
    candidate,
  }));
  const session: GeographicClarificationSession = {
    token,
    tripId: input.tripId,
    tripUpdatedAt: input.tripUpdatedAt,
    date: input.date,
    originalRequest: input.originalRequest,
    geographicReference: input.geographicReference,
    geographicScope: input.geographicScope,
    corridorEndpoint: input.corridorEndpoint,
    intent: structuredClone(input.intent),
    requestId: input.requestId,
    candidates,
    expiresAt: now + SESSION_TTL_MS,
    consumed: false,
  };
  sessions.set(token, session);
  return {
    clarificationToken: token,
    expiresAt: new Date(session.expiresAt).toISOString(),
    ...(session.corridorEndpoint ? { corridorEndpoint: session.corridorEndpoint } : {}),
    candidates: candidates.map(publicCandidate),
  };
}

export type ResolveClarificationResult =
  | { status: "resolved"; session: GeographicClarificationSession; candidate: GeographicCandidate }
  | { status: "expired" | "not_found" | "invalid_candidate" | "already_used" };

export function resolveGeographicClarification(
  token: string,
  candidateId: string,
  now = Date.now(),
): ResolveClarificationResult {
  const session = sessions.get(token);
  if (!session) return { status: "not_found" };
  if (session.expiresAt <= now) {
    sessions.delete(token);
    return { status: "expired" };
  }
  if (session.consumed) return { status: "already_used" };
  const selected = session.candidates.find((entry) => entry.candidateId === candidateId);
  if (!selected) return { status: "invalid_candidate" };
  const candidate = selected.candidate;
  if (
    !candidate.providerPlaceId ||
    !candidate.provider ||
    !Number.isFinite(candidate.latitude) ||
    !Number.isFinite(candidate.longitude)
  )
    return { status: "invalid_candidate" };
  session.consumed = true;
  return { status: "resolved", session, candidate };
}

export function clearGeographicClarificationSessions() {
  sessions.clear();
}
