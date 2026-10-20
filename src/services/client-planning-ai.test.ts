import { describe, expect, it, vi } from "vitest";
import { HttpPlanningAIClient } from "./client-planning-ai";

describe("HttpPlanningAIClient", () => {
  it("binds the browser-native fetch receiver instead of throwing before the request", async () => {
    const original = globalThis.fetch,
      receiverFetch = vi.fn(function (this: typeof globalThis) {
        if (this !== globalThis) throw new TypeError("Illegal invocation");
        return Promise.resolve(
          new Response(
            JSON.stringify({
              interpretation: { status: "unsupported", reason: "test" },
              diagnostics: {
                provider: "mock",
                model: "mock",
                latencyMs: 0,
                validation: "passed",
              },
            }),
            { status: 200 },
          ),
        );
      }) as unknown as typeof fetch;
    globalThis.fetch = receiverFetch;
    try {
      const client = new HttpPlanningAIClient();
      await client.interpret("trip", "2026-11-14", "message");
      expect(receiverFetch).toHaveBeenCalledOnce();
    } finally {
      globalThis.fetch = original;
    }
  });
  it("submitting a valid request invokes the planning-intent API with the active trip context", async () => {
    const payload = {
        interpretation: {
          status: "resolved",
          intent: {
            type: "discover_places",
            date: "2026-11-14",
            preferences: { themes: ["seaside"] },
          },
        },
        diagnostics: {
          provider: "ollama",
          model: "qwen3.5:9b",
          latencyMs: 10,
          validation: "passed",
        },
      },
      fetcher = vi.fn(
        async (_input: RequestInfo | URL, _init?: RequestInit) =>
          new Response(JSON.stringify(payload), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
      ),
      client = new HttpPlanningAIClient(fetcher as typeof fetch),
      controller = new AbortController(),
      result = await client.interpret(
        "4c438e64-3100-46e0-95a3-c2c31123a70b",
        "2026-11-14",
        "11/14 下午想找一個看海的地方",
        controller.signal,
      );
    expect(fetcher).toHaveBeenCalledOnce();
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe("/api/ai/planning-intent");
    expect(init).toMatchObject({
      method: "POST",
      signal: controller.signal,
      headers: { "content-type": "application/json" },
    });
    expect(JSON.parse(String(init?.body))).toEqual({
      tripId: "4c438e64-3100-46e0-95a3-c2c31123a70b",
      selectedDate: "2026-11-14",
      message: "11/14 下午想找一個看海的地方",
    });
    expect(result).toEqual(payload);
  });
  it("surfaces the safe API error", async () => {
    const client = new HttpPlanningAIClient(
      async () =>
        new Response(
          JSON.stringify({ error: "Local planning model is unavailable." }),
          { status: 503 },
        ),
    );
    await expect(
      client.interpret("trip", "2026-11-14", "message"),
    ).rejects.toThrow("Local planning model is unavailable.");
  });
  it("preserves server-authored error provenance instead of attributing it to the selected model", async () => {
    const provenance = { producerType: "tripflow_runtime", producerStage: "error_handling", provider: "tripflow", model: null, requestId: "request-4", traceEventId: "request-4:3", transformedBy: [], reason: "INVALID_AI_OUTPUT" } as const;
    const client = new HttpPlanningAIClient(async () => new Response(JSON.stringify({ error: "The assistant returned an invalid planning interpretation.", requestId: "request-4", provenance }), { status: 422 }));
    try {
      await client.interpret("trip", "2026-11-14", "message");
      throw new Error("Expected request to fail");
    } catch (error) {
      expect(error).toMatchObject({ message: "The assistant returned an invalid planning interpretation.", requestId: "request-4", provenance });
    }
  });
  it("propagates AbortController cancellation to an in-flight planning request", async () => {
    const fetcher = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("Cancelled", "AbortError")), { once: true });
    }));
    const client = new HttpPlanningAIClient(fetcher as typeof fetch);
    const controller = new AbortController();
    const pending = client.interpret("trip", "2026-11-14", "first request", controller.signal);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });
});
