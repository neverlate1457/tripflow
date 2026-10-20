import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PlanningAITracePayload } from "./PlanningAITracePayload";

const base = { eventId: "r:1", stage: "provider_invocation", sourceType: "llm" as const, provider: "ollama", model: "qwen", status: "success" as const, durationMs: 1, inputSummary: null, outputSummary: null, errorCode: null, reason: null, recordedAt: "2026-01-01T00:00:00Z" };
describe("PlanningAITracePayload", () => {
  it("states when payload content was not captured", () => expect(renderToStaticMarkup(<PlanningAITracePayload event={{ ...base, payloadCaptured: false }}/>)).toContain("Payload not captured"));
  it("renders expandable exact input/output and copy controls", () => { const html = renderToStaticMarkup(<PlanningAITracePayload event={{ ...base, payloadCaptured: true, inputSummary: { outboundRequest: { messages: ["exact prompt"] } }, outputSummary: { rawModelOutput: "exact response" } }}/>); expect(html).toContain("Input"); expect(html).toContain("exact prompt"); expect(html).toContain("exact response"); expect(html).toContain("Copy Prompt"); expect(html).toContain("Copy Response"); expect(html).toContain("Copy Stage"); });
});
