import { afterEach, describe, expect, it, vi } from "vitest";
import { buildAIContext, validateInterpretation } from "@/domain/ai-planning";
import { demoCandidates, demoItems, demoTrip } from "@/data/demo-trip";
import {
  OllamaPlanningAIProvider,
  ollamaPlanningIntentSchema,
  ollamaPlanningIntentRepairSchema,
  parseOllamaStructuredContent,
} from "./ollama-planning-ai-provider";
import {
  createPlanningAIProvider,
  MockPlanningAIProvider,
  OpenAIPlanningProvider,
  validateStructuredRepairContract,
} from "./planning-ai-provider";
import { clearPlanningAITraces, createPlanningAITrace, getPlanningAITrace, withPlanningAITrace } from "./planning-ai-debug";

const context = buildAIContext(
    demoTrip,
    demoItems,
    demoCandidates,
    demoTrip.startDate,
  ),
  input = { message: "Add Cape Manzamo tomorrow", context };
afterEach(() => { delete process.env.TRIPFLOW_AI_DEBUG; delete process.env.TRIPFLOW_AI_DEBUG_INCLUDE_CONTENT; });
describe("Ollama planning provider", () => {
  it("uses a bounded supplied-ID schema for place reranking", async () => {
    const fetcher = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => new Response(JSON.stringify({ message: { content: JSON.stringify({ orderedCandidateIds: ["museum"], assessments: [{ candidateId: "museum", relevanceScore: 90, explanation: "Museum category directly supports sightseeing." }] }) } }), { status: 200 }));
    const provider = new OllamaPlanningAIProvider("http://127.0.0.1:11434", "qwen-test", fetcher as typeof fetch);
    const output = await provider.rerankPlaces({ originalRequest: "推薦宮崎景點", geographicScope: "city_area", requestedCategories: ["attraction"], requestedThemes: [], candidates: [{ id: "tomb", name: "170号墳", categories: ["tourism.attraction"] }, { id: "museum", name: "宮崎科学技術館", categories: ["entertainment.museum"] }] });
    expect(output).toMatchObject({ orderedCandidateIds: ["museum"] });
    const body = JSON.parse(String(fetcher.mock.calls[0][1]?.body));
    expect(body.format.properties.orderedCandidateIds.items.enum).toEqual(["tomb", "museum"]);
    expect(body.messages[0].content).toContain("only the supplied provider-backed candidates");
  });

  it("keeps the cross-city discovery contract in structured repair", async () => {
    const fetcher = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => new Response(JSON.stringify({ message: { content: JSON.stringify({ status: "resolved", intent: { type: "discover_places", date: context.selectedDate, categories: ["attraction"], geographicScope: "city_area", geographicReference: { text: "宮崎市" } } }) } }), { status: 200 }));
    const provider = new OllamaPlanningAIProvider("http://127.0.0.1:11434", "qwen-test", fetcher as typeof fetch);
    await provider.repairIntent({ message: "推薦宮崎市景點", context }, { status: "unsupported", reason: "outside trip" }, "Explicit geography may be outside the trip");
    const body = JSON.parse(String(fetcher.mock.calls[0][1]?.body));
    expect(body.messages[0].content).toContain("never compare that place with the current Trip Destination");
    expect(body.messages[2].content).toContain("Discovery is allowed outside the current trip");
  });

  it("requires corridor discovery repair to remain a resolved discovery intent", () => {
    const invalid = { status: "resolved", intent: { type: "discover_places", geographicReference: { text: "福岡到小倉沿途" }, geographicScope: "corridor" } };
    const issue = "discover_places requires corridorReference with separate endpoints";
    const schema = ollamaPlanningIntentRepairSchema(input, invalid, issue);
    expect(schema.properties.status).toEqual({ const: "resolved" });
    expect(schema.required).toEqual(["status", "intent"]);
    expect(schema.properties).not.toHaveProperty("reason");
    expect(schema.properties.intent.allOf).toBeDefined();
    expect(() => validateStructuredRepairContract({ status: "unsupported", reason: "The request names two endpoints and cannot satisfy the corridor schema." }, invalid, issue)).toThrow("AI_SEMANTIC_CONTRACT");
    expect(() => validateStructuredRepairContract({ status: "resolved", intent: { type: "discover_places" } }, invalid, issue)).not.toThrow();
    expect(() => validateStructuredRepairContract({ status: "resolved", intent: { type: "discover_places", geographicScope: "corridor", geographicReference: { text: "福岡到小倉" }, corridorReference: { originText: "福岡", destinationText: "小倉" } } }, invalid, issue)).toThrow("AI_SEMANTIC_CONTRACT");
    expect(() => validateStructuredRepairContract({ status: "resolved", intent: { type: "discover_places", geographicScope: "corridor", corridorReference: { originText: "福岡", destinationText: "小倉" } } }, invalid, issue)).not.toThrow();
  });

  it("tells repair to retain LLM-first corridor authority and exclusive endpoint fields", async () => {
    const fetcher = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => new Response(JSON.stringify({ message: { content: JSON.stringify({ status: "resolved", intent: { type: "discover_places", date: context.selectedDate, categories: ["cafe"], geographicScope: "corridor", corridorReference: { originText: "福岡", destinationText: "小倉" } } }) } }), { status: 200 }));
    const provider = new OllamaPlanningAIProvider("http://127.0.0.1:11434", "qwen-test", fetcher as typeof fetch);
    await provider.repairIntent({ message: "找福岡到小倉的咖啡廳", context }, { status: "resolved", intent: { type: "discover_places", geographicScope: "corridor" } }, "corridor endpoints required");
    const body = JSON.parse(String(fetcher.mock.calls[0][1]?.body));
    expect(body.messages[2].content).toContain("Do not change a plausible corridor into city_area");
    expect(body.messages[2].content).toContain("remove geographicReference");
  });

  it("uses /api/chat structured schema and exposes diagnostics metadata", async () => {
    process.env.TRIPFLOW_AI_DEBUG = "true";
    clearPlanningAITraces();
    const fetcher = vi.fn(
        async (_url: string | URL | Request, _init?: RequestInit) =>
          new Response(
            JSON.stringify({
              message: {
                content: JSON.stringify({
                  status: "resolved",
                  intent: {
                    type: "insert_candidate",
                    candidateId: "candidate-1",
                    date: "2026-10-25",
                  },
                }),
              },
              prompt_eval_count: 40,
              eval_count: 12,
            }),
            { status: 200 },
          ),
      ),
      provider = new OllamaPlanningAIProvider(
        "http://127.0.0.1:11434/",
        "qwen-test",
        fetcher as typeof fetch,
      ),
      trace = createPlanningAITrace({ message: input.message })!,
      raw = await withPlanningAITrace(trace.requestId, () => provider.interpretIntent(input));
    expect(validateInterpretation(raw, context).status).toBe("resolved");
    expect(provider.metadata).toEqual({
      provider: "ollama",
      model: "qwen-test",
    });
    const [url, init] = fetcher.mock.calls[0];
    expect(String(url)).toBe("http://127.0.0.1:11434/api/chat");
    const body = JSON.parse(String(init?.body));
    const recorded = getPlanningAITrace(trace.requestId)?.stages.providerRequest as { messages: unknown; format: unknown };
    expect(recorded.messages).toEqual(body.messages.map((message: { role: string; content: string }) => ({
      role: message.role,
      content: `[OMITTED:${message.content.length} chars]`,
    })));
    expect(recorded.format).toEqual(body.format);
    expect(body).toMatchObject({
      model: "qwen-test",
      stream: false,
      think: false,
      options: { temperature: 0, num_predict: 400 },
    });
    expect(body.format.properties.intent.properties.type.enum).toEqual([
      "repair_day",
      "insert_candidate",
      "insert_candidates",
      "discover_places",
      "explain_issues",
      "explain_proposal",
    ]);
    expect(body.messages[0].content).not.toContain("Cape Manzamo");
    expect(body.messages[0].content).toContain("what is nearby");
    expect(body.format.properties.intent.required).toEqual(["type"]);
    expect(body.format.properties.intent.allOf).toHaveLength(6);
    expect(body.format.properties.intent.allOf[3].then.required).toEqual([
      "date",
      "categories",
      "geographicScope",
    ]);
  });
  it("captures the exact outbound payload and raw/parsed response only when both content flags are enabled", async () => {
    process.env.TRIPFLOW_AI_DEBUG = "true";
    process.env.TRIPFLOW_AI_DEBUG_INCLUDE_CONTENT = "true";
    clearPlanningAITraces();
    const modelOutput = { status: "resolved", intent: { type: "discover_places", date: context.selectedDate, categories: ["cafe"], geographicScope: "city_area", geographicReference: { text: "Fukuoka" } } };
    const fetcher = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => new Response(JSON.stringify({ message: { content: JSON.stringify(modelOutput) }, done_reason: "stop" }), { status: 200 }));
    const provider = new OllamaPlanningAIProvider("http://127.0.0.1:11434", "qwen-test", fetcher as typeof fetch);
    const trace = createPlanningAITrace({ message: input.message })!;
    await withPlanningAITrace(trace.requestId, () => provider.interpretIntent(input));
    const sent = JSON.parse(String(fetcher.mock.calls[0][1]?.body));
    const event = getPlanningAITrace(trace.requestId)?.timeline.find((entry) => entry.stage === "provider_invocation");
    expect(event?.payloadCaptured).toBe(true);
    expect((event?.inputSummary as { outboundRequest: unknown }).outboundRequest).toEqual(sent);
    expect(event?.outputSummary).toEqual({ rawModelOutput: JSON.stringify(modelOutput), parsedJson: modelOutput });
  });
  it("captures structured repair as its own exact LLM call", async () => {
    process.env.TRIPFLOW_AI_DEBUG = "true";
    process.env.TRIPFLOW_AI_DEBUG_INCLUDE_CONTENT = "true";
    clearPlanningAITraces();
    const repaired = { status: "resolved", intent: { type: "discover_places", date: context.selectedDate, categories: ["cafe"], geographicScope: "city_area", geographicReference: { text: "Fukuoka" } } };
    const fetcher = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => new Response(JSON.stringify({ message: { content: JSON.stringify(repaired) }, done_reason: "stop" }), { status: 200 }));
    const provider = new OllamaPlanningAIProvider("http://127.0.0.1:11434", "qwen-test", fetcher as typeof fetch);
    const trace = createPlanningAITrace({ message: input.message })!;
    await withPlanningAITrace(trace.requestId, () => provider.repairIntent(input, { status: "unsupported", reason: "invalid" }, "discover_places requires geographicScope"));
    const event = getPlanningAITrace(trace.requestId)?.timeline.find((entry) => entry.stage === "structured_output_repair");
    const sent = JSON.parse(String(fetcher.mock.calls[0][1]?.body));
    expect(event?.payloadCaptured).toBe(true);
    expect((event?.inputSummary as { outboundRequest: unknown }).outboundRequest).toEqual(sent);
    expect((event?.outputSummary as { parsedJson: unknown }).parsedJson).toEqual(repaired);
  });
  it("constrains supplied IDs and never permits coordinates", () => {
    const schema = ollamaPlanningIntentSchema(input),
      serialized = JSON.stringify(schema);
    expect(serialized).toContain("candidate-1");
    expect(serialized).not.toContain("latitude");
    expect(serialized).not.toContain("providerPlaceId");
    expect(serialized).toContain("[0-5]\\\\d");
  });
  it("uses a type-specific repair schema once the model selected discovery", () => {
    const schema = ollamaPlanningIntentRepairSchema(input, {
      status: "resolved",
      intent: { type: "discover_places" },
    });
    expect(schema.properties.intent.properties.type).toEqual({
      const: "discover_places",
    });
    expect(schema.properties.intent.required).toEqual([
      "type",
      "date",
      "categories",
      "geographicScope",
    ]);
  });
  it("rejects malformed JSON for normal runtime error handling", async () => {
    const provider = new OllamaPlanningAIProvider(
      "http://local",
      "model",
      async () =>
        new Response(JSON.stringify({ message: { content: "not-json" } }), {
          status: 200,
        }),
    );
    await expect(provider.interpretIntent(input)).rejects.toThrow(
      "MALFORMED_AI_OUTPUT",
    );
  });
  it("accepts a markdown-wrapped structured response and drops optional null fields", () => {
    expect(
      parseOllamaStructuredContent(
        '```json\n{"status":"resolved","intent":{"type":"discover_places","date":"2026-10-24","query":null}}\n```',
      ),
    ).toEqual({
      status: "resolved",
      intent: { type: "discover_places", date: "2026-10-24" },
    });
  });
  it("rejects a truncated Ollama response", async () => {
    const provider = new OllamaPlanningAIProvider(
      "http://local",
      "model",
      async () =>
        Response.json({
          done_reason: "length",
          message: { content: '{"status":"resolved"' },
        }),
    );
    await expect(provider.interpretIntent(input)).rejects.toThrow(
      "TRUNCATED_AI_OUTPUT",
    );
  });
  it("keeps the provider schema bounded while runtime validation enforces intent-specific duration limits", () => {
    const schema = JSON.parse(
        JSON.stringify(ollamaPlanningIntentSchema(input)),
      ) as {
        properties: {
          intent: { properties: { durationMinutes: Record<string, number> } };
        };
      },
      duration = schema.properties.intent.properties.durationMinutes;
    expect(duration).toMatchObject({
      minimum: 15,
      maximum: 720,
      multipleOf: 15,
    });
    expect(() => validateInterpretation({ status: "resolved", intent: { type: "discover_places", date: "2026-10-24", durationMinutes: 720 } }, context)).toThrow("INVALID_INTENT");
  });
  it("rejects missing required intent fields and invalid enums at runtime", () => {
    expect(() =>
      validateInterpretation(
        {
          status: "resolved",
          intent: { type: "discover_places", categories: ["lighthouse"] },
        },
        context,
      ),
    ).toThrow("INVALID_INTENT");
  });
  it("ignores thinking and rejects empty message content", async () => {
    const provider = new OllamaPlanningAIProvider(
      "http://local",
      "model",
      async () =>
        new Response(
          JSON.stringify({
            thinking: JSON.stringify({
              status: "resolved",
              intent: { type: "repair_day", date: "2026-10-24" },
            }),
            message: { content: "" },
          }),
          { status: 200 },
        ),
    );
    await expect(provider.interpretIntent(input)).rejects.toThrow(
      "MALFORMED_AI_OUTPUT",
    );
  });
  it("uses message.content even when thinking contains a conflicting mutation", async () => {
    const safe = {
        status: "resolved",
        intent: { type: "repair_day", date: "2026-10-24" },
      },
      provider = new OllamaPlanningAIProvider(
        "http://local",
        "model",
        async () =>
          new Response(
            JSON.stringify({
              thinking: "delete everything",
              message: { content: JSON.stringify(safe) },
            }),
            { status: 200 },
          ),
      );
    await expect(provider.interpretIntent(input)).resolves.toEqual(safe);
  });
  it("leaves schema-invalid output for TripFlow runtime rejection", async () => {
    const provider = new OllamaPlanningAIProvider(
        "http://local",
        "model",
        async () =>
          new Response(
            JSON.stringify({
              message: {
                content: JSON.stringify({
                  status: "resolved",
                  intent: {
                    type: "insert_candidate",
                    candidateId: "invented",
                    date: "2026-10-24",
                  },
                }),
              },
            }),
            { status: 200 },
          ),
      ),
      raw = await provider.interpretIntent(input);
    expect(() => validateInterpretation(raw, context)).toThrow(
      "INVALID_INTENT",
    );
  });
  it("cannot turn an invented seaside POI into a grounded discovery result", async () => {
    const provider = new OllamaPlanningAIProvider(
        "http://local",
        "model",
        async () =>
          new Response(
            JSON.stringify({
              message: {
                content: JSON.stringify({
                  status: "resolved",
                  intent: {
                    type: "discover_places",
                    date: "2026-10-24",
                    location: "墾丁國家公園",
                    latitude: 21.95,
                    longitude: 120.78,
                  },
                }),
              },
            }),
            { status: 200 },
          ),
      ),
      raw = await provider.interpretIntent({
        ...input,
        message: "10/24 下午想找一個看海的地方",
      });
    expect(() => validateInterpretation(raw, context)).toThrow(
      "INVALID_INTENT",
    );
  });
  it("reports unavailable without falling back", async () => {
    const provider = new OllamaPlanningAIProvider(
      "http://local",
      "model",
      async () => {
        throw new TypeError("offline");
      },
    );
    await expect(provider.interpretIntent(input)).rejects.toThrow(
      "OLLAMA_UNAVAILABLE",
    );
  });
  it("distinguishes a missing model", async () => {
    const provider = new OllamaPlanningAIProvider(
      "http://local",
      "missing",
      async () =>
        new Response(
          JSON.stringify({ error: "model not found, try pulling it first" }),
          { status: 404 },
        ),
    );
    await expect(provider.interpretIntent(input)).rejects.toThrow(
      "OLLAMA_MODEL_NOT_FOUND",
    );
  });
  it("uses the independently configured local timeout", async () => {
    const provider = new OllamaPlanningAIProvider(
      "http://local",
      "model",
      (_url, init) =>
        new Promise((_resolve, reject) =>
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("Timed out", "AbortError")),
          ),
        ),
      5,
    );
    await expect(provider.interpretIntent(input)).rejects.toThrow(
      "OLLAMA_TIMEOUT",
    );
  });
  it("honors caller cancellation", async () => {
    const controller = new AbortController(),
      provider = new OllamaPlanningAIProvider(
        "http://local",
        "model",
        (_url, init) =>
          new Promise((_resolve, reject) =>
            init?.signal?.addEventListener("abort", () =>
              reject(new DOMException("Cancelled", "AbortError")),
            ),
          ),
      );
    const pending = provider.interpretIntent(input, controller.signal);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });
  it("parses only controlled explanation JSON", async () => {
    const provider = new OllamaPlanningAIProvider(
      "http://local",
      "model",
      async () =>
        new Response(
          JSON.stringify({
            message: {
              content: JSON.stringify({ text: "Grounded facts only." }),
            },
          }),
          { status: 200 },
        ),
    );
    await expect(
      provider.explain({ kind: "issues", facts: [] }),
    ).resolves.toMatchObject({ text: "Grounded facts only." });
  });
});

describe("planning provider selection", () => {
  it("selects Ollama without an OpenAI key", () => {
    const provider = createPlanningAIProvider({
      provider: "ollama",
      ollamaBaseUrl: "http://127.0.0.1:11434",
      ollamaModel: "qwen3.5:9b",
    });
    expect(provider).toBeInstanceOf(OllamaPlanningAIProvider);
    expect(provider.metadata).toEqual({ provider: "ollama", model: "qwen3.5:9b" });
  });
  it("preserves explicit OpenAI selection", () => {
    expect(createPlanningAIProvider({ provider: "openai", openAIKey: "test-key" })).toBeInstanceOf(OpenAIPlanningProvider);
  });
  it("preserves explicit Mock selection", () => {
    expect(createPlanningAIProvider({ provider: "mock" })).toBeInstanceOf(MockPlanningAIProvider);
  });
  it("never falls back for an unknown provider", () => {
    expect(() => createPlanningAIProvider({ provider: "other" })).toThrow("AI_NOT_CONFIGURED");
  });
});
