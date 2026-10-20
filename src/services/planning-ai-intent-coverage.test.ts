import { describe, expect, it } from "vitest";
import { buildAIContext, validateInterpretation } from "@/domain/ai-planning";
import { demoCandidates, demoItems, demoTrip } from "@/data/demo-trip";
import {
  extractGeographicReference,
  extractGeographicReferenceEvidence,
  extractDiscoveryQuantity,
  extractCorridorReference,
  implicitDiscoveryIntent,
  MockPlanningAIProvider,
  normalizeImplicitDiscoveryInterpretation,
  normalizePlanningProviderInterpretation,
  describeScheduleSemanticContradiction,
} from "./planning-ai-provider";

const context = buildAIContext(
  demoTrip,
  demoItems,
  demoCandidates,
  "2026-10-26",
);

const genericRequests = [
  "下午可以去哪？",
  "附近有什麼好玩的？",
  "有沒有推薦的景點？",
  "等一下可以去哪？",
  "這附近有什麼可以逛？",
  "Where can I go this afternoon?",
  "Anything interesting nearby?",
];

const constrainedRequests = [
  ["下午想找個地方喝咖啡", { categories: ["cafe"] }],
  [
    "晚上想吃當地料理",
    { categories: ["restaurant"], preferences: { themes: ["local_food"] } },
  ],
  [
    "下雨的話下午可以去哪？",
    {
      categories: ["museum"],
      preferences: { themes: ["rainy_day"], indoorOutdoor: "indoor" },
    },
  ],
  ["還車前有沒有順路的地方？", {}],
  [
    "想找一個看海的地方",
    {
      categories: ["beach", "viewpoint"],
      preferences: { themes: ["seaside", "scenic"] },
    },
  ],
] as const;

describe("implicit place-discovery intent coverage", () => {
  it("normalizes Mock and Ollama-style Hakata nearby interpretations through the same request-derived intent", async () => {
    const message = "博多附近找咖啡廳";
    const mockRaw = await new MockPlanningAIProvider().interpretIntent({ message, context });
    const ollamaStyleRaw = {
      status: "resolved",
      intent: {
        type: "discover_places",
        date: context.selectedDate,
        geographicReference: { text: "博多附近" },
        maxDetourMinutes: 30,
        geographicScope: "nearby_point",
      },
    };
    for (const raw of [mockRaw, ollamaStyleRaw])
      expect(
        validateInterpretation(
          normalizeImplicitDiscoveryInterpretation(raw, { message, context }),
          context,
        ),
      ).toMatchObject({
        status: "resolved",
        intent: {
          type: "discover_places",
          categories: ["cafe"],
          geographicReference: { text: "博多" },
          geographicScope: "nearby_point",
        },
      });
  });
  it.each([
    ["推薦我幾個景點", "幾個", undefined, "attraction"],
    ["找幾間咖啡廳", "幾間", undefined, "cafe"],
  ])("keeps generic discovery quantity out of geographic identity for %s", (message, raw, reference, category) => {
    expect(extractDiscoveryQuantity(message)).toMatchObject({ raw });
    expect(extractGeographicReference(message)).toBe(reference);
    expect(implicitDiscoveryIntent(message, context)).toMatchObject({ type: "discover_places", categories: [category] });
    expect(implicitDiscoveryIntent(message, context)).not.toHaveProperty("geographicReference");
  });

  it("keeps an explicitly named city on the explicit grounding path after quantity cleanup", () => {
    expect(extractGeographicReference("推薦我幾個桂林的景點")).toBe("桂林");
    expect(implicitDiscoveryIntent("推薦我幾個桂林的景點", context)).toMatchObject({ geographicReference: { text: "桂林" }, geographicScope: "city_area" });
  });

  it("marks unnamed nearby language as point semantics without inventing a reference", () => {
    expect(implicitDiscoveryIntent("附近有什麼景點", context)).toMatchObject({ geographicScope: "nearby_point", categories: ["attraction"] });
    expect(implicitDiscoveryIntent("附近有什麼景點", context)).not.toHaveProperty("geographicReference");
  });

  it.each([
    ["幫我找札幌市區的景點", "札幌市區", "市區", "札幌", "attraction"],
    ["找京都市中心的咖啡廳", "京都市中心", "市中心", "京都", "cafe"],
    ["下午找福岡市區的餐廳", "福岡市區", "市區", "福岡", "restaurant"],
    ["Find attractions in downtown Sapporo", "downtown Sapporo", "downtown", "Sapporo", "attraction"],
    ["Find cafes in central Kyoto", "central Kyoto", "central", "Kyoto", "cafe"],
  ])("separates city scope language from provider identity for %s", (message, rawPhrase, descriptor, reference, category) => {
    expect(extractGeographicReferenceEvidence(message)).toEqual({ rawPhrase, scopeDescriptor: descriptor, reference });
    expect(implicitDiscoveryIntent(message, context)).toMatchObject({
      type: "discover_places",
      categories: [category],
      geographicReference: { text: reference },
      geographicScope: "city_area",
    });
  });

  it.each([
    ["找新竹市的景點", "新竹市"],
    ["找台北市的景點", "台北市"],
    ["找三重市的景點", "三重市"],
    ["找中央區的景點", "中央區"],
    ["找中區的景點", "中區"],
    ["找八里的景點", "八里"],
    ["找五間堂的景點", "五間堂"],
  ])("preserves legitimate administrative/place identity in %s", (message, reference) => {
    expect(extractGeographicReferenceEvidence(message)).toEqual({ rawPhrase: reference, reference });
  });

  it("keeps temporal evidence separate from a city scope descriptor", () => {
    expect(implicitDiscoveryIntent("明天下午推薦京都市中心的景點", context)).toMatchObject({
      type: "discover_places",
      categories: ["attraction"],
      geographicReference: { text: "京都" },
      geographicScope: "city_area",
      timeWindow: { start: "12:00", end: "18:00" },
    });
  });

  it("does not alter nearby or corridor scope while cleaning city descriptors", () => {
    expect(implicitDiscoveryIntent("札幌站附近找咖啡廳", context)).toMatchObject({ geographicReference: { text: "札幌站" }, geographicScope: "nearby_point" });
    expect(implicitDiscoveryIntent("札幌到小樽路上找咖啡廳", context)).toMatchObject({ corridorReference: { originText: "札幌", destinationText: "小樽" }, geographicScope: "corridor" });
  });

  it.each([
    ["找長崎的餐廳", "長崎"],
    ["找幾間長崎的餐廳", "長崎"],
    ["長崎有什麼餐廳", "長崎"],
    ["找幾間廣島的咖啡廳", "廣島"],
    ["找幾個台北市的景點", "台北市"],
    ["推薦幾個札幌的景點", "札幌"],
    ["找三間京都的咖啡廳", "京都"],
    ["推薦兩間福岡的餐廳", "福岡"],
    ["找5間大阪的餐廳", "大阪"],
    ["找五間大阪的餐廳", "大阪"],
    ["找一些神戶的博物館", "神戶"],
    ["找幾個熊本的景點", "熊本"],
  ])("separates discovery quantity from geography for %s", (message, reference) => {
    expect(extractGeographicReference(message)).toBe(reference);
    expect(implicitDiscoveryIntent(message, context)).toMatchObject({ geographicReference: { text: reference }, geographicScope: "city_area" });
  });

  it.each([
    ["找幾間長崎的餐廳", "幾間", undefined],
    ["找三間京都的咖啡廳", "三間", 3],
    ["找5間大阪的餐廳", "5間", 5],
    ["找一些神戶的博物館", "一些", undefined],
  ])("extracts bounded quantity evidence for %s", (message, raw, count) => {
    expect(extractDiscoveryQuantity(message)).toMatchObject({ raw, ...(count ? { normalizedCount: count } : {}) });
  });

  it.each([
    ["找三重市的餐廳", "三重市"],
    ["找五間堂的景點", "五間堂"],
    ["推薦八里的景點", "八里"],
  ])("preserves legitimate numeral-bearing place name in %s", (message, reference) => {
    expect(extractDiscoveryQuantity(message)).toBeUndefined();
    expect(extractGeographicReference(message)).toBe(reference);
  });

  it("normalizes model output through the same clean quantity boundary", () => {
    const normalized = normalizeImplicitDiscoveryInterpretation(
      { status: "resolved", intent: { type: "discover_places", date: context.selectedDate, geographicReference: { text: "幾間 長崎" } } },
      { message: "找幾間長崎的餐廳", context },
    );
    expect(validateInterpretation(normalized, context)).toMatchObject({ status: "resolved", intent: { type: "discover_places", categories: ["restaurant"], geographicReference: { text: "長崎" } } });
  });

  it.each([
    ["找幾個台北市的景點", "台北市", "attraction", "city_area"],
    ["推薦京都景點", "京都", "attraction", "city_area"],
    ["京都有什麼景點", "京都", "attraction", "city_area"],
    ["台北有哪些景點", "台北", "attraction", "city_area"],
    ["下午找幾個台北市的景點", "台北市", "attraction", "city_area"],
    ["明天下午推薦京都景點", "京都", "attraction", "city_area"],
    ["Find attractions in Taipei.", "Taipei", "attraction", "city_area"],
    ["Recommend attractions in Kyoto.", "Kyoto", "attraction", "city_area"],
    ["Recommend some attractions in Sapporo.", "Sapporo", "attraction", "city_area"],
    ["What museums are there in Kobe?", "Kobe", "museum", "city_area"],
    ["Find some cafes in Hiroshima.", "Hiroshima", "cafe", "city_area"],
    ["Find some attractions in Kumamoto this afternoon.", "Kumamoto", "attraction", "city_area"],
    ["Find restaurants in Nagasaki tomorrow evening.", "Nagasaki", "restaurant", "city_area"],
  ])("preserves explicit city-area semantics for %s", (message, reference, category, scope) => {
    expect(implicitDiscoveryIntent(message, context)).toMatchObject({
      type: "discover_places",
      categories: [category],
      geographicReference: { text: reference },
      geographicScope: scope,
    });
  });

  it.each([
    ["熊本站附近找景點", "熊本站", "attraction"],
    ["小樽站附近找咖啡廳", "小樽站", "cafe"],
    ["台北車站附近找咖啡廳", "台北車站", "cafe"],
    ["新大阪站附近找午餐", "新大阪站", "restaurant"],
    ["那霸機場附近找餐廳", "那霸機場", "restaurant"],
    ["博多站附近找咖啡廳", "博多站", "cafe"],
    ["Find attractions near Kumamoto Station.", "Kumamoto Station", "attraction"],
    ["Find cafes near Otaru Station.", "Otaru Station", "cafe"],
    ["Find cafes near Taipei Main Station.", "Taipei Main Station", "cafe"],
    ["Find lunch near Shin-Osaka Station.", "Shin-Osaka Station", "restaurant"],
    ["Find restaurants near Naha Airport.", "Naha Airport", "restaurant"],
    ["Find cafes near Hakata Station.", "Hakata Station", "cafe"],
  ])("preserves nearby reference and category for %s", (message, reference, category) => {
    expect(implicitDiscoveryIntent(message, context)).toMatchObject({ categories: [category], geographicReference: { text: reference }, geographicScope: "nearby_point" });
  });
  it.each(genericRequests)(
    "classifies %s as provider-backed discovery",
    async (message) => {
      const raw = await new MockPlanningAIProvider().interpretIntent({
        message,
        context,
      });
      const result = validateInterpretation(raw, context);
      expect(result).toMatchObject({
        status: "resolved",
        intent: { type: "discover_places", date: context.selectedDate },
      });
    },
  );

  it("uses the selected date and only the stated afternoon constraint", async () => {
    const raw = await new MockPlanningAIProvider().interpretIntent({
      message: "下午可以去哪？",
      context,
    });
    expect(raw).toMatchObject({
      status: "resolved",
      intent: {
        type: "discover_places",
        date: "2026-10-26",
        timeWindow: { start: "12:00", end: "18:00" },
      },
    });
    const intent = (raw as { intent: Record<string, unknown> }).intent;
    expect(intent.categories).toBeUndefined();
    expect(intent.preferences).toBeUndefined();
    expect(intent).not.toHaveProperty("query");
    expect(JSON.stringify(intent)).not.toMatch(/latitude|longitude|placeId/);
  });

  it.each(constrainedRequests)(
    "preserves only requested discovery constraints for %s",
    async (message, constraints) => {
      const raw = await new MockPlanningAIProvider().interpretIntent({
        message,
        context,
      });
      expect(validateInterpretation(raw, context)).toMatchObject({
        status: "resolved",
        intent: { type: "discover_places", ...constraints },
      });
    },
  );

  it("preserves combined seaside and local-character concepts", async () => {
    const raw = await new MockPlanningAIProvider().interpretIntent({
      message: "下午想看海，也想去一些有銚子特色的地方。",
      context,
    });
    expect(validateInterpretation(raw, context)).toMatchObject({
      status: "resolved",
      intent: {
        type: "discover_places",
        categories: ["beach", "viewpoint", "attraction"],
        preferences: {
          themes: ["seaside", "scenic", "culture", "history"],
        },
      },
    });
  });

  it("safely upgrades an AI unsupported result for bounded implicit discovery", () => {
    const result = normalizeImplicitDiscoveryInterpretation(
      { status: "unsupported", reason: "outside supported intents" },
      { message: "Anything interesting nearby?", context },
    );
    expect(validateInterpretation(result, context)).toMatchObject({
      status: "resolved",
      intent: {
        type: "discover_places",
        date: context.selectedDate,
      },
    });
  });

  it("removes model-invented filters from generic discovery", () => {
    const result = normalizeImplicitDiscoveryInterpretation(
      {
        status: "resolved",
        intent: {
          type: "discover_places",
          date: context.selectedDate,
          timeWindow: { start: "12:00", end: "18:00" },
          preferences: { themes: [], indoorOutdoor: "outdoor" },
        },
      },
      { message: "下午可以去哪？", context },
    ) as { intent: Record<string, unknown> };
    expect(result.intent).toEqual({
      type: "discover_places",
      date: context.selectedDate,
      timeWindow: { start: "12:00", end: "18:00" },
    });
  });

  it("replaces model-authored discovery POIs with a grounded summary", () => {
    const result = normalizeImplicitDiscoveryInterpretation(
      {
        status: "resolved",
        intent: { type: "discover_places", date: context.selectedDate },
        summary: "Visit an invented lighthouse.",
      },
      { message: "下午可以去哪？", context },
    ) as { summary: string };
    expect(result.summary).toBe(
      `Discover provider-backed places for ${context.selectedDate}.`,
    );
    expect(result.summary).not.toContain("lighthouse");
  });

  it("does not reinterpret unsupported mutation requests as discovery", () => {
    const unsupported = {
      status: "unsupported",
      reason: "Direct mutations are unsupported",
    };
    expect(
      normalizeImplicitDiscoveryInterpretation(unsupported, {
        message: "Delete the afternoon itinerary",
        context,
      }),
    ).toBe(unsupported);
  });

  it.each([
    ["幫我找由布院附近的景點", "由布院"],
    ["湯布院附近有什麼咖啡廳？", "湯布院"],
    ["places near Yufuin", "Yufuin"],
    ["別府附近有什麼景點？", "別府"],
    ["around Beppu", "Beppu"],
  ])("extracts only explicit geographic text for %s", (message, expected) => {
    expect(extractGeographicReference(message)).toBe(expected);
    expect(implicitDiscoveryIntent(message, context)).toMatchObject({ geographicReference: { text: expected } });
  });
  it("does not include a relative date or time window in the geographic reference", () => {
    expect(extractGeographicReference("明天下午2點到5點由布院附近有什麼？")).toBe("由布院");
  });

  it("does not turn generic nearby wording into a named reference", () => {
    expect(extractGeographicReference("附近有什麼景點？")).toBeUndefined();
    expect(implicitDiscoveryIntent("附近有什麼景點？", context)).not.toHaveProperty("geographicReference");
  });

  it("removes model-authored discovery claims before provider search", () => {
    expect(normalizeImplicitDiscoveryInterpretation({ status: "resolved", intent: { type: "discover_places", date: context.selectedDate, geographicReference: { text: "由布院" } }, summary: "I found three places near Yufuin." }, { message: "由布院一帶的推薦", context })).toMatchObject({ summary: "Searching for provider-backed places near 由布院." });
  });
  it("classifies corridor discovery before interpreting detour modifiers", () => {
    const message = "大分到由布院路上找咖啡廳，最多繞路 15 分鐘",
      intent = implicitDiscoveryIntent(message, context);
    expect(extractCorridorReference(message)).toEqual({ originText: "大分", destinationText: "由布院" });
    expect(intent).toMatchObject({ type: "discover_places", categories: ["cafe"], corridorReference: { originText: "大分", destinationText: "由布院" }, maxDetourMinutes: 15 });
    const normalized = normalizeImplicitDiscoveryInterpretation({ status: "resolved", intent: { type: "repair_day", date: context.selectedDate } }, { message, context });
    expect(validateInterpretation(normalized, context)).toMatchObject({ status: "resolved", intent: { type: "discover_places", maxDetourMinutes: 15 } });
  });
  it.each([
    ["福岡到小倉途中有什麼咖啡廳？", "cafe"],
    ["推薦福岡到小倉沿途的景點", "attraction"],
    ["Find cafes between Fukuoka and Kokura", "cafe"],
  ] as const)("normalizes corridor wording before single-point geography for %s", (message, category) => {
    const intent = implicitDiscoveryIntent(message, context);
    expect(extractCorridorReference(message)).toEqual({
      originText: message.startsWith("Find") ? "Fukuoka" : "福岡",
      destinationText: message.startsWith("Find") ? "Kokura" : "小倉",
    });
    expect(intent).toMatchObject({
      type: "discover_places",
      categories: [category],
      corridorReference: {
        originText: message.startsWith("Find") ? "Fukuoka" : "福岡",
        destinationText: message.startsWith("Find") ? "Kokura" : "小倉",
      },
      geographicScope: "corridor",
    });
    expect(intent).not.toHaveProperty("geographicReference");
  });
  it("corrects both Mock-style corridor output and Ollama-style single-point output", () => {
    const message = "福岡到小倉途中有什麼咖啡廳？";
    const expected = {
      status: "resolved",
      intent: {
        type: "discover_places",
        corridorReference: { originText: "福岡", destinationText: "小倉" },
        geographicScope: "corridor",
        categories: ["cafe"],
      },
    };
    const mockShape = normalizeImplicitDiscoveryInterpretation(expected, { message, context });
    const ollamaShape = normalizeImplicitDiscoveryInterpretation({
      status: "resolved",
      intent: { type: "discover_places", date: context.selectedDate, categories: ["cafe"], geographicReference: { text: "福岡到小倉途中" }, geographicScope: "city_area" },
    }, { message, context });
    expect(mockShape).toMatchObject(expected);
    expect(ollamaShape).toMatchObject(expected);
  });
  it("keeps valid Ollama semantic interpretations instead of regex rewriting them", () => {
    const corridor = { status: "resolved", intent: { type: "discover_places", date: context.selectedDate, categories: ["cafe"], corridorReference: { originText: "福岡", destinationText: "小倉" }, geographicScope: "corridor" } };
    expect(normalizePlanningProviderInterpretation(corridor, { message: "推薦福岡到小倉途中適合休息的咖啡廳", context }, "ollama")).toBe(corridor);
    const access = { status: "resolved", intent: { type: "discover_places", date: context.selectedDate, categories: ["attraction"], geographicReference: { text: "長崎" }, geographicScope: "city_area", travelMode: "walking" } };
    expect(normalizePlanningProviderInterpretation(access, { message: "幫我找長崎不用開車就能到的景點", context }, "ollama")).toBe(access);
  });
  it("adds explicit daypart evidence to repair intent without changing the action", () => {
    const raw = { status: "resolved", intent: { type: "repair_day", date: context.selectedDate } };
    expect(normalizePlanningProviderInterpretation(raw, { message: "Arrange my afternoon itinerary", context }, "ollama")).toMatchObject({ intent: { type: "repair_day", timeWindow: { start: "12:00", end: "18:00" } } });
  });
  it("repairs a model rejection of bounded itinerary arrangement without inventing items", () => {
    expect(describeScheduleSemanticContradiction({ status: "unsupported", reason: "items were not named" }, { message: "Arrange my afternoon itinerary", context }, true, false)).toContain('timeWindow={"start":"12:00","end":"18:00"}');
    expect(describeScheduleSemanticContradiction({ status: "resolved", intent: { type: "repair_day" } }, { message: "Arrange my afternoon itinerary", context }, true, false)).toBeNull();
  });

  it("retains deterministic semantic normalization for Mock", () => {
    const raw = { status: "resolved", intent: { type: "discover_places", date: context.selectedDate, geographicReference: { text: "福岡到小倉途中" }, geographicScope: "city_area" } };
    expect(normalizePlanningProviderInterpretation(raw, { message: "福岡到小倉途中有什麼咖啡廳？", context }, "mock")).toMatchObject({ intent: { corridorReference: { originText: "福岡", destinationText: "小倉" }, geographicScope: "corridor" } });
  });
  it("keeps itinerary rearrangement as repair while nearby find language remains point discovery", async () => {
    const provider = new MockPlanningAIProvider();
    await expect(provider.interpretIntent({ message: "今天行程繞路太多，幫我重新安排", context })).resolves.toMatchObject({ status: "resolved", intent: { type: "repair_day" } });
    expect(implicitDiscoveryIntent("附近找咖啡廳，不要走太遠", context)).toMatchObject({ type: "discover_places", categories: ["cafe"] });
    expect(implicitDiscoveryIntent("附近找咖啡廳，不要走太遠", context)).not.toHaveProperty("corridorReference");
  });
});
