export type AssistantProducerType = "llm" | "tripflow_runtime" | "tripflow_deterministic" | "place_provider" | "frontend" | "unknown";

export interface AssistantMessageProvenance {
  producerType: AssistantProducerType;
  producerStage: string;
  provider: string | null;
  model: string | null;
  requestId: string | null;
  traceEventId: string | null;
  transformedBy: string[];
  reason?: string | null;
}

export const unknownAssistantProvenance = (requestId: string | null = null): AssistantMessageProvenance => ({
  producerType: "unknown",
  producerStage: "unknown",
  provider: null,
  model: null,
  requestId,
  traceEventId: null,
  transformedBy: [],
  reason: "The producing layer could not be verified.",
});

export function formatAssistantProvenance(provenance: AssistantMessageProvenance) {
  if (provenance.producerType === "unknown") return "Source unknown";
  const producer = provenance.producerType === "llm"
    ? provenance.provider === "ollama" ? "Ollama" : provenance.provider === "openai" ? "OpenAI" : provenance.provider ?? "LLM"
    : provenance.producerType === "place_provider" ? provenance.provider === "geoapify" ? "Geoapify" : provenance.provider ?? "Place provider"
    : provenance.producerType === "frontend" ? "TripFlow UI" : "TripFlow";
  const stage = provenance.producerStage.split("_").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
  return [producer, provenance.model, stage].filter(Boolean).join(" · ");
}
