import { beforeEach, describe, expect, it } from "vitest";
import { clearPlanningAITraces, createPlanningAITrace, getPlanningAITrace, planningAITraceCount, recordPlanningAITraceEvent, sanitizeDebugValue, updatePlanningAITrace, withPlanningAITrace, traceCurrent } from "./planning-ai-debug";
describe("planning AI debug trace", () => {
  beforeEach(() => { process.env.TRIPFLOW_AI_DEBUG = "true"; clearPlanningAITraces(); });
  it("redacts secrets and prompt content without removing useful IDs", () => expect(sanitizeDebugValue({ candidateId: "c1", message: "private request", Authorization: "Bearer x", nested: { apiKey: "x", providerPlaceId: "p1" } })).toEqual({ candidateId: "c1", message: "[OMITTED:15 chars]", Authorization: "[REDACTED]", nested: { apiKey: "[REDACTED]", providerPlaceId: "p1" } }));
  it("keeps request IDs isolated and history bounded", () => { const ids = Array.from({ length: 20 }, (_, i) => { const trace = createPlanningAITrace({ message: String(i) })!; updatePlanningAITrace(trace.requestId, "routing", { route: i }); return trace.requestId; }); expect(planningAITraceCount()).toBe(15); expect(getPlanningAITrace(ids[0])).toBeNull(); expect(getPlanningAITrace(ids.at(-1)!)?.stages.routing).toEqual({ route: 19 }); });
  it("keeps bounded provenance evidence when detailed debugging is disabled", () => { process.env.TRIPFLOW_AI_DEBUG = "false"; const trace = createPlanningAITrace({ message: "x" })!; recordPlanningAITraceEvent(trace.requestId, { stage: "runtime_validation", sourceType: "tripflow_runtime", provider: "tripflow", model: null, status: "success", durationMs: 1, inputSummary: null, outputSummary: null, errorCode: null, reason: "validated" }); expect(getPlanningAITrace(trace.requestId)?.timeline).toHaveLength(1); expect(getPlanningAITrace(trace.requestId)?.stages.request).toEqual({ message: "[OMITTED:1 chars]" }); });

  it("keeps routing decisions separate from execution failure attribution", () => {
    const trace = createPlanningAITrace({ message: "x" })!;
    recordPlanningAITraceEvent(trace.requestId, { stage: "request_failure", sourceType: "tripflow_runtime", provider: "tripflow", model: null, status: "failed", durationMs: 2, inputSummary: null, outputSummary: null, errorCode: "INVALID_INTENT", reason: "TripFlow rejected the interpretation during runtime validation.", routingReason: "no_deterministic_short_circuit", failureStage: "semantic_runtime_validation" });
    const event = getPlanningAITrace(trace.requestId)?.timeline[0];
    expect(event?.routingReason).toBe("no_deterministic_short_circuit");
    expect(event?.reason).not.toBe("no_deterministic_short_circuit");
    expect(event?.sourceType).toBe("tripflow_runtime");
  });
  it("preserves completed stages for unsupported and validation failures", async () => {
    const trace = createPlanningAITrace({ message: "unsupported" })!;
    await withPlanningAITrace(trace.requestId, async () => {
      traceCurrent("providerRequest", { messages: [{ role: "user", content: "unsupported" }] });
      traceCurrent("providerResult", { rawMessageContent: "{bad-json" });
      traceCurrent("parsingValidation", { parseStatus: "failed", runtimeSchemaValidation: "not_run", validationIssues: [{ path: "$", code: "MALFORMED_AI_OUTPUT" }] });
      traceCurrent("routing", { routeSelected: "unsupported" });
    });
    expect(getPlanningAITrace(trace.requestId)?.stages).toMatchObject({
      request: { message: "[OMITTED:11 chars]" },
      providerRequest: { messages: [{ role: "user", content: "[OMITTED:11 chars]" }] },
      providerResult: { rawMessageContent: "[OMITTED:9 chars]" },
      parsingValidation: { parseStatus: "failed" },
      routing: { routeSelected: "unsupported" },
    });
  });
  it("records a bounded typed provenance timeline", () => {
    const trace = createPlanningAITrace({ message: "x" })!;
    for (let index = 0; index < 55; index++) recordPlanningAITraceEvent(trace.requestId, { stage: `stage_${index}`, sourceType: "tripflow_deterministic", provider: "tripflow", model: null, status: "success", durationMs: index, inputSummary: null, outputSummary: { index }, errorCode: null, reason: "test" });
    expect(getPlanningAITrace(trace.requestId)?.timeline).toHaveLength(50);
    expect(getPlanningAITrace(trace.requestId)?.timeline[0]).toMatchObject({ stage: "stage_5", sourceType: "tripflow_deterministic", status: "success", durationMs: 5 });
  });
  it("records sanitized solver input without touching canonical state", () => {
    const canonical = { items: [{ id: "item-1", startAt: "2026-10-24T12:00:00Z" }] }, before = structuredClone(canonical), trace = createPlanningAITrace({ message: "schedule it" })!;
    updatePlanningAITrace(trace.requestId, "solverInput", { candidateIds: ["candidate-1"], apiKey: "secret" });
    expect(getPlanningAITrace(trace.requestId)?.stages.solverInput).toEqual({ candidateIds: ["candidate-1"], apiKey: "[REDACTED]" });
    expect(canonical).toEqual(before);
  });
});
