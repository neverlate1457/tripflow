import type { GeographicCandidate } from "@/services/place-provider";

export type GeographicReferenceKind = "station" | "airport" | "city_area" | "place";
export interface ScoredGeographicCandidate {
  candidate: GeographicCandidate;
  score: number;
  reasons: string[];
}
export interface GeographicRankingContext {
  explicitlyGroundedPeers?: GeographicCandidate[];
  tripDestination?: Pick<GeographicCandidate, "latitude" | "longitude" | "city" | "region" | "country"> | null;
}
export type GeographicResolution =
  | { status: "resolved"; selected: GeographicCandidate; candidates: ScoredGeographicCandidate[] }
  | { status: "ambiguous"; candidates: ScoredGeographicCandidate[] }
  | { status: "not_found"; candidates: ScoredGeographicCandidate[] };

export interface ScoredCorridorCandidatePair {
  origin: ScoredGeographicCandidate;
  destination: ScoredGeographicCandidate;
  score: number;
  distanceKm: number;
  reasons: string[];
}
export type CorridorGeographicResolution =
  | { status: "resolved"; origin: GeographicCandidate; destination: GeographicCandidate; pairs: ScoredCorridorCandidatePair[] }
  | { status: "ambiguous"; endpoint: "origin" | "destination"; candidates: ScoredGeographicCandidate[]; pairs: ScoredCorridorCandidatePair[]; reason: string }
  | { status: "not_found"; pairs: ScoredCorridorCandidatePair[]; reason: string };

const compact = (value: string) => value.normalize("NFKC").toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
const words = (value: string) => value.normalize("NFKC").toLocaleLowerCase().split(/[^\p{L}\p{N}]+/gu).filter(Boolean);
const featureStem = (value:string) => compact(value).replace(/(?:main)?(?:station|駅|車站|车站|站)|(?:international)?(?:airport|aerodrome|空港|機場|机场)|city|市/giu, "");

export function geographicReferenceKind(text: string, scope?: "city_area" | "nearby_point" | "corridor"): GeographicReferenceKind {
  if (/(?:station|駅|站|車站|车站)$/iu.test(text.trim())) return "station";
  if (/(?:airport|aerodrome|空港|機場|机场)$/iu.test(text.trim())) return "airport";
  if (scope === "city_area" || /(?:市|city)$/iu.test(text.trim())) return "city_area";
  return "place";
}

/**
 * A bare Han-script nearby reference can name an administrative locality even
 * when the provider does not index the unsuffixed spelling. These are bounded
 * provider queries, not aliases: they are attempted only after the exact query
 * returned no candidates, and their results still pass normal scoring.
 */
export function fallbackGeographicQueries(
  text: string,
  kind: GeographicReferenceKind,
  scope?: "city_area" | "nearby_point" | "corridor",
) {
  const value = text.trim();
  if (
    scope !== "nearby_point" ||
    kind !== "place" ||
    !/^[\p{Script=Han}]{2,20}$/u.test(value) ||
    /[市区區町村]$/u.test(value)
  )
    return [];
  return [`${value}区`, `${value}市`];
}

function semanticText(candidate: GeographicCandidate) {
  return `${candidate.name} ${candidate.formattedAddress ?? ""} ${candidate.resultType ?? ""} ${candidate.categories.join(" ")} ${candidate.city ?? ""} ${candidate.region ?? ""} ${candidate.country ?? ""}`.toLocaleLowerCase();
}

export function geographicCandidateFeatureKind(candidate: GeographicCandidate): GeographicReferenceKind {
  const semantics = semanticText(candidate);
  if (/railway|train|station|public_transport|駅|車站|车站/.test(semantics)) return "station";
  if (/airport|aerodrome|aeroway|空港|機場|机场/.test(semantics)) return "airport";
  if (/city|district|county|municipality|administrative/.test(semantics)) return "city_area";
  return "place";
}

const sameAdministrativeValue = (a?: string, b?: string) =>
  Boolean(a && b && compact(a) === compact(b));
const distanceKm = (a: Pick<GeographicCandidate, "latitude" | "longitude">, b: Pick<GeographicCandidate, "latitude" | "longitude">) => {
  const radians = (value: number) => value * Math.PI / 180,
    dLat = radians(b.latitude - a.latitude), dLon = radians(b.longitude - a.longitude),
    lat1 = radians(a.latitude), lat2 = radians(b.latitude),
    value = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
};

export function scoreGeographicCandidates(text: string, candidates: GeographicCandidate[], scope?: "city_area" | "nearby_point" | "corridor", context: GeographicRankingContext = {}): ScoredGeographicCandidate[] {
  const wanted = compact(text), requestedWords = words(text), kind = geographicReferenceKind(text, scope);
  const ordered = [...candidates].sort(
    (a, b) => compact(a.name).length - compact(b.name).length || a.providerPlaceId.localeCompare(b.providerPlaceId),
  );
  const distinct = ordered.filter(
    (candidate, index, all) =>
      all.findIndex(
        (other) => {
          const otherStem = featureStem(other.name), candidateStem = featureStem(candidate.name);
          const sameFeature = otherStem === candidateStem || otherStem.includes(candidateStem) || candidateStem.includes(otherStem);
          return sameFeature && geographicCandidateFeatureKind(other) === geographicCandidateFeatureKind(candidate) && Math.abs(other.latitude - candidate.latitude) < 0.01 && Math.abs(other.longitude - candidate.longitude) < 0.01;
        },
      ) === index,
  );
  return distinct.map((candidate) => {
    const candidateName = compact(candidate.name), semantics = semanticText(candidate), reasons: string[] = [];
    let score = 0;
    if (candidateName === wanted) { score += 120; reasons.push("EXACT_NAME"); }
    else if (candidateName.includes(wanted) || wanted.includes(candidateName)) { score += 70; reasons.push("NAME_CONTAINS_REFERENCE"); }
    else if (featureStem(candidate.name) && featureStem(candidate.name) === featureStem(text)) { score += 95; reasons.push("EXACT_FEATURE_STEM"); }
    const overlap = requestedWords.filter((word) => compact(`${candidate.name} ${candidate.formattedAddress ?? ""}`).includes(compact(word))).length;
    score += overlap * 12;
    if (overlap) reasons.push("TOKEN_OVERLAP");
    const station = /railway|train|station|public_transport|駅|車站|车站|站/.test(semantics), airport = /airport|aerodrome|aeroway|空港|機場|机场/.test(semantics), area = /city|district|county|municipality|administrative/.test(semantics);
    const semanticMatch = kind === "station" ? station : kind === "airport" ? airport : kind === "city_area" ? area : true;
    if (semanticMatch) { score += kind === "place" ? 0 : 55; if (kind !== "place") reasons.push(`MATCHES_${kind.toUpperCase()}`); }
    else if (kind !== "place") { score -= 90; reasons.push(`MISMATCHES_${kind.toUpperCase()}`); }
    score += Math.round((candidate.confidence ?? 0) * 10);
    if (semanticMatch && candidate.providerRank != null) {
      score += Math.round(24 / (candidate.providerRank + 1));
      reasons.push("PROVIDER_RELEVANCE");
    }
    const peer = context.explicitlyGroundedPeers?.find((entry) => entry.providerPlaceId !== candidate.providerPlaceId);
    if (peer) {
      if (sameAdministrativeValue(candidate.region, peer.region)) { score += 140; reasons.push("SAME_REGION_AS_EXPLICIT_ENDPOINT"); }
      if (sameAdministrativeValue(candidate.country, peer.country)) { score += 12; reasons.push("SAME_COUNTRY_AS_EXPLICIT_ENDPOINT"); }
      const separation = distanceKm(candidate, peer);
      if (separation <= 250) { score += 18; reasons.push("GEOGRAPHICALLY_CONSISTENT_WITH_EXPLICIT_ENDPOINT"); }
      else if (separation > 1500) { score -= 12; reasons.push("DISTANT_FROM_EXPLICIT_ENDPOINT"); }
    }
    const trip = context.tripDestination;
    if (trip) {
      if (sameAdministrativeValue(candidate.region, trip.region)) { score += 6; reasons.push("SAME_REGION_AS_TRIP_CONTEXT"); }
      if (sameAdministrativeValue(candidate.country, trip.country)) { score += 2; reasons.push("SAME_COUNTRY_AS_TRIP_CONTEXT"); }
      if (distanceKm(candidate, trip) <= 250) { score += 2; reasons.push("NEAR_TRIP_CONTEXT"); }
    }
    return { candidate, score, reasons };
  }).sort((a, b) => b.score - a.score || a.candidate.providerPlaceId.localeCompare(b.candidate.providerPlaceId));
}

export function resolveGeographicCandidates(text: string, candidates: GeographicCandidate[], scope?: "city_area" | "nearby_point" | "corridor", context: GeographicRankingContext = {}): GeographicResolution {
  const scored = scoreGeographicCandidates(text, candidates, scope, context), first = scored[0], second = scored[1];
  const kind = geographicReferenceKind(text, scope), minimumScore = kind === "place" ? 10 : 20;
  if (!first || first.score < minimumScore) return { status: "not_found", candidates: scored };
  if (kind === "station" || kind === "airport") {
    const distantPlausible = scored.slice(1).find(({ candidate, score }) =>
      score >= minimumScore &&
      geographicCandidateFeatureKind(candidate) === kind &&
      Math.hypot(
        candidate.latitude - first.candidate.latitude,
        candidate.longitude - first.candidate.longitude,
      ) > 0.25,
    );
    if (distantPlausible)
      return { status: "ambiguous", candidates: scored.slice(0, 5) };
  }
  if (second && first.score - second.score < 10 && first.candidate.providerPlaceId !== second.candidate.providerPlaceId)
    return { status: "ambiguous", candidates: scored.slice(0, 5) };
  return { status: "resolved", selected: first.candidate, candidates: scored.slice(0, 5) };
}

const endpointMinimumScore = (text: string) => geographicReferenceKind(text, "corridor") === "place" ? 10 : 20;
const pairCandidateKey = (candidate: GeographicCandidate) => `${candidate.provider}:${candidate.providerPlaceId}`;

/**
 * Corridor endpoints are a relationship, not two isolated winner-takes-all
 * geocodes. This evaluates a bounded Cartesian product of provider candidates.
 * Text/type/provider evidence remains endpoint-local; administrative and
 * distance evidence can support a pair but can never manufacture an endpoint.
 */
export function resolveCorridorGeographicCandidates(
  originText: string,
  destinationText: string,
  originCandidates: GeographicCandidate[],
  destinationCandidates: GeographicCandidate[],
  context: GeographicRankingContext = {},
): CorridorGeographicResolution {
  const origins = scoreGeographicCandidates(originText, originCandidates, "corridor", context)
      .filter(({ score }) => score >= endpointMinimumScore(originText)).slice(0, 5),
    destinations = scoreGeographicCandidates(destinationText, destinationCandidates, "corridor", context)
      .filter(({ score }) => score >= endpointMinimumScore(destinationText)).slice(0, 5);
  if (!origins.length || !destinations.length)
    return { status: "not_found", pairs: [], reason: !origins.length ? "NO_PLAUSIBLE_ORIGIN" : "NO_PLAUSIBLE_DESTINATION" };

  const pairs = origins.flatMap((origin) => destinations
    .filter((destination) => pairCandidateKey(origin.candidate) !== pairCandidateKey(destination.candidate))
    .map((destination): ScoredCorridorCandidatePair => {
      const reasons: string[] = [], separation = distanceKm(origin.candidate, destination.candidate);
      let relationshipScore = 0;
      if (sameAdministrativeValue(origin.candidate.region, destination.candidate.region)) {
        relationshipScore += 170;
        reasons.push("SAME_REGION");
      }
      if (sameAdministrativeValue(origin.candidate.country, destination.candidate.country)) {
        relationshipScore += 20;
        reasons.push("SAME_COUNTRY");
      } else if (origin.candidate.country && destination.candidate.country) reasons.push("DIFFERENT_COUNTRIES");
      if (separation <= 350) {
        relationshipScore += 20;
        reasons.push("BOUNDED_REGIONAL_SEPARATION");
      } else if (separation <= 1_000) {
        relationshipScore += 6;
        reasons.push("BOUNDED_LONG_DISTANCE_SEPARATION");
      } else reasons.push("LONG_DISTANCE_PAIR");
      return {
        origin,
        destination,
        score: origin.score + destination.score + relationshipScore,
        distanceKm: Math.round(separation * 10) / 10,
        reasons,
      };
    }))
    .sort((a, b) => b.score - a.score || pairCandidateKey(a.origin.candidate).localeCompare(pairCandidateKey(b.origin.candidate)) || pairCandidateKey(a.destination.candidate).localeCompare(pairCandidateKey(b.destination.candidate)))
    .slice(0, 25);
  const first = pairs[0], second = pairs[1];
  if (!first) return { status: "not_found", pairs: [], reason: "NO_DISTINCT_ENDPOINT_PAIR" };
  if (second && first.score - second.score < 15) {
    const endpoint = pairCandidateKey(first.origin.candidate) === pairCandidateKey(second.origin.candidate) ? "destination" : "origin";
    const entries = endpoint === "origin" ? origins : destinations;
    const relevantKeys = new Set(pairs.filter((pair) => first.score - pair.score < 15).map((pair) => pairCandidateKey(pair[endpoint].candidate)));
    return {
      status: "ambiguous",
      endpoint,
      candidates: entries.filter(({ candidate }) => relevantKeys.has(pairCandidateKey(candidate))),
      pairs,
      reason: "MULTIPLE_PLAUSIBLE_CORRIDOR_PAIRS",
    };
  }
  return { status: "resolved", origin: first.origin.candidate, destination: first.destination.candidate, pairs };
}
