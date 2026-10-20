import type { APIRoute } from "astro";
import {
  AI_LIMITS,
  buildAIContext,
  describeInterpretationValidationIssue,
  normalizeProviderOutputStructure,
  validateInterpretation,
  validateProviderInterpretationContract,
  type PlanningAIProvider,
} from "@/domain/ai-planning";
import { SqliteTripRepository } from "@/services/sqlite-trip-repository";
import {
  createPlanningAIProvider,
  cleanDiscoveryTemporalPrefix,
  describeDiscoverySemanticContradiction,
  describeScheduleSemanticContradiction,
  extractGeographicReferenceEvidence,
  implicitDiscoveryIntent,
  extractDiscoveryQuantity,
  normalizePlanningProviderInterpretation,
  removeInventedDiscoveryConstraints,
  validateStructuredRepairContract,
} from "@/services/planning-ai-provider";
import { createPlanningAIRequestId, createPlanningAITrace, recordPlanningAITraceEvent, traceCurrent, updatePlanningAITrace, withPlanningAITrace } from "@/services/planning-ai-debug";
import { resolvePlanningEntities } from "@/services/planning-entity-resolution";
import { temporalInterpretationFailure } from "@/domain/temporal-grounding";
import {
  classifyPlanningAIExecutionFailure,
  logPlanningAIInvocationDiagnostics,
  selectPlanningAIInvocationRoute,
  type PlanningAIExecutionStage,
  type PlanningAIInvocationDiagnostics,
} from "@/services/planning-ai-invocation";
import { derivePlanningToolPlan } from "@/domain/planning-tool-plan";
import type { AssistantMessageProvenance } from "@/domain/assistant-provenance";

const repository = new SqliteTripRepository();
export const POST: APIRoute = async ({ request }) => {
  const started = Date.now();
  let traceId: string | null = null;
  let interpretationEventId: string | null = null;
  let repairEventId: string | null = null;
  let failureEventId: string | null = null;
  const invocation: PlanningAIInvocationDiagnostics = {
    selectedProvider: null,
    model: null,
    invocationAttempted: false,
    invocationSucceeded: false,
    deterministicFallbackUsed: false,
    route: "request_rejected",
    routingReason: null,
    failureStage: null,
    failureCode: null,
    failureReason: null,
    modelResponseDurationMs: null,
    repairAttempted: false,
    repairSucceeded: false,
  };
  let executionStage: PlanningAIExecutionStage = "request_validation";
  try {
    const body = (await request.json()) as Record<string, unknown>;
    if (
      typeof body.tripId !== "string" ||
      typeof body.message !== "string" ||
      !body.message.trim() ||
      body.message.length > AI_LIMITS.maxMessageLength ||
      typeof body.selectedDate !== "string"
    ) {
      invocation.routingReason = "invalid_request";
      logPlanningAIInvocationDiagnostics(invocation);
      return Response.json(
        { error: "Invalid AI planning request" },
        { status: 400 },
      );
    }
    const message = body.message;
    executionStage = "trip_loading";
    const snapshot = await repository.getTrip(body.tripId);
    if (!snapshot) {
      invocation.routingReason = "trip_not_found";
      logPlanningAIInvocationDiagnostics(invocation);
      return Response.json({ error: "Trip not found" }, { status: 404 });
    }
    traceId = createPlanningAIRequestId();
    createPlanningAITrace({ userMessage: message, tripId: body.tripId, selectedDate: body.selectedDate, timezone: snapshot.trip.timezone, destination: snapshot.trip.destination ?? null }, traceId);
    executionStage = "context_preparation";
    const context = buildAIContext(
        snapshot.trip,
        snapshot.items,
        snapshot.candidates,
        body.selectedDate,
      );
    executionStage = "provider_initialization";
    const provider: PlanningAIProvider = createPlanningAIProvider();
    executionStage = "deterministic_preprocessing";
    const entityResolution = resolvePlanningEntities({ message, context });
    invocation.selectedProvider = provider.metadata.provider;
    invocation.model = provider.metadata.model;
    if (traceId) {
      const implicit = entityResolution.scheduling ? null : implicitDiscoveryIntent(message, context);
      const resolvedIntent = entityResolution.deterministicInterpretation?.status === "resolved" ? entityResolution.deterministicInterpretation.intent : null;
      const quantityEvidence = extractDiscoveryQuantity(message);
      const messageAfterQuantityExtraction = quantityEvidence?.messageWithoutQuantity ?? message;
      const geographicEvidence = extractGeographicReferenceEvidence(message);
      updatePlanningAITrace(traceId, "preprocessing", { rawRequest: message, preprocessedRequest: message.normalize("NFKC").trim(), quantityEvidence: quantityEvidence ? { raw: quantityEvidence.raw, normalizedCount: quantityEvidence.normalizedCount ?? null } : null, messageAfterQuantityExtraction, temporalCleanedRequest: cleanDiscoveryTemporalPrefix(messageAfterQuantityExtraction), rawGeographicPhrase: geographicEvidence?.rawPhrase ?? null, detectedScopeDescriptor: geographicEvidence?.scopeDescriptor ?? null, cleanedGeographicReference: geographicEvidence?.reference ?? null, implicitClassifierResult: implicit?.type ?? "none", governingAction: entityResolution.scheduling ? "scheduling" : implicit ? "discovery" : "provider_interpretation", extractedDate: resolvedIntent && "date" in resolvedIntent ? resolvedIntent.date : implicit?.date ?? null, extractedTimeWindow: entityResolution.timeWindow ?? implicit?.timeWindow ?? null, temporalExtraction: entityResolution.temporal.extraction, schedulingSignals: entityResolution.scheduling, discoverySignals: Boolean(implicit), requestedCategory: implicit?.categories ?? [], geographicReference: implicit?.geographicReference ?? null, normalizedGeographicReference: implicit?.geographicReference?.text ?? null, corridorReference: implicit?.corridorReference ?? null, geographicScope: implicit?.geographicScope ?? null, canonicalEntityResolution: entityResolution.resolvedCandidateIds.length ? "resolved_before_semantic_classification" : entityResolution.ambiguityReason ? "unresolved" : "none", deterministicDecision: entityResolution.deterministicInterpretation ? "canonical_candidate_scheduling" : implicit ? "implicit_discovery_available" : entityResolution.scheduling ? "scheduling_requires_clarification" : "none" });
      updatePlanningAITrace(traceId, "temporalExtraction", entityResolution.temporal.extraction);
      updatePlanningAITrace(traceId, "context", { selectedDate: context.selectedDate, tripDateRange: { start: context.trip.startDate, end: context.trip.endDate }, destination: snapshot.trip.destination ?? null, candidates: snapshot.candidates.map((x) => ({ id: x.id, title: x.title, provider: x.provider, providerPlaceId: x.placeId, estimatedDuration: x.estimatedDuration })), scheduledTripItems: context.items, relevantConstraints: snapshot.items.filter((x) => x.schedulingConstraint || x.reservation).map((x) => ({ id: x.id, flexibility: x.flexibility, schedulingConstraint: x.schedulingConstraint, reservation: x.reservation ? { status: x.reservation.status } : null })) });
    }
    const temporalFailure = temporalInterpretationFailure(entityResolution.temporal);
    const route = selectPlanningAIInvocationRoute({
      provider: provider.metadata.provider,
      hasDeterministicInterpretation: Boolean(entityResolution.deterministicInterpretation),
      hasTemporalFailure: Boolean(temporalFailure),
      scheduling: entityResolution.scheduling,
      hasSchedulingAmbiguity: Boolean(entityResolution.ambiguityReason),
    });
    invocation.route = route;
    let raw: unknown;
    if (route === "deterministic_interpretation") {
      invocation.routingReason = "canonical_candidate_or_temporal_rule";
      raw = entityResolution.deterministicInterpretation;
      if (traceId) interpretationEventId = recordPlanningAITraceEvent(traceId, { stage: "intent_interpretation", sourceType: "tripflow_deterministic", provider: "tripflow", model: null, status: "success", durationMs: 0, inputSummary: { route }, outputSummary: { status: (raw as { status?: unknown }).status, intentType: (raw as { intent?: { type?: unknown } }).intent?.type }, errorCode: null, reason: invocation.routingReason, routingReason: invocation.routingReason });
    } else if (route === "temporal_rejection") {
      invocation.routingReason = "temporal_grounding_failed";
      raw = temporalFailure;
      if (traceId) interpretationEventId = recordPlanningAITraceEvent(traceId, { stage: "intent_interpretation", sourceType: "tripflow_deterministic", provider: "tripflow", model: null, status: "failed", durationMs: 0, inputSummary: { route }, outputSummary: { status: (raw as { status?: unknown }).status }, errorCode: "TEMPORAL_GROUNDING_FAILED", reason: "TripFlow rejected invalid temporal evidence before model invocation" });
    } else if (route === "scheduling_clarification") {
      invocation.routingReason = "canonical_candidate_reference_unresolved";
      raw = { status: "clarification_required", question: "Which saved Candidate should TripFlow schedule?", selectionMode:"single", options: context.candidates.slice(0, 8).map((x) => ({ id: x.id, label: x.title, candidateId: x.id })) };
      if (traceId) interpretationEventId = recordPlanningAITraceEvent(traceId, { stage: "intent_interpretation", sourceType: "tripflow_deterministic", provider: "tripflow", model: null, status: "success", durationMs: 0, inputSummary: { route }, outputSummary: { status: "clarification_required", optionCount: context.candidates.slice(0, 8).length }, errorCode: null, reason: "TripFlow requested canonical Candidate clarification before model invocation" });
    } else {
      invocation.invocationAttempted = true;
      invocation.routingReason = "no_deterministic_short_circuit";
      executionStage = "provider_invocation";
      const modelStarted = Date.now();
      try {
        raw = await withPlanningAITrace(traceId, () =>
          provider.interpretIntent({ message, context }, request.signal),
        );
        invocation.invocationSucceeded = true;
      } finally {
        invocation.modelResponseDurationMs = Date.now() - modelStarted;
      }
      if (traceId) recordPlanningAITraceEvent(traceId, { stage: "provider_invocation", sourceType: "llm", provider: provider.metadata.provider, model: provider.metadata.model, status: "success", durationMs: invocation.modelResponseDurationMs ?? 0, inputSummary: { messageLength: message.length }, outputSummary: { responseReceived: true }, errorCode: null, reason: "Configured provider returned a structured interpretation" });
      if (traceId) interpretationEventId = recordPlanningAITraceEvent(traceId, { stage: "intent_interpretation", sourceType: "llm", provider: provider.metadata.provider, model: provider.metadata.model, status: "success", durationMs: invocation.modelResponseDurationMs ?? 0, inputSummary: { messageLength: message.length, selectedDate: context.selectedDate }, outputSummary: { status: (raw as { status?: unknown })?.status, intentType: (raw as { intent?: { type?: unknown } })?.intent?.type }, errorCode: null, reason: "Primary semantic interpretation" });
    }
    executionStage = "normalization";
    if (traceId) updatePlanningAITrace(traceId, "parsingValidation", { parsedJson: raw, parseStatus: "passed", runtimeSchemaValidation: "pending" });
    const
      providerNormalized = provider.metadata.provider === "mock"
        ? raw
        : normalizeProviderOutputStructure(raw, context.selectedDate),
      normalized = removeInventedDiscoveryConstraints(normalizePlanningProviderInterpretation(providerNormalized, {
        message,
        context,
      }, provider.metadata.provider, Boolean(entityResolution.scheduling || temporalFailure)), { message, context }, entityResolution.scheduling),
      interpretation = await (async () => {
        executionStage = "semantic_runtime_validation";
        const semanticContradiction = provider.metadata.provider === "mock" ? null : describeDiscoverySemanticContradiction(normalized, { message, context }, entityResolution.scheduling) ?? describeScheduleSemanticContradiction(normalized, { message, context }, entityResolution.scheduling, Boolean(entityResolution.deterministicInterpretation && entityResolution.resolvedCandidateIds.length));
        try {
          if (semanticContradiction) throw new Error("AI_SEMANTIC_CONTRACT");
          const validatedResult = validateInterpretation(normalized, context);
          if (provider.metadata.provider !== "mock") validateProviderInterpretationContract(normalized);
          return validatedResult;
        } catch (error) {
          const validationIssue = semanticContradiction ?? describeInterpretationValidationIssue(normalized);
          if (traceId) recordPlanningAITraceEvent(traceId, { stage: "runtime_validation", sourceType: "tripflow_runtime", provider: "tripflow", model: null, status: provider.repairIntent && provider.metadata.provider !== "mock" ? "fallback" : "failed", durationMs: 0, inputSummary: { normalizedIntent: normalized }, outputSummary: { validationErrors: [{ path: "$", code: error instanceof Error ? error.message : "INVALID_AI_OUTPUT", detail: validationIssue }] }, errorCode: error instanceof Error ? error.message : "INVALID_AI_OUTPUT", reason: validationIssue, failureStage: "semantic_runtime_validation" });
          if (!provider.repairIntent || provider.metadata.provider === "mock") throw error;
          invocation.repairAttempted = true;
          executionStage = "structured_output_repair";
          const repairStarted = Date.now();
          let repairedRaw: unknown;
          try { repairedRaw = await withPlanningAITrace(traceId, () => provider.repairIntent!({ message, context }, normalized, validationIssue, request.signal)); }
          catch (repairError) { const repairFailure = classifyPlanningAIExecutionFailure({ error: repairError, stage: "structured_output_repair", selectedProvider: provider.metadata.provider, model: provider.metadata.model }); if (traceId) recordPlanningAITraceEvent(traceId, { stage: "structured_output_repair", sourceType: repairFailure.sourceType, provider: repairFailure.provider, model: repairFailure.model, status: "failed", durationMs: Date.now() - repairStarted, inputSummary: { validationIssue }, outputSummary: null, errorCode: repairFailure.errorCode, reason: repairFailure.reason, failureStage: repairFailure.stage }); throw repairError; }
          executionStage = "normalization";
          const repaired = removeInventedDiscoveryConstraints(normalizeProviderOutputStructure(repairedRaw, context.selectedDate), { message, context }, entityResolution.scheduling);
          invocation.modelResponseDurationMs = (invocation.modelResponseDurationMs ?? 0) + (Date.now() - repairStarted);
          if (traceId) repairEventId = recordPlanningAITraceEvent(traceId, { stage: "structured_output_repair", sourceType: "llm", provider: provider.metadata.provider, model: provider.metadata.model, status: "success", durationMs: Date.now() - repairStarted, inputSummary: { validationIssue }, outputSummary: { status: (repaired as { status?: unknown }).status, intentType: (repaired as { intent?: { type?: unknown } }).intent?.type }, errorCode: null, reason: "Initial output violated runtime or semantic contract" });
          if (traceId) updatePlanningAITrace(traceId, "parsingValidation", { parsedJson: repaired, parseStatus: "passed_after_repair", runtimeSchemaValidation: "pending", validationIssues: [{ path: [], code: error instanceof Error ? error.message : "INVALID_AI_OUTPUT", detail: validationIssue }] });
          executionStage = "semantic_runtime_validation";
          validateStructuredRepairContract(repaired, normalized, validationIssue);
          const repairedContradiction = describeDiscoverySemanticContradiction(repaired, { message, context }, entityResolution.scheduling) ?? describeScheduleSemanticContradiction(repaired, { message, context }, entityResolution.scheduling, Boolean(entityResolution.deterministicInterpretation && entityResolution.resolvedCandidateIds.length));
          if (repairedContradiction) throw new Error("AI_SEMANTIC_CONTRACT");
          const validatedResult = validateInterpretation(repaired, context);
          validateProviderInterpretationContract(repaired);
          invocation.repairSucceeded = true;
          return validatedResult;
        }
      })();
    const outputNormalized = JSON.stringify(raw) !== JSON.stringify(normalized);
    if (traceId) recordPlanningAITraceEvent(traceId, { stage: "normalization", sourceType: "tripflow_runtime", provider: "tripflow", model: null, status: "success", durationMs: 0, inputSummary: { provider: provider.metadata.provider }, outputSummary: { changed: outputNormalized }, errorCode: null, reason: outputNormalized ? "Provider output normalized before validation" : "Provider output already matched the normalized shape" });
    invocation.deterministicFallbackUsed =
      provider.metadata.provider === "mock" && outputNormalized;
    if (invocation.deterministicFallbackUsed)
      invocation.routingReason = "implicit_discovery_normalization";
    executionStage = "deterministic_capability_planning";
    const toolPlan = interpretation.status === "resolved" ? derivePlanningToolPlan(interpretation.intent) : [];
    if (traceId) {
      updatePlanningAITrace(traceId, "parsingValidation", { parsedJson: raw, parseStatus: "passed", runtimeSchemaValidation: "passed", validationIssues: [] });
      updatePlanningAITrace(traceId, "normalization", { before: raw, after: normalized, reason: !outputNormalized ? "none" : provider.metadata.provider === "mock" ? "implicit_discovery_normalization" : "provider_output_structural_normalization", temporalNormalization: { resolvedDate: entityResolution.temporal.resolvedDate, normalizedStart: entityResolution.temporal.timeWindow?.start ?? null, normalizedEnd: entityResolution.temporal.timeWindow?.end ?? null, timezone: entityResolution.temporal.timezone, ambiguityStatus: entityResolution.temporal.status, normalizationReason: entityResolution.temporal.reason } });
      updatePlanningAITrace(traceId, "temporalNormalization", { resolvedDate: entityResolution.temporal.resolvedDate, normalizedStart: entityResolution.temporal.timeWindow?.start ?? null, normalizedEnd: entityResolution.temporal.timeWindow?.end ?? null, timezone: entityResolution.temporal.timezone, ambiguityStatus: entityResolution.temporal.status, normalizationReason: entityResolution.temporal.reason });
      const intent = interpretation.status === "resolved" ? interpretation.intent : null;
      updatePlanningAITrace(traceId, "entityResolution", { referencesExtracted: entityResolution.matchedTitles.map((x) => x.title), candidateIdsConsidered: context.candidates.map((x) => x.id), titleMatchingResults: entityResolution.matchedTitles, pluralOrPronounResolution: entityResolution.pluralResolution, resolvedCandidateIds: entityResolution.resolvedCandidateIds, unresolvedReferences: entityResolution.scheduling && !entityResolution.resolvedCandidateIds.length ? [message] : [], ambiguityReason: entityResolution.ambiguityReason });
      updatePlanningAITrace(traceId, "routing", { finalPlanningIntent: intent, routeSelected: intent?.type ?? interpretation.status, routingReason: entityResolution.deterministicInterpretation ? "canonical_candidate_precedence" : interpretation.status === "resolved" ? "validated_intent_type" : interpretation.status, fallbackUsed: invocation.deterministicFallbackUsed ? "implicit_discovery" : null });
      if (intent) updatePlanningAITrace(traceId, "toolPlan", toolPlan);
      updatePlanningAITrace(traceId, "modelInvocation", invocation);
      recordPlanningAITraceEvent(traceId, { stage: "runtime_validation", sourceType: "tripflow_runtime", provider: "tripflow", model: null, status: "success", durationMs: 0, inputSummary: { provider: provider.metadata.provider }, outputSummary: { interpretationStatus: interpretation.status, intentType: interpretation.status === "resolved" ? interpretation.intent.type : null }, errorCode: null, reason: "Strict TripFlow runtime schema and semantic contract accepted" });
      recordPlanningAITraceEvent(traceId, { stage: "capability_planning", sourceType: "tripflow_deterministic", provider: "tripflow", model: null, status: interpretation.status === "resolved" ? "success" : "skipped", durationMs: 0, inputSummary: { intentType: intent?.type ?? null }, outputSummary: { capabilities: toolPlan.map((entry) => entry.capability) }, errorCode: null, reason: intent ? "Bounded deterministic tool plan" : "No resolved intent" });
      recordPlanningAITraceEvent(traceId, { stage: "response_provenance", sourceType: invocation.invocationAttempted ? "llm" : "tripflow_deterministic", provider: invocation.invocationAttempted ? provider.metadata.provider : "tripflow", model: invocation.invocationAttempted ? provider.metadata.model : null, status: "success", durationMs: Date.now() - started, inputSummary: { requestId: traceId }, outputSummary: { producer: invocation.invocationAttempted ? `${provider.metadata.provider} interpretation` : "TripFlow deterministic interpretation", validator: "TripFlow runtime validation", renderer: "PlanningAssistant" }, errorCode: null, reason: "Planning intent response ready" });
    }
    logPlanningAIInvocationDiagnostics(invocation);
    if (import.meta.env.DEV)
      console.debug("Planning intent validation", {
        provider: provider.metadata.provider,
        status: interpretation.status,
        intentType:
          interpretation.status === "resolved"
            ? interpretation.intent.type
            : undefined,
        validation: "passed",
      });
    executionStage = "response_serialization";
    return Response.json({
      interpretation,
      ...(traceId ? { requestId: traceId } : {}),
      provenance: {
        producerType: invocation.invocationAttempted ? "llm" : "tripflow_deterministic",
        producerStage: invocation.repairSucceeded ? "structured_output_repair" : "initial_interpretation",
        provider: invocation.invocationAttempted ? provider.metadata.provider : "tripflow",
        model: invocation.invocationAttempted ? provider.metadata.model : null,
        requestId: traceId,
        traceEventId: invocation.repairSucceeded ? repairEventId : interpretationEventId,
        transformedBy: ["TripFlow runtime validation", ...(outputNormalized ? ["TripFlow normalization"] : [])],
        reason: invocation.repairSucceeded ? "The initial structured result required model repair before validation." : invocation.routingReason,
      } satisfies AssistantMessageProvenance,
      diagnostics: {
        provider: provider.metadata.provider,
        model: provider.metadata.model,
        latencyMs: Date.now() - started,
        validation: "passed",
        toolPlan,
      },
    });
  } catch (error) {
    if (!invocation.selectedProvider)
      invocation.route = "provider_initialization_failed";
    const failure = classifyPlanningAIExecutionFailure({ error, stage: executionStage, selectedProvider: invocation.selectedProvider, model: invocation.model });
    invocation.failureStage = failure.stage;
    invocation.failureCode = failure.errorCode;
    invocation.failureReason = failure.reason;
    if (traceId) { updatePlanningAITrace(traceId, "modelInvocation", invocation); failureEventId = recordPlanningAITraceEvent(traceId, { stage: "request_failure", sourceType: failure.sourceType, provider: failure.provider, model: failure.model, status: "failed", durationMs: Date.now() - started, inputSummary: { route: invocation.route }, outputSummary: null, errorCode: failure.errorCode, reason: failure.reason, routingReason: invocation.routingReason, failureStage: failure.stage }); }
    logPlanningAIInvocationDiagnostics(invocation);
    if (traceId) {
      traceCurrent("failure", { code: failure.errorCode, stage: failure.stage, reason: failure.reason });
      updatePlanningAITrace(traceId, "parsingValidation", { parseStatus: failure.errorCode === "MALFORMED_AI_OUTPUT" ? "failed" : "unknown", runtimeSchemaValidation: "failed", validationIssues: [{ path: [], code: failure.errorCode }] });
      updatePlanningAITrace(traceId, "routing", { routeSelected: invocation.route, routingReason: invocation.routingReason, executionFailure: { stage: failure.stage, code: failure.errorCode, reason: failure.reason } });
    }
    if (import.meta.env.DEV)
      console.error("Planning intent validation failed", {
        code: error instanceof Error ? error.message : "UNKNOWN_ERROR",
      });
    const debug = traceId ? { requestId: traceId } : {};
    const provenance = { producerType: failure.sourceType, producerStage: failure.stage, provider: failure.provider, model: failure.model, requestId: traceId, traceEventId: failureEventId, transformedBy: failure.sourceType === "llm" ? ["TripFlow error handler"] : [], reason: failure.reason } satisfies AssistantMessageProvenance;
    if (error instanceof Error && error.message === "AI_NOT_CONFIGURED")
      return Response.json(
        { error: "Planning assistant is not configured.", ...debug, provenance },
        { status: 503 },
      );
    if (error instanceof Error && error.message === "OLLAMA_UNAVAILABLE")
      return Response.json(
        { error: "Local planning model is unavailable.", ...debug, provenance },
        { status: 503 },
      );
    if (error instanceof Error && error.message === "OLLAMA_MODEL_NOT_FOUND")
      return Response.json(
        { error: "Configured Ollama model was not found.", ...debug, provenance },
        { status: 503 },
      );
    if (error instanceof Error && error.message === "OLLAMA_TIMEOUT")
      return Response.json(
        { error: "Local planning model timed out.", ...debug, provenance },
        { status: 504 },
      );
    if (
      error instanceof Error &&
      [
        "INVALID_AI_OUTPUT",
        "INVALID_INTENT",
        "MALFORMED_AI_OUTPUT",
        "TRUNCATED_AI_OUTPUT",
      ].includes(
        error.message,
      )
    )
      return Response.json(
        { error: "The assistant returned an invalid planning interpretation.", ...debug, provenance },
        { status: 422 },
      );
    if (error instanceof DOMException && error.name === "AbortError")
      return Response.json(
        { error: "Planning assistant request cancelled.", ...debug, provenance },
        { status: 408 },
      );
    return Response.json(
      { error: "Planning assistant is temporarily unavailable.", ...debug, provenance },
      { status: 502 },
    );
  }
};
