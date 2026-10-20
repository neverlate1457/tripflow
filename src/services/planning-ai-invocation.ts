export type PlanningAIInvocationRoute =
  | "deterministic_interpretation"
  | "temporal_rejection"
  | "scheduling_clarification"
  | "provider";

export type PlanningAIExecutionStage =
  | "request_validation"
  | "trip_loading"
  | "context_preparation"
  | "provider_initialization"
  | "deterministic_preprocessing"
  | "provider_invocation"
  | "normalization"
  | "semantic_runtime_validation"
  | "structured_output_repair"
  | "deterministic_capability_planning"
  | "response_serialization";

export type PlanningAIFailureSource =
  | "llm"
  | "tripflow_runtime"
  | "tripflow_deterministic";

export function selectPlanningAIInvocationRoute(input: {
  provider?: string;
  hasDeterministicInterpretation: boolean;
  hasTemporalFailure: boolean;
  scheduling: boolean;
  hasSchedulingAmbiguity: boolean;
}): PlanningAIInvocationRoute {
  if (input.provider && input.provider !== "mock") return "provider";
  if (input.hasDeterministicInterpretation)
    return "deterministic_interpretation";
  if (input.hasTemporalFailure) return "temporal_rejection";
  if (input.scheduling && input.hasSchedulingAmbiguity)
    return "scheduling_clarification";
  return "provider";
}

export interface PlanningAIInvocationDiagnostics {
  selectedProvider: string | null;
  model: string | null;
  invocationAttempted: boolean;
  invocationSucceeded: boolean;
  deterministicFallbackUsed: boolean;
  route: PlanningAIInvocationRoute | "request_rejected" | "provider_initialization_failed";
  routingReason: string | null;
  failureStage: PlanningAIExecutionStage | null;
  failureCode: string | null;
  failureReason: string | null;
  modelResponseDurationMs: number | null;
  repairAttempted: boolean;
  repairSucceeded: boolean;
}

const publicErrorCodes = new Set([
  "AI_NOT_CONFIGURED", "OLLAMA_UNAVAILABLE", "OLLAMA_MODEL_NOT_FOUND",
  "OLLAMA_TIMEOUT", "INVALID_AI_OUTPUT", "INVALID_INTENT",
  "MALFORMED_AI_OUTPUT", "TRUNCATED_AI_OUTPUT", "AI_SEMANTIC_CONTRACT",
  "REPAIR_FAILED", "REQUEST_CANCELLED",
]);

export function classifyPlanningAIExecutionFailure(input: {
  error: unknown;
  stage: PlanningAIExecutionStage;
  selectedProvider: string | null;
  model: string | null;
}) {
  const rawCode = input.error instanceof DOMException && input.error.name === "AbortError"
    ? "REQUEST_CANCELLED"
    : input.error instanceof Error ? input.error.message : "UNKNOWN_ERROR";
  const errorCode = publicErrorCodes.has(rawCode) ? rawCode : "PLANNING_EXECUTION_FAILED";
  const isModelStage = input.stage === "provider_invocation" || input.stage === "structured_output_repair";
  const sourceType: PlanningAIFailureSource = isModelStage
    ? "llm"
    : input.stage === "deterministic_capability_planning" || input.stage === "deterministic_preprocessing"
      ? "tripflow_deterministic"
      : "tripflow_runtime";
  const safeReason: Record<PlanningAIExecutionStage, string> = {
    request_validation: "TripFlow rejected the planning request before execution.",
    trip_loading: "TripFlow could not load the requested trip context.",
    context_preparation: "TripFlow could not prepare the planning context.",
    provider_initialization: "TripFlow could not initialize the configured planning provider.",
    deterministic_preprocessing: "TripFlow could not preprocess the planning request.",
    provider_invocation: "The configured planning provider could not return an interpretation.",
    normalization: "TripFlow could not normalize the provider interpretation.",
    semantic_runtime_validation: "TripFlow rejected the interpretation during runtime validation.",
    structured_output_repair: "The configured planning provider could not repair the structured interpretation.",
    deterministic_capability_planning: "TripFlow could not derive a bounded capability plan.",
    response_serialization: "TripFlow could not prepare the planning response.",
  };
  return {
    stage: input.stage,
    errorCode,
    reason: safeReason[input.stage],
    sourceType,
    provider: isModelStage ? input.selectedProvider : "tripflow",
    model: isModelStage ? input.model : null,
  } as const;
}

export function logPlanningAIInvocationDiagnostics(
  diagnostics: PlanningAIInvocationDiagnostics,
) {
  if (import.meta.env.DEV)
    console.debug("Planning AI invocation", diagnostics);
}
