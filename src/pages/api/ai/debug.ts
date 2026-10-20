import type { APIRoute } from "astro";
import { getPlanningAIProvenanceTrace, getPlanningAITrace, planningAIDebugEnabled, planningAIProvenanceEnabled, recordPlanningAITraceEvent, updatePlanningAITrace } from "@/services/planning-ai-debug";

export const GET: APIRoute = async ({ url }) => {
  const requestId = url.searchParams.get("requestId");
  if (!requestId) return Response.json({ enabled: planningAIProvenanceEnabled(), detailed: planningAIDebugEnabled() });
  if (!planningAIProvenanceEnabled()) return Response.json({ error: "Not found" }, { status: 404 });
  const trace = planningAIDebugEnabled() ? getPlanningAITrace(requestId) : getPlanningAIProvenanceTrace(requestId);
  return trace ? Response.json({ enabled: true, detailed: planningAIDebugEnabled(), trace }) : Response.json({ error: "Trace not found" }, { status: 404 });
};
export const PATCH: APIRoute = async ({ request }) => {
  if (!planningAIProvenanceEnabled()) return Response.json({ error: "Not found" }, { status: 404 });
  const body = await request.json() as { requestId?: unknown; stage?: unknown; value?: unknown };
  if (typeof body.requestId !== "string" || !["solverInput", "solverResult", "frontendRendering"].includes(String(body.stage))) return Response.json({ error: "Invalid trace update" }, { status: 400 });
  updatePlanningAITrace(body.requestId, String(body.stage), body.value);
  if (body.stage === "frontendRendering") recordPlanningAITraceEvent(body.requestId, { stage: "frontend_rendering", sourceType: "frontend", provider: "react", model: null, status: "success", durationMs: 0, inputSummary: null, outputSummary: body.value, errorCode: null, reason: "PlanningAssistant rendered the current response" });
  if (body.stage === "solverResult") { const result = body.value as { status?: unknown; rejectionReason?: unknown } | null; recordPlanningAITraceEvent(body.requestId, { stage: "solver_result", sourceType: "tripflow_deterministic", provider: "tripflow", model: null, status: result?.status === "ready" ? "success" : "failed", durationMs: 0, inputSummary: null, outputSummary: { status: result?.status ?? null }, errorCode: result?.status === "ready" ? null : "SOLVER_NO_SAFE_PROPOSAL", reason: typeof result?.rejectionReason === "string" ? result.rejectionReason : result?.status === "ready" ? "Deterministic proposal ready" : "Deterministic solver did not produce a safe proposal" }); }
  return Response.json({ ok: true });
};
