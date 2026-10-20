import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import type { PlanningAIExecutionStage } from "./planning-ai-invocation";

export type PlanningAITraceSource = "llm" | "tripflow_runtime" | "tripflow_deterministic" | "place_provider" | "route_provider" | "cache" | "frontend";
export type PlanningAITraceStatus = "success" | "failed" | "skipped" | "fallback";
export interface PlanningAITraceEvent {
  eventId: string;
  stage: string;
  sourceType: PlanningAITraceSource;
  provider: string | null;
  model: string | null;
  status: PlanningAITraceStatus;
  durationMs: number;
  inputSummary: unknown;
  outputSummary: unknown;
  errorCode: string | null;
  reason: string | null;
  routingReason?: string | null;
  failureStage?: PlanningAIExecutionStage | null;
  payloadCaptured?: boolean;
  recordedAt: string;
}
export interface PlanningAIDebugTrace { requestId: string; createdAt: string; stages: Record<string, unknown>; timeline: PlanningAITraceEvent[]; }
export interface PlanningAIProvenanceTrace { requestId: string; createdAt: string; timeline: PlanningAITraceEvent[]; }
const limit = 15, history = new Map<string, PlanningAIDebugTrace>(), scope = new AsyncLocalStorage<string>();
export const planningAIDebugEnabled = () => import.meta.env.DEV && process.env.TRIPFLOW_AI_DEBUG === "true";
export const planningAIDebugContentEnabled = () => planningAIDebugEnabled() && process.env.TRIPFLOW_AI_DEBUG_INCLUDE_CONTENT === "true";
// A bounded, sanitized timeline is required to verify every visible source
// badge. Detailed stage payloads remain development-only.
export const planningAIProvenanceEnabled = () => true;
export const createPlanningAIRequestId = () => randomUUID();
const secretKey = /authorization|cookie|api.?key|secret|password|^(?:access|refresh|id)?_?token$/i;
export function sanitizeDebugValue(value: unknown): unknown {
  if (typeof value === "string") { const max = planningAIDebugContentEnabled() ? 200_000 : 500; return value.length > max ? `${value.slice(0, max)}…[TRUNCATED:${value.length}]` : value; }
  if (Array.isArray(value)) return value.slice(0, 50).map(sanitizeDebugValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => {
    if (secretKey.test(key)) return [key, "[REDACTED]"];
    if (!planningAIDebugContentEnabled() && /^(?:content|rawMessageContent|userMessage|message)$/i.test(key) && typeof item === "string") return [key, `[OMITTED:${item.length} chars]`];
    return [key, sanitizeDebugValue(item)];
  }));
}
export function createPlanningAITrace(initial: Record<string, unknown>, requestId: string = createPlanningAIRequestId()) {
  if (!planningAIProvenanceEnabled()) return null;
  const trace: PlanningAIDebugTrace = { requestId, createdAt: new Date().toISOString(), stages: { request: sanitizeDebugValue(initial) }, timeline: [] };
  history.set(trace.requestId, trace); while (history.size > limit) history.delete(history.keys().next().value!); return trace;
}
export function updatePlanningAITrace(requestId: string, stage: string, value: unknown) { const trace = history.get(requestId); if (trace) trace.stages[stage] = sanitizeDebugValue(value); }
export function recordPlanningAITraceEvent(requestId: string, event: Omit<PlanningAITraceEvent, "recordedAt" | "eventId">) {
  const trace = history.get(requestId); if (!trace) return null;
  const eventId = `${requestId}:${trace.timeline.length + 1}`;
  trace.timeline.push(sanitizeDebugValue({ ...event, eventId, durationMs: Math.max(0, Math.round(event.durationMs)), recordedAt: new Date().toISOString() }) as PlanningAITraceEvent);
  if (trace.timeline.length > 50) trace.timeline.splice(0, trace.timeline.length - 50);
  return eventId;
}
export function recordCurrentPlanningAITraceEvent(event: Omit<PlanningAITraceEvent, "recordedAt" | "eventId">) { const id = scope.getStore(); return id ? recordPlanningAITraceEvent(id, event) : null; }
export function updateCurrentPlanningAITraceEvent(eventId: string | null, patch: Partial<Omit<PlanningAITraceEvent, "eventId" | "recordedAt">>) {
  const id = scope.getStore(); if (!id || !eventId) return;
  const event = history.get(id)?.timeline.find((entry) => entry.eventId === eventId);
  if (event) Object.assign(event, sanitizeDebugValue(patch));
}
export function traceCurrent(stage: string, value: unknown) { const id = scope.getStore(); if (id) updatePlanningAITrace(id, stage, value); }
export function withPlanningAITrace<T>(requestId: string | null, task: () => Promise<T>) { return requestId ? scope.run(requestId, task) : task(); }
export const getPlanningAITrace = (id: string) => planningAIProvenanceEnabled() ? history.get(id) ?? null : null;
const safeCode = (value: string | null) => value && /^[A-Z][A-Z0-9_]{1,63}$/.test(value) ? value : value ? "PLANNING_STAGE_FAILED" : null;
const safeFailureReason = (event: PlanningAITraceEvent) => event.stage === "request_failure"
  ? event.reason
  : `${event.stage.replaceAll("_", " ")} did not complete.`;
export const getPlanningAIProvenanceTrace = (id: string): PlanningAIProvenanceTrace | null => {
  const trace = getPlanningAITrace(id);
  return trace ? {
    requestId: trace.requestId,
    createdAt: trace.createdAt,
    timeline: trace.timeline.map((event) => ({
      ...event,
      inputSummary: null,
      outputSummary: null,
      errorCode: safeCode(event.errorCode),
      reason: event.status === "failed" || event.status === "fallback" ? safeFailureReason(event) : event.reason,
    })),
  } : null;
};
export const planningAITraceCount = () => history.size;
export function clearPlanningAITraces() { history.clear(); }
