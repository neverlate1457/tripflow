import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Bot, ChevronDown, LoaderCircle, MapPin, Maximize2, PanelTopOpen, Send, X } from "lucide-react";
import { validClarificationSelectionCount, type IntentInterpretation } from "@/domain/ai-planning";
import {
  formatSuggestionReason,
  formatDiscoveryCategory,
  type PlaceSuggestion,
} from "@/domain/discovery";
import type { GeographicClarificationRequired } from "@/domain/geographic-clarification";
import type { TravelRerankMetadata } from "@/domain/travel-relevance";
import type { PlanningAIDebugTrace } from "@/services/planning-ai-debug";
import { formatAssistantProvenance, type AssistantMessageProvenance } from "@/domain/assistant-provenance";
import { PlanningAITracePayload } from "./PlanningAITracePayload";

function SourceBadge({ provenance, message, onInspect }: { provenance: AssistantMessageProvenance | null; message: string; onInspect: (provenance: AssistantMessageProvenance, message: string) => void }) {
  const safe = provenance ?? { producerType: "unknown", producerStage: "unknown", provider: null, model: null, requestId: null, traceEventId: null, transformedBy: [], reason: "The producing layer could not be verified." } satisfies AssistantMessageProvenance;
  return <button type="button" onClick={() => onInspect(safe, message)} className="mb-1 inline-flex min-h-11 max-w-full items-center rounded-full border border-slate-200 bg-white px-2.5 py-1 text-left text-[9px] font-semibold text-slate-600 shadow-sm" aria-label={`Message source: ${formatAssistantProvenance(safe)}`}>{formatAssistantProvenance(safe)}</button>;
}

export function PlanningAssistant({
  status,
  errorMessage,
  interpretation,
  explanation,
  suggestions,
  relevanceConfidence,
  reranking,
  geographicClarification,
  geographicClarificationSubmitting,
  geographicClarificationError,
  onSubmit,
  onChoose,
  onChooseMany,
  onSelectSuggestion,
  onViewSuggestion,
  onAddSuggestion,
  onClearSuggestions,
  onConfirmGeographicCandidate,
  onCancelGeographicClarification,
  onEditGeographicSearch,
  onCancel,
  onClose,
  debugEnabled,
  debugDetailed,
  onDebug,
  debugTrace,
  debugLoading,
  onRefreshTrace,
  interpretationProvenance,
  discoveryProvenance,
  explanationProvenance,
  errorProvenance,
  userPrompt,
}: {
  status: "idle" | "understanding" | "resolved" | "clarification" | "error";
  errorMessage: string | null;
  interpretation: IntentInterpretation | null;
  explanation: string | null;
  suggestions: PlaceSuggestion[];
  relevanceConfidence: "full" | "limited" | null;
  reranking?: TravelRerankMetadata | null;
  geographicClarification: GeographicClarificationRequired | null;
  geographicClarificationSubmitting: boolean;
  geographicClarificationError: string | null;
  onSubmit: (message: string) => void;
  onChoose: (candidateId: string) => void;
  onChooseMany: (candidateIds: string[], scheduling: NonNullable<Extract<IntentInterpretation, {status:"clarification_required"}>["candidateScheduling"]>) => void;
  onSelectSuggestion: (id: string) => void;
  onViewSuggestion?: (id: string) => void;
  onAddSuggestion: (suggestion: PlaceSuggestion) => void;
  onClearSuggestions: () => void;
  onConfirmGeographicCandidate: (candidateId: string) => void;
  onCancelGeographicClarification: () => void;
  onEditGeographicSearch: () => void;
  onCancel: () => void;
  onClose: () => void;
  debugEnabled?: boolean;
  debugDetailed?: boolean;
  onDebug?: () => void;
  debugTrace?: PlanningAIDebugTrace | null;
  debugLoading?: boolean;
  onRefreshTrace?: () => void;
  interpretationProvenance?: AssistantMessageProvenance | null;
  discoveryProvenance?: AssistantMessageProvenance | null;
  explanationProvenance?: AssistantMessageProvenance | null;
  errorProvenance?: AssistantMessageProvenance | null;
  userPrompt?: { text: string; requestId: string | null } | null;
}) {
  const [value, setValue] = useState(""),
    [selectedCandidates,setSelectedCandidates]=useState<string[]>([]),
    [selectedGeographicCandidate,setSelectedGeographicCandidate]=useState<string | null>(null),
    [inspectedMessage,setInspectedMessage]=useState<{ provenance: AssistantMessageProvenance; message: string } | null>(null),
    [traceOpen,setTraceOpen]=useState(false),
    [sheetState,setSheetState]=useState<AssistantSheetState>("half"),
    [viewportHeight,setViewportHeight]=useState<number | null>(null),
    dragSession=useRef(new AssistantSheetDragSession()),
    dragElement=useRef<HTMLElement | null>(null),
    input = useRef<HTMLInputElement>(null);
  const cancelSheetDrag = (reason: string, pointerId?: number) => {
    const released = dragSession.current.cancel(pointerId);
    if (released == null) return;
    const element = dragElement.current;
    if (element?.hasPointerCapture(released)) {
      try { element.releasePointerCapture(released); } catch { /* Safari may already have cancelled capture. */ }
    }
    dragElement.current = null;
    mobileGestureDiagnostic("sheet_drag_cancelled", { reason, pointerId: released });
  };
  const inspect = (provenance: AssistantMessageProvenance, message: string) => { setInspectedMessage({ provenance, message }); setTraceOpen(true); onRefreshTrace?.(); };
  const copyDiagnostic = async () => { if (!inspectedMessage) return; const { provenance, message } = inspectedMessage; await navigator.clipboard.writeText(JSON.stringify({ visibleMessage: message, exactProducer: provenance.producerType, stage: provenance.producerStage, provider: provenance.provider, model: provenance.model, requestId: provenance.requestId, linkedTraceEvent: provenance.traceEventId, transformedBy: provenance.transformedBy, failureOrFallbackReason: provenance.reason ?? null }, null, 2)); };
  useEffect(()=>setSelectedCandidates([]),[interpretation]);
  useEffect(()=>setSelectedGeographicCandidate(null),[geographicClarification?.clarificationToken]);
  useEffect(() => {
    if (!traceOpen || !inspectedMessage?.provenance.traceEventId || !debugTrace) return;
    document.getElementById(`trace-${inspectedMessage.provenance.traceEventId}`)?.scrollIntoView({ block: "nearest" });
  }, [traceOpen, inspectedMessage?.provenance.traceEventId, debugTrace]);
  useEffect(() => {
    const viewport = window.visualViewport;
    const update = () => {
      cancelSheetDrag("viewport_changed");
      setViewportHeight(viewport?.height ?? window.innerHeight);
      mobileGestureDiagnostic("viewport_changed", viewportSnapshot());
    };
    update();
    viewport?.addEventListener("resize", update);
    viewport?.addEventListener("scroll", update);
    window.addEventListener("resize", update);
    window.addEventListener("orientationchange", update);
    return () => {
      cancelSheetDrag("unmount");
      viewport?.removeEventListener("resize", update);
      viewport?.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
      window.removeEventListener("orientationchange", update);
    };
  }, []);
  const bodyVisible = sheetState !== "collapsed";
  const mobileHeight = assistantSheetHeight(sheetState, viewportHeight ?? 800);
  return (
    <aside
      className="fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-[65] flex h-[var(--assistant-mobile-height)] w-full flex-col rounded-t-2xl border border-slate-200 bg-white shadow-2xl transition-[height] duration-200 xl:inset-x-auto xl:bottom-4 xl:right-4 xl:h-auto xl:max-h-[calc(100dvh-2rem)] xl:max-w-[360px] xl:rounded-2xl"
      style={{ "--assistant-mobile-height": mobileHeight } as CSSProperties}
      aria-label="Ask TripFlow"
      data-sheet-state={sheetState}
    >
      <div
        className="touch-none border-b border-slate-100 px-3 pb-2 pt-1 xl:touch-auto xl:pt-3"
        onPointerDown={(event) => {
          if (!event.isPrimary) return;
          cancelSheetDrag("new_pointer");
          dragSession.current.begin(event.pointerId, event.clientY);
          dragElement.current = event.currentTarget;
          event.currentTarget.setPointerCapture(event.pointerId);
          mobileGestureDiagnostic("pointerdown", { pointerId: event.pointerId, clientY: event.clientY, hitTarget: document.elementFromPoint(event.clientX, event.clientY)?.getAttribute("aria-label") ?? document.elementFromPoint(event.clientX, event.clientY)?.tagName ?? null, sheet: event.currentTarget.parentElement?.getBoundingClientRect().toJSON?.() ?? null });
        }}
        onPointerMove={(event) => mobileGestureDiagnostic("pointermove", { pointerId: event.pointerId, clientY: event.clientY, activePointerId: dragSession.current.activePointerId })}
        onPointerUp={(event) => {
          const delta = dragSession.current.finish(event.pointerId, event.clientY);
          if (delta != null) setSheetState((current) => sheetStateAfterDrag(current, delta));
          if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
          dragElement.current = null;
          mobileGestureDiagnostic("pointerup", { pointerId: event.pointerId, clientY: event.clientY });
        }}
        onPointerCancel={(event) => cancelSheetDrag("pointercancel", event.pointerId)}
        onLostPointerCapture={(event) => { dragSession.current.cancel(event.pointerId); dragElement.current = null; mobileGestureDiagnostic("lostpointercapture", { pointerId: event.pointerId }); }}
      >
        <div className="mx-auto mb-1 h-1 w-10 rounded-full bg-slate-300 xl:hidden" aria-hidden="true" />
        <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Bot size={17} className="text-sage-600" />
          <h2 className="text-sm font-semibold">Ask TripFlow</h2>
        </div>
        <div className="flex items-center gap-1">
          <button type="button" onClick={() => setSheetState("collapsed")} className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg xl:hidden" aria-label="Collapse Ask TripFlow" aria-pressed={sheetState === "collapsed"}><ChevronDown size={17}/></button>
          <button type="button" onClick={() => setSheetState("half")} className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg xl:hidden" aria-label="Half-expand Ask TripFlow" aria-pressed={sheetState === "half"}><PanelTopOpen size={17}/></button>
          <button type="button" onClick={() => setSheetState("full")} className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg xl:hidden" aria-label="Fully expand Ask TripFlow" aria-pressed={sheetState === "full"}><Maximize2 size={16}/></button>
          {debugDetailed && <button onClick={onDebug} className="min-h-11 rounded border px-2 py-1 font-mono text-[10px]">Debug</button>}<button className="inline-flex min-h-11 min-w-11 items-center justify-center" onClick={onClose} aria-label="Close assistant"><X size={16} /></button>
        </div>
        </div>
      </div>
      {bodyVisible && <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4">
        <p className="text-xs text-slate-500">
          I interpret requests. Places come only from the configured provider;
          nothing is added until you choose Add to trip.
        </p>
        {userPrompt && <article className="mt-3 ml-auto max-w-[92%] rounded-xl bg-slate-800 px-3 py-2 text-white" aria-label="User message">
          <p className="text-[9px] font-bold uppercase tracking-wide text-slate-300">User</p>
          <p className="mt-1 whitespace-pre-wrap break-words text-xs">{userPrompt.text}</p>
          <p className="mt-1 break-all font-mono text-[8px] text-slate-400">{userPrompt.requestId ?? "Request pending"}</p>
        </article>}
        {status === "understanding" && (
          <div className="mt-3 flex items-center gap-2 text-xs font-medium text-sage-700">
            <LoaderCircle size={14} className="animate-spin" />
            Understanding request…{" "}
            <button onClick={onCancel} className="ml-auto underline">
              Cancel
            </button>
          </div>
        )}
        {interpretation?.status === "resolved" && !geographicClarification && (
          <div className="mt-3"><SourceBadge provenance={interpretationProvenance ?? null} message={interpretation.summary ?? interpretation.intent.type.replaceAll("_", " ")} onInspect={inspect}/><p className="rounded-lg bg-sage-50 p-3 text-xs text-sage-800">
            I understood this as:{" "}
            {interpretation.summary ??
              interpretation.intent.type.replaceAll("_", " ")}
            .
          </p></div>
        )}
        {interpretation?.status === "unsupported" && (
          <div className="mt-3"><SourceBadge provenance={interpretationProvenance ?? null} message={interpretation.reason} onInspect={inspect}/><p className="rounded-lg bg-amber-50 p-3 text-xs text-amber-800">
            {interpretation.reason}
          </p></div>
        )}
        {interpretation?.status === "clarification_required" && (
          <div className="mt-3">
            <SourceBadge provenance={interpretationProvenance ?? null} message={interpretation.question} onInspect={inspect}/>
            <p className="text-xs font-semibold">{interpretation.question}</p>
            <div className="mt-2 flex flex-wrap gap-1">
              {interpretation.options?.map((option) => {
                const selected=Boolean(option.candidateId&&selectedCandidates.includes(option.candidateId));
                return (
                <button
                  key={option.id}
                  type="button"
                  role={interpretation.selectionMode==="multiple"?"checkbox":undefined}
                  aria-checked={interpretation.selectionMode==="multiple"?selected:undefined}
                  onClick={() =>
                    option.candidateId && (interpretation.selectionMode==="multiple"
                      ? setSelectedCandidates((current)=>selected?current.filter((id)=>id!==option.candidateId):current.length<(interpretation.maxSelections??5)?[...current,option.candidateId!]:current)
                      : onChoose(option.candidateId))
                  }
                  className={`rounded-lg border px-2 py-1 text-xs ${selected?"border-sage-600 bg-sage-50 text-sage-800":"border-sage-200 text-sage-700"}`}
                >
                  {selected?"✓ ":""}{option.label}
                </button>
              )})}
            </div>
            {interpretation.selectionMode==="multiple"&&interpretation.candidateScheduling&&<div className="mt-3 flex items-center justify-between gap-2"><span className="text-[10px] text-slate-500">{selectedCandidates.length} selected · choose {interpretation.minSelections}{interpretation.minSelections!==interpretation.maxSelections?`–${interpretation.maxSelections}`:""}</span><button type="button" aria-label={`Schedule ${selectedCandidates.length} places`} disabled={!validClarificationSelectionCount(selectedCandidates.length,interpretation.minSelections??2,interpretation.maxSelections??5)} onClick={()=>onChooseMany(selectedCandidates,interpretation.candidateScheduling!)} className="rounded-lg bg-sage-700 px-3 py-1.5 text-xs font-semibold text-white disabled:bg-slate-300">Schedule {selectedCandidates.length} places</button></div>}
          </div>
        )}
        {geographicClarification && (
          <section className="mt-3 rounded-xl border border-sage-200 bg-sage-50/40 p-3" aria-labelledby="geographic-clarification-title">
            <SourceBadge provenance={discoveryProvenance ?? null} message={`Which location did you mean? ${geographicClarification.geographicReference}`} onInspect={inspect}/>
            <h3 id="geographic-clarification-title" className="text-xs font-semibold text-slate-900">Which location did you mean?</h3>
            <p className="mt-1 text-[11px] leading-4 text-slate-600">
              TripFlow found multiple provider-backed matches for “{geographicClarification.geographicReference}”{geographicClarification.corridorEndpoint ? `, the corridor ${geographicClarification.corridorEndpoint}` : ""}. Select one before the search continues.
            </p>
            <fieldset className="mt-3 space-y-2" disabled={geographicClarificationSubmitting}>
              <legend className="sr-only">Location candidates</legend>
              {geographicClarification.candidates.map((candidate) => {
                const selected = selectedGeographicCandidate === candidate.candidateId;
                return (
                  <label key={candidate.candidateId} className={`flex cursor-pointer gap-2 rounded-lg border bg-white p-2.5 ${selected ? "border-sage-600 ring-1 ring-sage-500" : "border-slate-200"}`}>
                    <input
                      type="radio"
                      name="geographic-clarification-candidate"
                      value={candidate.candidateId}
                      checked={selected}
                      onChange={() => setSelectedGeographicCandidate(candidate.candidateId)}
                      className="mt-0.5 accent-sage-600"
                    />
                    <span className="min-w-0">
                      <span className="block text-xs font-semibold text-slate-900">{candidate.name}</span>
                      {candidate.formattedAddress && <span className="mt-0.5 block break-words text-[10px] text-slate-600">{candidate.formattedAddress}</span>}
                      <span className="mt-1 block text-[9px] uppercase tracking-wide text-slate-400">{candidate.featureType.replace("_", " ")} · {candidate.attribution}</span>
                    </span>
                  </label>
                );
              })}
            </fieldset>
            {geographicClarificationError && <div className="mt-2"><SourceBadge provenance={{ producerType: "tripflow_runtime", producerStage: "geographic_clarification_error", provider: "tripflow", model: null, requestId: discoveryProvenance?.requestId ?? null, traceEventId: null, transformedBy: [], reason: "The clarification selection could not be safely verified." }} message={geographicClarificationError} onInspect={inspect}/><p role="alert" className="rounded bg-rose-50 p-2 text-[10px] text-rose-700">{geographicClarificationError}</p></div>}
            <button
              type="button"
              disabled={!selectedGeographicCandidate || geographicClarificationSubmitting}
              onClick={() => selectedGeographicCandidate && onConfirmGeographicCandidate(selectedGeographicCandidate)}
              className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg bg-sage-700 px-3 py-2 text-xs font-semibold text-white disabled:bg-slate-300"
            >
              {geographicClarificationSubmitting && <LoaderCircle size={13} className="animate-spin" />}
              Search near this location
            </button>
            <div className="mt-2 flex justify-end gap-3 text-[10px]">
              <button type="button" onClick={onCancelGeographicClarification} disabled={geographicClarificationSubmitting} className="text-slate-500 underline">Cancel</button>
              <button type="button" onClick={() => { setValue(geographicClarification.originalRequest); onEditGeographicSearch(); queueMicrotask(() => input.current?.focus()); }} disabled={geographicClarificationSubmitting} className="font-medium text-sage-700 underline">Edit search</button>
            </div>
          </section>
        )}
        {suggestions.length > 0 && (
          <div className="mt-3 space-y-2">
            <SourceBadge provenance={discoveryProvenance ?? null} message={`Provider-backed suggestions: ${suggestions.length}`} onInspect={inspect}/>
            {reranking?.used && (
              <div><SourceBadge provenance={{ producerType: "llm", producerStage: "travel_relevance_reranking", provider: reranking.provider ?? null, model: reranking.model ?? null, requestId: discoveryProvenance?.requestId ?? null, traceEventId: debugTrace?.timeline.find((event) => event.stage === "travel_relevance_reranking" && event.status === "success")?.eventId ?? null, transformedBy: ["TripFlow rerank validation"] }} message={`AI-ranked from provider-backed places · ${reranking.model}`} onInspect={inspect}/><p className="rounded-lg bg-sky-50 px-2 py-1.5 text-[10px] text-sky-700">
                AI-ranked from provider-backed places · {reranking.model}
              </p></div>
            )}
            {relevanceConfidence === "limited" && (
              <div><SourceBadge provenance={{ producerType: "tripflow_deterministic", producerStage: "discovery_renderer", provider: "tripflow", model: null, requestId: discoveryProvenance?.requestId ?? null, traceEventId: debugTrace?.timeline.find((event) => event.stage === "deterministic_discovery_ranking")?.eventId ?? null, transformedBy: ["Provider-backed relevance evidence"], reason: "TripFlow rendered the limited-confidence state from deterministic ranking evidence." }} message="Only a few places had strong provider-backed relevance, so TripFlow did not pad these results." onInspect={inspect}/><p className="rounded-lg bg-amber-50 px-2 py-1.5 text-[10px] text-amber-700">
                Only a few places had strong provider-backed relevance, so
                TripFlow did not pad these results.
              </p></div>
            )}
            <div className="flex items-center justify-between">
              <p className="text-[10px] font-bold uppercase text-slate-400">
                Provider-backed suggestions
              </p>
              <button
                className="text-[10px] underline"
                onClick={onClearSuggestions}
              >
                Clear
              </button>
            </div>
            {suggestions.map((s) => (
              <article
                key={s.id}
                className="rounded-xl border border-slate-200 p-3"
              >
                <button
                  className="w-full text-left"
                  onClick={() => onSelectSuggestion(s.id)}
                >
                  <p className="text-xs font-semibold">{s.place.name}</p>
                  <p className="mt-1 text-[10px] text-slate-500">
                    {formatDiscoveryCategory(s.place)} · {formatSuggestionReason(s)}
                  </p>
                </button>
                <button
                  disabled={s.context.alreadyInTrip}
                  onClick={() => onAddSuggestion(s)}
                  className="mt-2 rounded-lg bg-sage-600 px-2 py-1 text-[10px] font-semibold text-white disabled:bg-slate-300"
                >
                  {s.context.alreadyInTrip ? "Already in trip" : "Add to trip"}
                </button>
                {onViewSuggestion && <button
                  type="button"
                  onClick={() => { onSelectSuggestion(s.id); onViewSuggestion(s.id); setSheetState("collapsed"); }}
                  className="ml-2 inline-flex min-h-11 items-center gap-1 rounded-lg border border-sage-300 px-2 text-[10px] font-semibold text-sage-700"
                ><MapPin size={13}/> View on map</button>}
              </article>
            ))}
          </div>
        )}
        {interpretation?.status === "resolved" &&
          interpretation.intent.type === "discover_places" &&
          !suggestions.length &&
          !explanation &&
          status === "resolved" && (
            <div className="mt-3"><SourceBadge provenance={{ producerType: "frontend", producerStage: "discovery_renderer", provider: "react", model: null, requestId: discoveryProvenance?.requestId ?? interpretationProvenance?.requestId ?? null, traceEventId: debugTrace?.timeline.find((event) => event.stage === "places_discovery")?.eventId ?? null, transformedBy: ["TripFlow validated discovery result"], reason: "The frontend rendered the safe empty state because no grounded suggestions were returned." }} message="No grounded places were returned. TripFlow will not invent alternatives." onInspect={inspect}/><p className="text-xs text-slate-500">
              No grounded places were returned. TripFlow will not invent
              alternatives.
            </p></div>
          )}
        {explanation && (
          <div className="mt-3"><SourceBadge provenance={explanationProvenance ?? null} message={explanation} onInspect={inspect}/><p className="rounded-lg bg-slate-50 p-3 text-xs leading-5 text-slate-700">
            {explanation}
          </p></div>
        )}
        {status === "error" && (
          <div className="mt-3"><SourceBadge provenance={errorProvenance ?? null} message={errorMessage ?? "The request could not be completed. Nothing was changed; try again."} onInspect={inspect}/><p role="alert" className="rounded-lg bg-rose-50 p-3 text-xs text-rose-700">
            {errorMessage ?? "The request could not be completed. Nothing was changed; try again."}
          </p></div>
        )}
        {inspectedMessage && <section className="mt-3 rounded-lg border border-slate-300 bg-white p-3 text-[10px]" aria-label="Message source diagnostic"><div className="flex items-start justify-between gap-2"><div><p className="font-semibold">{formatAssistantProvenance(inspectedMessage.provenance)}</p><p className="mt-1 break-all font-mono text-slate-500">{inspectedMessage.provenance.requestId ?? "No request ID"}{inspectedMessage.provenance.traceEventId ? ` · ${inspectedMessage.provenance.traceEventId}` : ""}</p></div><button type="button" onClick={() => setInspectedMessage(null)} aria-label="Close source diagnostic">×</button></div>{inspectedMessage.provenance.transformedBy.length > 0 && <p className="mt-2">Transformed by: {inspectedMessage.provenance.transformedBy.join(" → ")}</p>}{inspectedMessage.provenance.reason && <p className="mt-1 text-slate-600">{inspectedMessage.provenance.reason}</p>}<button type="button" onClick={() => void copyDiagnostic()} className="mt-2 min-h-11 rounded border px-3 text-[10px] font-semibold">Copy Diagnostic</button></section>}
        {debugEnabled && (
          <details open={traceOpen} onToggle={(event) => { const open = event.currentTarget.open; setTraceOpen(open); if (open) onRefreshTrace?.(); }} className="mt-3 rounded-lg border border-slate-200 bg-slate-50">
            <summary className="min-h-11 cursor-pointer px-3 py-3 text-xs font-semibold">Execution Trace</summary>
            <div className="max-h-64 overflow-y-auto overscroll-contain border-t px-3 py-2 text-[10px]">
              <div className="flex items-center justify-between gap-2"><span className="break-all font-mono text-slate-500">{debugTrace?.requestId ?? "No correlated request"}</span>{onRefreshTrace && <button type="button" onClick={onRefreshTrace} className="min-h-11 px-2 underline">Refresh</button>}</div>
              {debugLoading && <p>Loading trace…</p>}
              {debugTrace?.timeline?.length ? <ol className="mt-2 space-y-2">{debugTrace.timeline.map((event) => <li id={`trace-${event.eventId}`} key={event.eventId} className={`border-l-2 pl-2 ${inspectedMessage?.provenance.traceEventId === event.eventId ? "border-sky-500 bg-sky-50" : "border-sage-300"}`}><p className="font-semibold">{event.stage.replaceAll("_", " ")} · {event.status}</p><p className="text-slate-500">{event.sourceType} · {event.provider ?? "—"}{event.model ? ` / ${event.model}` : ""} · {event.durationMs} ms</p>{event.routingReason && <p className="text-slate-500">Routing decision: {event.routingReason}</p>}{event.failureStage && <p className="text-rose-700">Failure stage: {event.failureStage.replaceAll("_", " ")}</p>}{event.reason && <p className="text-slate-600">{event.reason}</p>}<PlanningAITracePayload event={event}/></li>)}</ol> : !debugLoading && <p className="mt-2 text-slate-500">No timeline recorded yet.</p>}
            </div>
          </details>
        )}
      </div>}
      {bodyVisible && <form
        onSubmit={(event) => {
          event.preventDefault();
          if (value.trim()) {
            onSubmit(value.trim());
            setValue("");
          }
        }}
        className="flex gap-2 border-t border-slate-100 p-3"
      >
        <input
          ref={input}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          maxLength={500}
          placeholder="Find somewhere by the ocean…"
          className="min-w-0 flex-1 rounded-lg border border-slate-200 px-3 py-2 text-xs outline-none focus:border-sage-500"
        />
        <button
          disabled={!value.trim() || status === "understanding"}
          className="rounded-lg bg-sage-600 p-2 text-white disabled:opacity-40"
          aria-label="Send request"
        >
          <Send size={15} />
        </button>
      </form>}
    </aside>
  );
}

export type AssistantSheetState = "collapsed" | "half" | "full";
export function sheetStateAfterDrag(current: AssistantSheetState, deltaY: number): AssistantSheetState {
  if (Math.abs(deltaY) < 36) return current;
  const states: AssistantSheetState[] = ["collapsed", "half", "full"];
  const index = states.indexOf(current);
  return states[Math.max(0, Math.min(states.length - 1, index + (deltaY > 0 ? -1 : 1)))];
}

export function assistantSheetHeight(state: AssistantSheetState, viewportHeight: number) {
  if (state === "collapsed") return "4.25rem";
  if (state === "half") return "min(52dvh, 520px)";
  return `calc(${viewportHeight}px - env(safe-area-inset-top) - 4.5rem)`;
}

export class AssistantSheetDragSession {
  private active: { pointerId: number; startY: number } | null = null;
  get activePointerId() { return this.active?.pointerId ?? null; }
  begin(pointerId: number, startY: number) { this.active = { pointerId, startY }; }
  finish(pointerId: number, endY: number) {
    if (!this.active || this.active.pointerId !== pointerId) return null;
    const delta = endY - this.active.startY;
    this.active = null;
    return delta;
  }
  cancel(pointerId?: number) {
    if (!this.active || pointerId !== undefined && this.active.pointerId !== pointerId) return null;
    const activePointerId = this.active.pointerId;
    this.active = null;
    return activePointerId;
  }
}

export function viewportSnapshot() {
  if (typeof window === "undefined") return null;
  const viewport = window.visualViewport;
  return {
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight,
    visualViewport: viewport ? { width: viewport.width, height: viewport.height, offsetTop: viewport.offsetTop } : null,
    orientation: window.screen.orientation?.type ?? null,
  };
}

function mobileGestureDiagnostic(event: string, detail: unknown) {
  if (!import.meta.env.DEV || typeof window === "undefined" || !(window as Window & { __TRIPFLOW_GESTURE_DEBUG__?: boolean }).__TRIPFLOW_GESTURE_DEBUG__) return;
  console.debug("TripFlow mobile gesture", { event, detail });
}
