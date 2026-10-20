import type { PlanningAIProvider } from "@/domain/ai-planning";
import type { DiscoverPlacesIntent, PlaceSuggestion } from "@/domain/discovery";
import { applyTravelRerank, validateTravelRerankOutput, type TravelRerankInput, type TravelRerankMetadata } from "@/domain/travel-relevance";

export async function rerankTravelSuggestions(options: {
  suggestions: PlaceSuggestion[];
  originalRequest: string;
  intent: DiscoverPlacesIntent;
  provider?: PlanningAIProvider;
  enabled: boolean;
  timeoutMs?: number;
  maxCandidates?: number;
  signal?: AbortSignal;
}): Promise<{ suggestions: PlaceSuggestion[]; metadata: TravelRerankMetadata }> {
  const { suggestions, provider } = options;
  if (!options.enabled) return { suggestions, metadata: { used: false, status: "disabled" } };
  if (!provider?.rerankPlaces) return { suggestions, metadata: { used: false, status: "unsupported", provider: provider?.metadata.provider, model: provider?.metadata.model } };
  const shortlist = suggestions.slice(0, Math.min(options.maxCandidates ?? 12, 12));
  if (shortlist.length < 2) return { suggestions, metadata: { used: false, status: "unsupported", provider: provider.metadata.provider, model: provider.metadata.model } };
  const input: TravelRerankInput = {
    originalRequest: options.originalRequest,
    geographicScope: options.intent.geographicScope ?? "trip_context",
    requestedCategories: options.intent.categories ?? [],
    requestedThemes: options.intent.preferences?.themes ?? [],
    candidates: shortlist.map(({ id, place }) => ({ id, name: place.name, categories: place.categories ?? (place.category ? [place.category] : []), ...(place.address ? { formattedAddress: place.address } : {}) })),
  };
  const controller = new AbortController(), started = Date.now();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, options.timeoutMs ?? 12_000);
  const abort = () => controller.abort();
  options.signal?.addEventListener("abort", abort, { once: true });
  try {
    const raw = await provider.rerankPlaces(input, controller.signal);
    const validated = validateTravelRerankOutput(raw, shortlist.map(({ id }) => id));
    return { suggestions: applyTravelRerank(suggestions, validated), metadata: { used: true, status: "used", provider: provider.metadata.provider, model: provider.metadata.model, latencyMs: Date.now() - started, assessments: validated.assessments } };
  } catch (error) {
    const cancelled = options.signal?.aborted === true;
    const reason = cancelled ? "cancelled" : timedOut ? "timeout" : error instanceof Error && error.message === "INVALID_RERANK_OUTPUT" ? "invalid_output" : "provider_error";
    return { suggestions, metadata: { used: false, status: "failed", provider: provider.metadata.provider, model: provider.metadata.model, latencyMs: Date.now() - started, reason } };
  } finally { clearTimeout(timer); options.signal?.removeEventListener("abort", abort); }
}
