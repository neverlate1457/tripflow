import type { IntentInterpretation } from "@/domain/ai-planning";
import type { AssistantMessageProvenance } from "@/domain/assistant-provenance";

export interface PlanningAIClient {
  interpret(
    tripId: string,
    selectedDate: string,
    message: string,
    signal?: AbortSignal,
  ): Promise<{
    interpretation: IntentInterpretation;
    diagnostics: {
      provider: string;
      model: string;
      latencyMs: number;
      validation: string;
    };
    requestId?: string;
    provenance: AssistantMessageProvenance;
  }>;
}

export class HttpPlanningAIClient implements PlanningAIClient {
  private readonly fetcher: typeof fetch;
  constructor(fetcher?: typeof fetch) {
    // Chromium requires Window as the receiver of its native fetch. Saving the
    // unbound function and later calling it as this.fetcher() throws before a
    // network request is created.
    this.fetcher = fetcher ?? globalThis.fetch.bind(globalThis);
  }
  async interpret(
    tripId: string,
    selectedDate: string,
    message: string,
    signal?: AbortSignal,
  ) {
    const response = await this.fetcher("/api/ai/planning-intent", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tripId, selectedDate, message }),
      signal,
    });
    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as {
        error?: string;
        requestId?: string;
        provenance?: AssistantMessageProvenance;
      };
      const error = new Error(body.error ?? "Planning assistant failed") as Error & { requestId?: string; provenance?: AssistantMessageProvenance };
      error.requestId = body.requestId;
      error.provenance = body.provenance;
      throw error;
    }
    return response.json();
  }
}

export class HttpPlanningAIDebugClient {
  async capabilities() { const response = await fetch("/api/ai/debug"); if (!response.ok) return { provenance: false, detailed: false }; const body = await response.json(); return { provenance: Boolean(body.enabled), detailed: Boolean(body.detailed) }; }
  async trace(requestId: string) { const response = await fetch(`/api/ai/debug?requestId=${encodeURIComponent(requestId)}`); if (!response.ok) throw new Error("Debug trace unavailable"); const trace = (await response.json()).trace as import("@/services/planning-ai-debug").PlanningAIDebugTrace; return { ...trace, stages: trace.stages ?? {} }; }
  async update(requestId: string, stage: "solverInput" | "solverResult" | "frontendRendering", value: unknown) { await fetch("/api/ai/debug", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ requestId, stage, value }) }); }
}
