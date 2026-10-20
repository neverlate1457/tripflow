import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { AssistantSheetDragSession, PlanningAssistant, assistantSheetHeight, sheetStateAfterDrag } from "./PlanningAssistant";

describe("PlanningAssistant geographic clarification", () => {
  it("supports deterministic collapsed, half and full drag transitions", () => {
    expect(sheetStateAfterDrag("half", 80)).toBe("collapsed");
    expect(sheetStateAfterDrag("half", -80)).toBe("full");
    expect(sheetStateAfterDrag("full", 80)).toBe("half");
    expect(sheetStateAfterDrag("collapsed", -80)).toBe("half");
    expect(sheetStateAfterDrag("half", 10)).toBe("half");
  });
  it("updates full sheet geometry across portrait, landscape and portrait viewport changes", () => {
    expect(assistantSheetHeight("full", 844)).toContain("844px");
    expect(assistantSheetHeight("half", 390)).toBe("min(52dvh, 520px)");
    expect(assistantSheetHeight("full", 390)).toContain("390px");
    expect(assistantSheetHeight("full", 844)).toContain("844px");
  });
  it("cancels an active drag on rotation or pointercancel", () => {
    const session = new AssistantSheetDragSession();
    session.begin(7, 300);
    expect(session.cancel()).toBe(7);
    expect(session.activePointerId).toBeNull();
    expect(session.finish(7, 200)).toBeNull();
  });
  it("resets on lost pointer capture and ignores stale pointer IDs", () => {
    const session = new AssistantSheetDragSession();
    session.begin(4, 300);
    expect(session.cancel(5)).toBeNull();
    expect(session.activePointerId).toBe(4);
    expect(session.finish(5, 100)).toBeNull();
    expect(session.cancel(4)).toBe(4);
    session.begin(6, 250);
    expect(session.finish(6, 170)).toBe(-80);
    expect(session.activePointerId).toBeNull();
  });
  it("keeps the assistant bounded to its sheet geometry without a fullscreen gesture-blocking backdrop", () => {
    const html = renderToStaticMarkup(<PlanningAssistant status="idle" errorMessage={null} interpretation={null} explanation={null} suggestions={[]} relevanceConfidence={null} geographicClarification={null} geographicClarificationSubmitting={false} geographicClarificationError={null} onSubmit={vi.fn()} onChoose={vi.fn()} onChooseMany={vi.fn()} onSelectSuggestion={vi.fn()} onAddSuggestion={vi.fn()} onClearSuggestions={vi.fn()} onConfirmGeographicCandidate={vi.fn()} onCancelGeographicClarification={vi.fn()} onEditGeographicSearch={vi.fn()} onCancel={vi.fn()} onClose={vi.fn()}/>);
    expect(html).toContain("fixed inset-x-0");
    expect(html).toContain("h-[var(--assistant-mobile-height)]");
    expect(html).not.toContain("fixed inset-0");
  });
  it("renders an accessible, unselected provider-backed choice UI", () => {
    const html = renderToStaticMarkup(
      <PlanningAssistant
        status="clarification"
        errorMessage={null}
        interpretation={{ status: "resolved", intent: { type: "discover_places", date: "2026-10-30", categories: ["cafe"] } }}
        explanation={null}
        suggestions={[]}
        relevanceConfidence={null}
        geographicClarification={{
          status: "clarification_required",
          reason: "ambiguous_geography",
          originalRequest: "博多站附近找咖啡廳",
          geographicReference: "博多站",
          geographicScope: "nearby_point",
          clarificationToken: "opaque",
          expiresAt: "2026-10-30T00:05:00.000Z",
          candidates: [
            { candidateId: "fukuoka", provider: "geoapify", providerPlaceId: "provider-1", name: "Hakata Station", formattedAddress: "Fukuoka, Japan", latitude: 33.59, longitude: 130.42, featureType: "station", attribution: "Powered by Geoapify" },
            { candidateId: "amagasaki", provider: "geoapify", providerPlaceId: "provider-2", name: "博多駅", formattedAddress: "Amagasaki, Japan", latitude: 34.73, longitude: 135.4, featureType: "station", attribution: "Powered by Geoapify" },
          ],
        }}
        geographicClarificationSubmitting={false}
        geographicClarificationError={null}
        userPrompt={{ text: "找宮崎市景點", requestId: "request-visible" }}
        onSubmit={vi.fn()}
        onChoose={vi.fn()}
        onChooseMany={vi.fn()}
        onSelectSuggestion={vi.fn()}
        onAddSuggestion={vi.fn()}
        onClearSuggestions={vi.fn()}
        onConfirmGeographicCandidate={vi.fn()}
        onCancelGeographicClarification={vi.fn()}
        onEditGeographicSearch={vi.fn()}
        onCancel={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(html).toContain("Which location did you mean?");
    expect(html).toContain('type="radio"');
    expect(html).toContain("Hakata Station");
    expect(html).toContain("Amagasaki, Japan");
    expect(html).toContain("Powered by Geoapify");
    expect(html).toContain("Search near this location");
    expect(html).toContain("disabled");
    expect(html).not.toContain('checked=""');
  });
  it("renders the safe actionable API error instead of masking it", () => {
    const html = renderToStaticMarkup(
      <PlanningAssistant
        status="error"
        errorMessage="Local planning model timed out."
        interpretation={null}
        explanation={null}
        suggestions={[]}
        relevanceConfidence={null}
        geographicClarification={null}
        geographicClarificationSubmitting={false}
        geographicClarificationError={null}
        userPrompt={{ text: "找宮崎市景點", requestId: "request-visible" }}
        onSubmit={vi.fn()}
        onChoose={vi.fn()}
        onChooseMany={vi.fn()}
        onSelectSuggestion={vi.fn()}
        onAddSuggestion={vi.fn()}
        onClearSuggestions={vi.fn()}
        onConfirmGeographicCandidate={vi.fn()}
        onCancelGeographicClarification={vi.fn()}
        onEditGeographicSearch={vi.fn()}
        onCancel={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(html).toContain("Local planning model timed out.");
    expect(html).toContain("找宮崎市景點");
    expect(html).toContain("request-visible");
    expect(html).toContain("Collapse Ask TripFlow");
    expect(html).toContain("Half-expand Ask TripFlow");
    expect(html).toContain("Fully expand Ask TripFlow");
    expect(html).not.toContain("The request could not be completed");
  });

  it("renders a map action for a provider-backed suggestion without adding it", () => {
    const html = renderToStaticMarkup(<PlanningAssistant status="resolved" errorMessage={null} interpretation={{status:"resolved",intent:{type:"discover_places",date:"2026-10-30",categories:["attraction"]}}} explanation={null} suggestions={[{id:"geo:miyazaki",place:{provider:"geoapify",providerPlaceId:"miyazaki",name:"Miyazaki Park",location:{latitude:31.9,longitude:131.4},categories:["tourism.attraction"]},score:10,reasons:[],context:{alreadyInTrip:false}} as never]} relevanceConfidence="full" geographicClarification={null} geographicClarificationSubmitting={false} geographicClarificationError={null} userPrompt={{text:"推薦宮崎市景點",requestId:"request-success"}} onSubmit={vi.fn()} onChoose={vi.fn()} onChooseMany={vi.fn()} onSelectSuggestion={vi.fn()} onViewSuggestion={vi.fn()} onAddSuggestion={vi.fn()} onClearSuggestions={vi.fn()} onConfirmGeographicCandidate={vi.fn()} onCancelGeographicClarification={vi.fn()} onEditGeographicSearch={vi.fn()} onCancel={vi.fn()} onClose={vi.fn()}/>);
    expect(html).toContain("View on map");
    expect(html).toContain("Miyazaki Park");
    expect(html).toContain("推薦宮崎市景點");
    expect(html).toContain("request-success");
  });
  it("never labels a deterministic runtime error as Ollama", () => {
    const html = renderToStaticMarkup(
      <PlanningAssistant
        status="error" errorMessage="TripFlow could not safely validate this request."
        interpretation={null} explanation={null} suggestions={[]} relevanceConfidence={null}
        geographicClarification={null} geographicClarificationSubmitting={false} geographicClarificationError={null}
        errorProvenance={{ producerType: "tripflow_runtime", producerStage: "error_handling", provider: "tripflow", model: null, requestId: "request-2", traceEventId: "request-2:4", transformedBy: [], reason: "Runtime schema validation failed." }}
        onSubmit={vi.fn()} onChoose={vi.fn()} onChooseMany={vi.fn()} onSelectSuggestion={vi.fn()} onAddSuggestion={vi.fn()} onClearSuggestions={vi.fn()} onConfirmGeographicCandidate={vi.fn()} onCancelGeographicClarification={vi.fn()} onEditGeographicSearch={vi.fn()} onCancel={vi.fn()} onClose={vi.fn()}
      />,
    );
    expect(html).toContain("TripFlow · Error Handling");
    expect(html).not.toContain("Ollama");
  });
  it("labels repaired model text with the structured repair stage", () => {
    const html = renderToStaticMarkup(
      <PlanningAssistant
        status="resolved" errorMessage={null}
        interpretation={{ status: "unsupported", reason: "The user request explicitly names two distinct geographic endpoints." }}
        interpretationProvenance={{ producerType: "llm", producerStage: "structured_output_repair", provider: "ollama", model: "qwen3.5:9b", requestId: "request-3", traceEventId: "request-3:2", transformedBy: ["TripFlow runtime validation"], reason: "Initial output required repair." }}
        explanation={null} suggestions={[]} relevanceConfidence={null} geographicClarification={null} geographicClarificationSubmitting={false} geographicClarificationError={null}
        onSubmit={vi.fn()} onChoose={vi.fn()} onChooseMany={vi.fn()} onSelectSuggestion={vi.fn()} onAddSuggestion={vi.fn()} onClearSuggestions={vi.fn()} onConfirmGeographicCandidate={vi.fn()} onCancelGeographicClarification={vi.fn()} onEditGeographicSearch={vi.fn()} onCancel={vi.fn()} onClose={vi.fn()}
      />,
    );
    expect(html).toContain("Ollama · qwen3.5:9b · Structured Output Repair");
    expect(html).toContain("The user request explicitly names two distinct geographic endpoints.");
  });
  it("identifies which corridor endpoint requires provider-backed clarification", () => {
    const html = renderToStaticMarkup(
      <PlanningAssistant
        status="clarification" errorMessage={null}
        interpretation={{ status: "resolved", intent: { type: "discover_places", date: "2026-10-30", categories: ["cafe"], geographicScope: "corridor", corridorReference: { originText: "Fukuoka", destinationText: "Kokura" } } }}
        explanation={null} suggestions={[]} relevanceConfidence={null}
        geographicClarification={{ status: "clarification_required", reason: "ambiguous_geography", originalRequest: "Find cafes between Fukuoka and Kokura", geographicReference: "Kokura", geographicScope: "corridor", corridorEndpoint: "destination", clarificationToken: "opaque", expiresAt: "2026-10-30T00:05:00.000Z", candidates: [{ candidateId: "one", provider: "geoapify", providerPlaceId: "p1", name: "Kokura-Kita Ward", formattedAddress: "Kitakyushu, Fukuoka, Japan", latitude: 33.88, longitude: 130.88, featureType: "city_area", attribution: "Powered by Geoapify" }, { candidateId: "two", provider: "geoapify", providerPlaceId: "p2", name: "Kokura", formattedAddress: "Mino, Gifu, Japan", latitude: 35.5, longitude: 136.9, featureType: "place", attribution: "Powered by Geoapify" }] }}
        geographicClarificationSubmitting={false} geographicClarificationError={null}
        onSubmit={vi.fn()} onChoose={vi.fn()} onChooseMany={vi.fn()} onSelectSuggestion={vi.fn()} onAddSuggestion={vi.fn()} onClearSuggestions={vi.fn()} onConfirmGeographicCandidate={vi.fn()} onCancelGeographicClarification={vi.fn()} onEditGeographicSearch={vi.fn()} onCancel={vi.fn()} onClose={vi.fn()}
      />,
    );
    expect(html).toContain("corridor destination");
    expect(html).toContain("Kitakyushu, Fukuoka, Japan");
  });
  it("renders an accessible compact execution provenance timeline", () => {
    const html = renderToStaticMarkup(<PlanningAssistant status="resolved" errorMessage={null} interpretation={{ status: "resolved", intent: { type: "discover_places", date: "2026-10-30", categories: ["attraction"], geographicScope: "city_area", geographicReference: { text: "宮崎市" } } }} explanation={null} suggestions={[]} relevanceConfidence={null} geographicClarification={null} geographicClarificationSubmitting={false} geographicClarificationError={null} onSubmit={vi.fn()} onChoose={vi.fn()} onChooseMany={vi.fn()} onSelectSuggestion={vi.fn()} onAddSuggestion={vi.fn()} onClearSuggestions={vi.fn()} onConfirmGeographicCandidate={vi.fn()} onCancelGeographicClarification={vi.fn()} onEditGeographicSearch={vi.fn()} onCancel={vi.fn()} onClose={vi.fn()} debugEnabled debugTrace={{ requestId: "request-1", createdAt: "2026-10-30T00:00:00Z", stages: {}, timeline: [{ eventId: "request-1:1", stage: "intent_interpretation", sourceType: "llm", provider: "ollama", model: "qwen3.5:9b", status: "success", durationMs: 1200, inputSummary: null, outputSummary: { intentType: "discover_places" }, errorCode: null, reason: "Primary semantic interpretation", recordedAt: "2026-10-30T00:00:01Z" }] }} />);
    expect(html).toContain("Execution Trace");
    expect(html).toContain("request-1");
    expect(html).toContain("intent interpretation · success");
    expect(html).toContain("ollama / qwen3.5:9b");
  });
  it("does not present an internal repair explanation as a travel recommendation when validation rejects it", () => {
    const html = renderToStaticMarkup(<PlanningAssistant status="error" errorMessage="The assistant returned an invalid planning interpretation." interpretation={null} explanation={null} suggestions={[]} relevanceConfidence={null} geographicClarification={null} geographicClarificationSubmitting={false} geographicClarificationError={null} errorProvenance={{ producerType: "tripflow_runtime", producerStage: "semantic_runtime_validation", provider: "tripflow", model: null, requestId: "corridor", traceEventId: "corridor:1", transformedBy: [], reason: "TripFlow rejected the repaired interpretation." }} onSubmit={vi.fn()} onChoose={vi.fn()} onChooseMany={vi.fn()} onSelectSuggestion={vi.fn()} onAddSuggestion={vi.fn()} onClearSuggestions={vi.fn()} onConfirmGeographicCandidate={vi.fn()} onCancelGeographicClarification={vi.fn()} onEditGeographicSearch={vi.fn()} onCancel={vi.fn()} onClose={vi.fn()} />);
    expect(html).toContain("The assistant returned an invalid planning interpretation.");
    expect(html).not.toContain("The request names two endpoints and cannot satisfy the corridor schema.");
  });
});
