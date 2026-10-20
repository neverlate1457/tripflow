import { afterEach, describe, expect, it } from "vitest";
import { GET, PATCH } from "./debug";
import { clearPlanningAITraces, createPlanningAITrace, getPlanningAITrace, recordPlanningAITraceEvent } from "@/services/planning-ai-debug";

afterEach(() => { delete process.env.TRIPFLOW_AI_DEBUG; });

describe("planning AI debug endpoint", () => {
  it("keeps the safe provenance timeline available without detailed debugging", async () => {
    process.env.TRIPFLOW_AI_DEBUG = "false";
    const response = await GET({ url: new URL("http://localhost/api/ai/debug") } as never);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ enabled: true, detailed: false });
  });
  it("reports enabled only when the development flag is active", async () => {
    process.env.TRIPFLOW_AI_DEBUG = "true";
    const response = await GET({ url: new URL("http://localhost/api/ai/debug") } as never);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ enabled: true, detailed: true });
  });
  it("returns only the safe timeline when detailed debugging is disabled", async () => {
    process.env.TRIPFLOW_AI_DEBUG = "false"; clearPlanningAITraces();
    const trace = createPlanningAITrace({ message: "private request", apiKey: "secret" })!;
    recordPlanningAITraceEvent(trace.requestId, { stage: "provider_invocation", sourceType: "llm", provider: "ollama", model: "qwen3.5:9b", status: "failed", durationMs: 1, inputSummary: { content: "private prompt" }, outputSummary: { raw: "private model output" }, errorCode: "private internal exception", reason: "private failure detail" });
    const response = await GET({ url: new URL(`http://localhost/api/ai/debug?requestId=${trace.requestId}`) } as never);
    const body = await response.json();
    expect(body.detailed).toBe(false);
    expect(body.trace).toMatchObject({ requestId: trace.requestId, timeline: [{ inputSummary: null, outputSummary: null, errorCode: "PLANNING_STAGE_FAILED", reason: "provider invocation did not complete." }] });
    expect(body.trace).not.toHaveProperty("stages");
    expect(JSON.stringify(body)).not.toContain("private prompt");
    expect(JSON.stringify(body)).not.toContain("private model output");
    expect(JSON.stringify(body)).not.toContain("private failure detail");
  });
  it("correlates safe frontend rendering provenance", async () => {
    process.env.TRIPFLOW_AI_DEBUG = "true"; clearPlanningAITraces();
    const trace = createPlanningAITrace({ message: "private" })!;
    const response = await PATCH({ request: new Request("http://localhost/api/ai/debug", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ requestId: trace.requestId, stage: "frontendRendering", value: { component: "PlanningAssistant", status: "rendered" } }) }) } as never);
    expect(response.status).toBe(200);
    expect(getPlanningAITrace(trace.requestId)?.timeline.at(-1)).toMatchObject({ stage: "frontend_rendering", sourceType: "frontend", provider: "react", status: "success" });
  });
});
