import type { DiscoverPlacesIntent, PlaceSuggestion } from "./discovery";

export const TRAVEL_RERANK_LIMITS = { candidates: 12, explanationLength: 180 } as const;

export interface TravelRerankCandidate {
  id: string;
  name: string;
  categories: string[];
  formattedAddress?: string;
}

export interface TravelRerankInput {
  originalRequest: string;
  geographicScope: NonNullable<DiscoverPlacesIntent["geographicScope"]>;
  requestedCategories: NonNullable<DiscoverPlacesIntent["categories"]>;
  requestedThemes: NonNullable<NonNullable<DiscoverPlacesIntent["preferences"]>["themes"]>;
  candidates: TravelRerankCandidate[];
}

export interface TravelRerankAssessment {
  candidateId: string;
  relevanceScore: number;
  explanation: string;
}

export interface TravelRerankOutput {
  orderedCandidateIds: string[];
  assessments: TravelRerankAssessment[];
}
export type TravelRerankStatus = "used" | "disabled" | "unsupported" | "failed";
export interface TravelRerankMetadata { used: boolean; status: TravelRerankStatus; provider?: string; model?: string; latencyMs?: number; reason?: "timeout" | "cancelled" | "invalid_output" | "provider_error"; assessments?: TravelRerankAssessment[]; }

export function validateTravelRerankOutput(raw: unknown, candidateIds: string[]): TravelRerankOutput {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("INVALID_RERANK_OUTPUT");
  const value = raw as Record<string, unknown>;
  if (!Object.keys(value).every((key) => ["orderedCandidateIds", "assessments"].includes(key)) || !Array.isArray(value.orderedCandidateIds) || !Array.isArray(value.assessments)) throw new Error("INVALID_RERANK_OUTPUT");
  const allowed = new Set(candidateIds), ordered = value.orderedCandidateIds;
  if (ordered.length > candidateIds.length || new Set(ordered).size !== ordered.length || ordered.some((id) => typeof id !== "string" || !allowed.has(id))) throw new Error("INVALID_RERANK_OUTPUT");
  const assessments = value.assessments.map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw new Error("INVALID_RERANK_OUTPUT");
    const item = entry as Record<string, unknown>;
    if (!Object.keys(item).every((key) => ["candidateId", "relevanceScore", "explanation"].includes(key)) || typeof item.candidateId !== "string" || !allowed.has(item.candidateId) || !Number.isInteger(item.relevanceScore) || Number(item.relevanceScore) < 0 || Number(item.relevanceScore) > 100 || typeof item.explanation !== "string" || !item.explanation.trim() || item.explanation.length > TRAVEL_RERANK_LIMITS.explanationLength) throw new Error("INVALID_RERANK_OUTPUT");
    return { candidateId: item.candidateId, relevanceScore: Number(item.relevanceScore), explanation: item.explanation.trim() };
  });
  if (new Set(assessments.map((entry) => entry.candidateId)).size !== assessments.length) throw new Error("INVALID_RERANK_OUTPUT");
  return { orderedCandidateIds: ordered as string[], assessments };
}

export function applyTravelRerank(suggestions: PlaceSuggestion[], output: TravelRerankOutput) {
  const byId = new Map(suggestions.map((suggestion) => [suggestion.id, suggestion]));
  const ordered = output.orderedCandidateIds.flatMap((id) => byId.get(id) ? [byId.get(id)!] : []);
  const used = new Set(ordered.map((suggestion) => suggestion.id));
  return [...ordered, ...suggestions.filter((suggestion) => !used.has(suggestion.id))];
}
