import { describe, expect, it } from "vitest";
import { resolvePlanningAIConfiguration } from "./planning-ai-config";

describe("planning AI environment configuration", () => {
  it.each(["ollama", "openai", "mock"])(
    "reads explicit %s selection from Astro/Vite environment",
    (provider) => {
      expect(
        resolvePlanningAIConfiguration(
          { PLANNING_AI_PROVIDER: provider },
          {},
          true,
        ).provider,
      ).toBe(provider);
    },
  );

  it("reads Ollama connection and model settings from Astro/Vite environment", () => {
    expect(
      resolvePlanningAIConfiguration(
        {
          PLANNING_AI_PROVIDER: "ollama",
          OLLAMA_BASE_URL: "http://127.0.0.1:11434",
          OLLAMA_PLANNING_MODEL: "qwen3.5:9b",
          OLLAMA_PLANNING_TIMEOUT_MS: "45000",
        },
        {},
        true,
      ),
    ).toMatchObject({
      provider: "ollama",
      ollamaBaseUrl: "http://127.0.0.1:11434",
      ollamaModel: "qwen3.5:9b",
      ollamaTimeoutMs: 45_000,
    });
  });

  it("uses process environment only as a non-Vite fallback", () => {
    expect(
      resolvePlanningAIConfiguration(
        {},
        { PLANNING_AI_PROVIDER: "ollama", OLLAMA_PLANNING_MODEL: "local" },
        true,
      ),
    ).toMatchObject({ provider: "ollama", ollamaModel: "local" });
  });

  it("defaults to mock only when development has no explicit provider", () => {
    expect(resolvePlanningAIConfiguration({}, {}, true).provider).toBe("mock");
    expect(resolvePlanningAIConfiguration({}, {}, false).provider).toBe("openai");
  });

  it("keeps travel reranking opt-in and bounds its budget", () => {
    expect(resolvePlanningAIConfiguration({}, {}, true)).toMatchObject({ rerankEnabled: false, rerankTimeoutMs: 12000, rerankMaxCandidates: 12 });
    expect(resolvePlanningAIConfiguration({ PLANNING_AI_RERANK_ENABLED: "true", PLANNING_AI_RERANK_TIMEOUT_MS: "50000", PLANNING_AI_RERANK_MAX_CANDIDATES: "99" }, {}, true)).toMatchObject({ rerankEnabled: true, rerankTimeoutMs: 30000, rerankMaxCandidates: 12 });
  });
});
