import { describe, expect, it } from "vitest";
import { classifyPlanningAIExecutionFailure, selectPlanningAIInvocationRoute } from "./planning-ai-invocation";

describe("planning AI invocation routing", () => {
  it("uses configured LLM providers as the primary semantic interpreter", () => {
    expect(selectPlanningAIInvocationRoute({ provider: "ollama", hasDeterministicInterpretation: true, hasTemporalFailure: true, scheduling: true, hasSchedulingAmbiguity: true })).toBe("provider");
    expect(selectPlanningAIInvocationRoute({ provider: "openai", hasDeterministicInterpretation: true, hasTemporalFailure: false, scheduling: false, hasSchedulingAmbiguity: false })).toBe("provider");
  });
  it("gives deterministic interpretations precedence over every later route", () => {
    expect(
      selectPlanningAIInvocationRoute({
        hasDeterministicInterpretation: true,
        hasTemporalFailure: true,
        scheduling: true,
        hasSchedulingAmbiguity: true,
      }),
    ).toBe("deterministic_interpretation");
  });

  it("rejects temporal failures before invoking a provider", () => {
    expect(
      selectPlanningAIInvocationRoute({
        hasDeterministicInterpretation: false,
        hasTemporalFailure: true,
        scheduling: false,
        hasSchedulingAmbiguity: false,
      }),
    ).toBe("temporal_rejection");
  });

  it("clarifies unresolved scheduling references before invoking a provider", () => {
    expect(
      selectPlanningAIInvocationRoute({
        hasDeterministicInterpretation: false,
        hasTemporalFailure: false,
        scheduling: true,
        hasSchedulingAmbiguity: true,
      }),
    ).toBe("scheduling_clarification");
  });

  it("invokes the configured provider only when no deterministic route applies", () => {
    expect(
      selectPlanningAIInvocationRoute({
        hasDeterministicInterpretation: false,
        hasTemporalFailure: false,
        scheduling: false,
        hasSchedulingAmbiguity: false,
      }),
    ).toBe("provider");
  });

  it("attributes provider invocation failures to the configured model", () => {
    expect(classifyPlanningAIExecutionFailure({ error: new Error("OLLAMA_UNAVAILABLE"), stage: "provider_invocation", selectedProvider: "ollama", model: "qwen3.5:9b" })).toMatchObject({
      sourceType: "llm", provider: "ollama", model: "qwen3.5:9b",
      errorCode: "OLLAMA_UNAVAILABLE", stage: "provider_invocation",
    });
  });

  it("attributes runtime validation after a successful model response to TripFlow", () => {
    const failure = classifyPlanningAIExecutionFailure({ error: new Error("INVALID_INTENT"), stage: "semantic_runtime_validation", selectedProvider: "ollama", model: "qwen3.5:9b" });
    expect(failure).toMatchObject({ sourceType: "tripflow_runtime", provider: "tripflow", model: null, errorCode: "INVALID_INTENT" });
    expect(failure.reason).not.toContain("no_deterministic_short_circuit");
  });

  it("attributes post-repair validation failure to validation, not structured repair", () => {
    expect(classifyPlanningAIExecutionFailure({ error: new Error("AI_SEMANTIC_CONTRACT"), stage: "semantic_runtime_validation", selectedProvider: "ollama", model: "qwen3.5:9b" })).toMatchObject({
      sourceType: "tripflow_runtime", stage: "semantic_runtime_validation", errorCode: "AI_SEMANTIC_CONTRACT",
    });
  });

  it("sanitizes unknown exception messages in production-safe provenance", () => {
    const failure = classifyPlanningAIExecutionFailure({ error: new Error("secret internal stack detail"), stage: "normalization", selectedProvider: "ollama", model: "qwen3.5:9b" });
    expect(failure.errorCode).toBe("PLANNING_EXECUTION_FAILED");
    expect(failure.reason).toBe("TripFlow could not normalize the provider interpretation.");
  });
});
