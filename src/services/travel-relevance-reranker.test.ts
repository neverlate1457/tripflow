import { describe, expect, it, vi } from "vitest";
import type { PlanningAIProvider } from "@/domain/ai-planning";
import type { PlaceSuggestion } from "@/domain/discovery";
import { rerankTravelSuggestions } from "./travel-relevance-reranker";

const suggestion = (id: string, name: string, categories = ["tourism.attraction"]): PlaceSuggestion => ({
  id, place: { provider: "geoapify", providerPlaceId: id, name, categories, location: { latitude: 31.9, longitude: 131.4 }, address: "Miyazaki, Japan" }, score: 50, reasons: [],
  context: { detourStatus: "not_applicable", distanceMeaning: "area_relevance", schedulingConfidence: "limited", semanticEvidence: ["attraction"], semanticEligibility: "eligible", scoreComponents: { providerOrder: 0, semantic: 0, distance: 0, detour: 0, routing: 0, duplicate: 0, fixedWindow: 0, quality: 0 } },
});
const intent = { type: "discover_places" as const, date: "2026-10-30", geographicScope: "city_area" as const, categories: ["attraction" as const], geographicReference: { text: "宮崎" } };
const places = [suggestion("tomb", "170号墳"), suggestion("science", "宮崎科学技術館", ["entertainment.museum", "tourism.attraction"]), suggestion("castle", "綾城")];

function provider(output: unknown): PlanningAIProvider {
  return { metadata: { provider: "ollama", model: "qwen3.5:9b" }, interpretIntent: vi.fn(), rerankPlaces: vi.fn(async () => output) };
}

describe("provider-grounded travel relevance reranking", () => {
  it("reorders only supplied IDs and retains omitted deterministic results", async () => {
    const result = await rerankTravelSuggestions({ suggestions: places, originalRequest: "推薦宮崎景點", intent, provider: provider({ orderedCandidateIds: ["science", "castle"], assessments: [{ candidateId: "science", relevanceScore: 90, explanation: "Clearly presented as a museum attraction." }] }), enabled: true });
    expect(result.suggestions.map(({ id }) => id)).toEqual(["science", "castle", "tomb"]);
    expect(result.metadata).toMatchObject({ used: true, provider: "ollama", model: "qwen3.5:9b" });
  });

  it.each([
    { orderedCandidateIds: ["invented"], assessments: [] },
    { orderedCandidateIds: ["science", "science"], assessments: [] },
    { orderedCandidateIds: ["science"], assessments: [{ candidateId: "science", relevanceScore: 101, explanation: "invalid" }] },
  ])("rejects malformed or ungrounded model selections and preserves deterministic order", async (output) => {
    const result = await rerankTravelSuggestions({ suggestions: places, originalRequest: "推薦宮崎景點", intent, provider: provider(output), enabled: true });
    expect(result.suggestions).toEqual(places);
    expect(result.metadata).toMatchObject({ used: false, status: "failed", reason: "invalid_output" });
  });

  it("does not invoke the provider when disabled", async () => {
    const ai = provider({});
    const result = await rerankTravelSuggestions({ suggestions: places, originalRequest: "推薦宮崎景點", intent, provider: ai, enabled: false });
    expect(ai.rerankPlaces).not.toHaveBeenCalled();
    expect(result.metadata.status).toBe("disabled");
  });

  it("falls back after provider failure without changing grounded results", async () => {
    const ai = provider({});
    ai.rerankPlaces = vi.fn(async () => { throw new Error("OLLAMA_UNAVAILABLE"); });
    const result = await rerankTravelSuggestions({ suggestions: places, originalRequest: "宮崎古墳", intent: { ...intent, preferences: { themes: ["history"] } }, provider: ai, enabled: true });
    expect(result.suggestions).toEqual(places);
    expect(result.metadata).toMatchObject({ used: false, reason: "provider_error" });
    expect(ai.rerankPlaces).toHaveBeenCalledWith(expect.objectContaining({ originalRequest: "宮崎古墳", requestedThemes: ["history"] }), expect.any(AbortSignal));
  });
});
