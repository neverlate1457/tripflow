import { lazy, Suspense, useEffect, useRef, useState } from "react";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import type {
  DragEndEvent,
  DragMoveEvent,
  DragStartEvent,
} from "@dnd-kit/core";
import { AlertCircle, Bot, LoaderCircle, X } from "lucide-react";
import { ExplorePanel } from "@/components/explore/ExplorePanel";
import {
  PIXELS_PER_HOUR,
  Timeflow,
  type Preview,
} from "@/components/timeflow/Timeflow";
import { DayContextEditor, type DayContextLocationSlot } from "./DayContextEditor";
import { DaySelector } from "./DaySelector";
import { TripHeader } from "./TripHeader";
import { MobilePlannerNav, type MobilePlannerSection } from "./MobilePlannerNav";
import {
  DAY_START_MINUTES,
  clampStartMinutes,
  itemsForDate,
  snapMinutes,
} from "@/domain/time";
import { usePlannerStore } from "@/stores/planner-store";
import { HttpTripManagement } from "@/services/client-trip-management";
import { CandidateSolveDialog } from "./CandidateSolveDialog";
import { PlanningAssistant } from "./PlanningAssistant";
import type { GeographicClarificationRequired, PlaceDiscoveryResult } from "@/domain/geographic-clarification";
import { HttpPlanningAIClient, HttpPlanningAIDebugClient } from "@/services/client-planning-ai";
import { PlanningAIDebugPanel, type PlanningAIDebugTrace } from "./PlanningAIDebugPanel";
import {
  deterministicIssueExplanation,
  deterministicProposalExplanation,
  type IntentInterpretation,
} from "@/domain/ai-planning";
import { analyzeDay } from "@/domain/constraints";
import { HttpPlaceDiscoveryClient } from "@/services/client-place-discovery";
import type { AssistantMessageProvenance } from "@/domain/assistant-provenance";
import type { DiscoveryMapContext } from "@/services/client-place-discovery";
import { markSuggestionAdded, type PlaceSuggestion } from "@/domain/discovery";
import type { GroundedPlaceRef, NormalizedPlace, TripDestination, TripItemType } from "@/domain/models";
import { MapScheduleDialog } from "@/components/map/MapScheduleDialog";
import { DestinationCombobox } from "./DestinationCombobox";
import { TimezoneCombobox } from "./TimezoneCombobox";
import { typeStyle } from "./type-style";
import { ManualItemDialog } from "./ManualItemDialog";
import { deriveSegmentSpecs, segmentEndpointKey } from "@/domain/routing";
import type { MovementEdgeOption } from "@/domain/manual-items";
import {
  unscheduleEligibility,
  type UnscheduleEligibility,
} from "@/domain/scheduling";
import { LatestRequestGate } from "@/services/latest-request";

const TripMap = lazy(() =>
  import("@/components/map/TripMap").then((module) => ({
    default: module.TripMap,
  })),
);
const TripItemEditor = lazy(() =>
  import("./TripItemEditor").then((module) => ({
    default: module.TripItemEditor,
  })),
);
const ProposalPreview = lazy(() =>
  import("./ProposalPreview").then((module) => ({
    default: module.ProposalPreview,
  })),
);

function isTextEditingTarget(target: EventTarget | null) {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable ||
      ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))
  );
}

export function TripPlanner({ tripId }: { tripId: string }) {
  const state = usePlannerStore();
  const [preview, setPreview] = useState<Preview | null>(null);
  const [unscheduleDrag, setUnscheduleDrag] =
    useState<UnscheduleEligibility | null>(null);
  const [renameOpen, setRenameOpen] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const [mobileSection, setMobileSection] = useState<MobilePlannerSection>("planner");
  const [manualMapCoordinate, setManualMapCoordinate] = useState<{ latitude: number; longitude: number } | null>(null);
  const [activeDrag, setActiveDrag] = useState<{
    title: string;
    type: TripItemType;
    action: string;
  } | null>(null);
  const [renameName, setRenameName] = useState("");
  const [editDestination, setEditDestination] = useState<TripDestination | null>(null);
  const [editTimezone, setEditTimezone] = useState("");
  const [editTimezoneTouched, setEditTimezoneTouched] = useState(false);
  const [renameError, setRenameError] = useState<string | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [solveCandidateId, setSolveCandidateId] = useState<string | null>(null);
  const [mapSchedule, setMapSchedule] = useState<{ place: NormalizedPlace; candidateId?: string } | null>(null);
  const [assistantOpen, setAssistantOpen] = useState(false),
    [aiStatus, setAiStatus] = useState<
      "idle" | "understanding" | "resolved" | "clarification" | "error"
    >("idle"),
    [interpretation, setInterpretation] = useState<IntentInterpretation | null>(
      null,
    ),
    [explanation, setExplanation] = useState<string | null>(null),
    [aiError, setAiError] = useState<string | null>(null);
  const [interpretationProvenance, setInterpretationProvenance] = useState<AssistantMessageProvenance | null>(null);
  const [discoveryProvenance, setDiscoveryProvenance] = useState<AssistantMessageProvenance | null>(null);
  const [explanationProvenance, setExplanationProvenance] = useState<AssistantMessageProvenance | null>(null);
  const [errorProvenance, setErrorProvenance] = useState<AssistantMessageProvenance | null>(null);
  const [activeUserPrompt, setActiveUserPrompt] = useState<{ text: string; requestId: string | null } | null>(null);
  const [geographicClarification, setGeographicClarification] = useState<GeographicClarificationRequired | null>(null);
  const [geographicClarificationError, setGeographicClarificationError] = useState<string | null>(null);
  const [geographicClarificationSubmitting, setGeographicClarificationSubmitting] = useState(false);
  const aiRequest = useRef(new LatestRequestGate()),
    aiController = useRef<AbortController | null>(null),
    aiClient = useRef(new HttpPlanningAIClient()),
    aiDebugClient = useRef(new HttpPlanningAIDebugClient()),
    aiDebugRequestId = useRef<string | null>(null),
    discoveryClient = useRef(new HttpPlaceDiscoveryClient()),
    deepLinkApplied = useRef<string | null>(null);
  const [aiDebugEnabled, setAiDebugEnabled] = useState(false), [aiDebugDetailed, setAiDebugDetailed] = useState(false), [aiDebugOpen, setAiDebugOpen] = useState(false), [aiDebugTrace, setAiDebugTrace] = useState<PlanningAIDebugTrace | null>(null), [aiDebugLoading, setAiDebugLoading] = useState(false), [aiDebugError, setAiDebugError] = useState<string | null>(null);
  const correlateVisibleProvenance = (trace: PlanningAIDebugTrace) => {
    const latest = (stage: string) => [...trace.timeline].reverse().find((event) => event.stage === stage)?.eventId ?? null;
    setDiscoveryProvenance((current) => current ? { ...current, traceEventId: latest(current.producerStage === "geographic_clarification" ? "geographic_grounding" : "places_discovery") } : current);
    setExplanationProvenance((current) => current ? { ...current, traceEventId: latest(current.producerStage === "discovery_error_handling" ? "discovery_failure" : current.producerStage === "issue_explanation" || current.producerStage === "proposal_explanation" ? "solver_result" : current.producerStage) } : current);
    setErrorProvenance((current) => current ? { ...current, traceEventId: current.traceEventId ?? latest("request_failure") } : current);
  };
  const [suggestions, setSuggestions] = useState<PlaceSuggestion[]>([]);
  const [discoveryMapContext, setDiscoveryMapContext] = useState<DiscoveryMapContext | null>(null);
  const [discoveryRelevance, setDiscoveryRelevance] = useState<
    "full" | "limited" | null
  >(null);
  const [discoveryReranking, setDiscoveryReranking] = useState<import("@/domain/travel-relevance").TravelRerankMetadata | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor),
  );
  useEffect(() => {
    deepLinkApplied.current = null;
    setGeographicClarification(null);
    setGeographicClarificationError(null);
    void state.hydrate(tripId);
    void aiDebugClient.current.capabilities().then(({ provenance, detailed }) => { setAiDebugEnabled(provenance); setAiDebugDetailed(detailed); }).catch(() => { setAiDebugEnabled(false); setAiDebugDetailed(false); });
  }, [tripId]);
  useEffect(() => {
    if (
      state.loadStatus !== "loaded" ||
      state.activeTrip?.id !== tripId ||
      deepLinkApplied.current === tripId
    )
      return;
    deepLinkApplied.current = tripId;
    const params = new URLSearchParams(window.location.search);
    const requestedDate = params.get("date")?.slice(0, 10);
    if (
      requestedDate &&
      requestedDate >= state.activeTrip.startDate &&
      requestedDate <= state.activeTrip.endDate
    )
      state.setSelectedDate(requestedDate);
    const requestedItem = params.get("item");
    if (requestedItem && state.tripItems.some((item) => item.id === requestedItem))
      state.select({ type: "tripItem", id: requestedItem });
  }, [state.loadStatus, state.activeTrip?.id, state.tripItems, tripId]);
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (
        isTextEditingTarget(event.target) ||
        !(event.ctrlKey || event.metaKey) ||
        event.key.toLowerCase() !== "z"
      )
        return;
      event.preventDefault();
      if (event.shiftKey) void state.redo();
      else void state.undo();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [state.undo, state.redo]);

  if (state.loadStatus === "initial" || state.loadStatus === "loading")
    return (
      <main className="flex h-screen items-center justify-center bg-canvas">
        <div className="text-center">
          <LoaderCircle className="mx-auto animate-spin text-sage-600" />
          <p className="mt-3 text-sm font-medium">Loading your trip…</p>
        </div>
      </main>
    );
  if (state.loadStatus === "error" || !state.activeTrip)
    return (
      <main className="flex h-screen items-center justify-center bg-canvas">
        <div className="max-w-sm rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-soft">
          <AlertCircle className="mx-auto text-rose-500" />
          <h1 className="mt-3 font-semibold">Trip unavailable</h1>
          <p className="mt-1 text-sm text-slate-500">{state.loadError}</p>
          <button
            onClick={() => void state.retryHydration()}
            className="mt-5 rounded-lg bg-sage-600 px-4 py-2 text-sm font-semibold text-white"
          >
            Try again
          </button>
        </div>
      </main>
    );

  const dragPreview = (event: DragMoveEvent | DragStartEvent) => {
    const data = event.active.data.current;
    if (!data) return;
    const translated = event.active.rect.current.translated;
    const over = "over" in event ? event.over : null;
    if (!translated || over?.id !== "timeflow-dropzone") {
      setPreview(null);
      return;
    }
    const duration = Number(
      data.duration ??
        state.candidates.find((candidate) => candidate.id === data.candidateId)
          ?.estimatedDuration ??
        60,
    );
    const raw =
      DAY_START_MINUTES +
      ((translated.top - over.rect.top) / PIXELS_PER_HOUR) * 60;
    setPreview({
      startMinutes: clampStartMinutes(snapMinutes(raw), duration),
      duration,
    });
  };
  const finishDrag = (event: DragEndEvent) => {
    const data = event.active.data.current;
    const target = preview;
    if (event.over?.id === "timeflow-dropzone" && data && target) {
      if (data.kind === "candidate")
        void state.scheduleCandidate(
          String(data.candidateId),
          target.startMinutes,
        );
      if (data.kind === "item")
        void state.moveItem(String(data.itemId), target.startMinutes);
    }
    if (
      event.over?.id === "want-to-go-dropzone" &&
      data?.kind === "item" &&
      unscheduleDrag?.eligible
    )
      void state.unscheduleItem(String(data.itemId));
    setPreview(null);
    setUnscheduleDrag(null);
    setActiveDrag(null);
  };
  const startDrag = (event: DragStartEvent) => {
    const data = event.active.data.current;
    if (data?.kind === "item") {
      const item = state.tripItems.find(
        (entry) => entry.id === String(data.itemId),
      );
      setUnscheduleDrag(item ? unscheduleEligibility(item) : null);
      if (item)
        setActiveDrag({
          title: item.title,
          type: item.type,
          action: unscheduleEligibility(item).eligible
            ? "Reschedule or move to Want to go"
            : "Reschedule activity",
        });
    } else {
      setUnscheduleDrag(null);
      const candidate = state.candidates.find(
        (entry) => entry.id === String(data?.candidateId),
      );
      if (candidate)
        setActiveDrag({
          title: candidate.title,
          type: candidate.type,
          action: "Schedule on Timeflow",
        });
    }
    dragPreview(event);
  };
  const selectedItemId =
    state.selection?.type === "tripItem" ? state.selection.id : null;
  const selectedSegmentId =
    state.selection?.type === "travelSegment" ? state.selection.id : null;
  const selectedItem =
    state.tripItems.find((item) => item.id === selectedItemId) ?? null;
  const confirmDelete = (id: string) => {
    const item = state.tripItems.find((entry) => entry.id === id);
    if (item && window.confirm(`Delete “${item.title}” from this trip?`))
      void state.deleteItem(id);
  };
  const openRename = () => {
    setRenameName(state.activeTrip!.name);
    setEditDestination(state.activeTrip!.destination ?? null);
    setEditTimezone(state.activeTrip!.timezone);
    setEditTimezoneTouched(false);
    setRenameError(null);
    setRenameOpen(true);
  };
  const rename = async () => {
    const name = renameName.trim();
    if (!name) {
      setRenameError("Enter a trip name.");
      return;
    }
    if (name === state.activeTrip!.name && editTimezone === state.activeTrip!.timezone && editDestination?.providerPlaceId === state.activeTrip!.destination?.providerPlaceId) {
      setRenameOpen(false);
      return;
    }
    setRenaming(true);
    setRenameError(null);
    try {
      await new HttpTripManagement().update(state.activeTrip!.id, { name, timezone: editTimezone, destination: editDestination });
      await state.hydrate(state.activeTrip!.id);
      setRenameOpen(false);
    } catch {
      setRenameError("Trip could not be renamed. Try again.");
    } finally {
      setRenaming(false);
    }
  };
  const executeInterpretation = async (
    result: IntentInterpretation,
    request = aiRequest.current.current(),
    originalRequest?: string,
  ) => {
    setInterpretation(result);
    if (result.status !== "resolved") {
      setAiStatus(
        result.status === "clarification_required"
          ? "clarification"
          : "resolved",
      );
      return;
    }
    setAiStatus("resolved");
    const intent = result.intent;
    if (intent.type === "repair_day") {
      if (aiDebugRequestId.current) await aiDebugClient.current.update(aiDebugRequestId.current, "solverInput", { type: "repair_day", date: intent.date, timeWindow: intent.timeWindow ?? null, preferences: intent.preferences ?? null, targetItemId: intent.targetItemId ?? null, targetStartTime: intent.targetStartTime ?? null });
      state.setSelectedDate(intent.date);
      await state.suggestRepair({ timeWindow: intent.timeWindow, pace: intent.preferences?.pace, targetItemId: intent.targetItemId, targetStartTime: intent.targetStartTime });
      if (aiDebugRequestId.current) { const latest = usePlannerStore.getState(); await aiDebugClient.current.update(aiDebugRequestId.current, "solverResult", { status: latest.solverResult?.status ?? latest.solverStatus, proposalType: latest.proposalPreview?.kind ?? null, proposedOperations: latest.proposalPreview?.changes ?? [], metrics: latest.proposalPreview?.after ?? null, confidence: latest.proposalPreview?.confidence ?? null, rejectionReason: latest.solverResult?.reason ?? null }); }
    } else if (intent.type === "insert_candidate") {
      if (aiDebugRequestId.current) await aiDebugClient.current.update(aiDebugRequestId.current, "solverInput", { type: "candidate_insertion", date: intent.date, candidateIds: [intent.candidateId], requestedTimeWindow: intent.timeWindow ?? null, durationMinutes: intent.durationMinutes ?? null, travelMode: intent.travelMode ?? "driving", constraints: "canonical candidate, day, and requested time-window constraints" });
      state.setSelectedDate(intent.date);
      await state.findCandidateTime(intent.candidateId, {
        date: intent.date,
        durationMinutes: intent.durationMinutes,
        mode: intent.travelMode,
        timeWindow: intent.timeWindow,
      });
      { const latest = usePlannerStore.getState(); if (aiDebugRequestId.current) await aiDebugClient.current.update(aiDebugRequestId.current, "solverResult", { status: latest.solverResult?.status ?? latest.solverStatus, proposalType: latest.proposalPreview?.kind ?? null, proposedOperations: latest.proposalPreview?.changes ?? [], metrics: latest.proposalPreview?.after ?? null, confidence: latest.proposalPreview?.confidence ?? null, rejectionReason: latest.solverResult?.reason ?? null }); if (latest.solverResult?.status !== "ready") setInterpretation({ status: "unsupported", reason: "TripFlow could not find a safe time for that saved place within the requested window." }); }
    } else if (intent.type === "insert_candidates") {
      if (aiDebugRequestId.current) await aiDebugClient.current.update(aiDebugRequestId.current, "solverInput", { type: "candidate_insertion", date: intent.date, candidateIds: intent.candidateIds, requestedTimeWindow: intent.timeWindow, travelMode: intent.travelMode ?? "driving", constraints: "all requested Candidates must fit completely inside the time window" });
      state.setSelectedDate(intent.date);
      await state.findCandidatesTime(intent.candidateIds, { date: intent.date, mode: intent.travelMode, timeWindow: intent.timeWindow });
      { const latest = usePlannerStore.getState(); if (aiDebugRequestId.current) await aiDebugClient.current.update(aiDebugRequestId.current, "solverResult", { status: latest.solverResult?.status ?? latest.solverStatus, proposalType: latest.proposalPreview?.kind ?? null, proposedOperations: latest.proposalPreview?.changes ?? [], metrics: latest.proposalPreview?.after ?? null, confidence: latest.proposalPreview?.confidence ?? null, rejectionReason: latest.solverResult?.reason ?? null }); if (latest.solverResult?.status !== "ready") setInterpretation({ status: "unsupported", reason: "TripFlow could not fit all selected saved places inside the requested time window." }); }
    } else if (intent.type === "discover_places") {
      setAiStatus("understanding");
      const found = await discoveryClient.current.discover(
        state.activeTrip!.id,
        intent,
        aiController.current?.signal,
        aiDebugRequestId.current,
        originalRequest,
      );
      if (!aiRequest.current.isCurrent(request)) return;
      if (found.status === "clarification_required") {
        setDiscoveryProvenance({ producerType: "tripflow_deterministic", producerStage: "geographic_clarification", provider: "tripflow", model: null, requestId: aiDebugRequestId.current, traceEventId: null, transformedBy: ["Geoapify geographic grounding"], reason: "Material ambiguity requires explicit user selection." });
        setGeographicClarification(found);
        setGeographicClarificationError(null);
        setAiStatus("clarification");
        return;
      }
      setGeographicClarification(null);
      setSuggestions(found.suggestions);
      setDiscoveryMapContext(found.status === "ready" ? found.context ?? null : null);
      setDiscoveryRelevance(found.status === "ready" ? found.relevanceConfidence ?? null : null);
      setDiscoveryReranking(found.status === "ready" ? found.reranking ?? null : null);
      setExplanation(
        found.status === "unsupported"
          ? found.reason ??
              "TripFlow needs a location before it can search nearby places."
          : null,
      );
      setExplanationProvenance(found.status === "unsupported" ? { producerType: "tripflow_deterministic", producerStage: "discovery_error_handling", provider: "tripflow", model: null, requestId: aiDebugRequestId.current, traceEventId: null, transformedBy: ["Geographic and provider validation"], reason: found.reason ?? null } : null);
      setDiscoveryProvenance({ producerType: "place_provider", producerStage: "places_discovery", provider: "geoapify", model: null, requestId: aiDebugRequestId.current, traceEventId: null, transformedBy: ["TripFlow semantic eligibility", "TripFlow deterministic ranking"], reason: found.status === "ready" ? "Suggestions originate from normalized provider results." : "Discovery did not produce suggestions." });
      setAiStatus("resolved");
    } else if (intent.type === "explain_issues") {
      const visible = itemsForDate(
          state.tripItems,
          intent.date,
          state.activeTrip!.timezone,
        ),
        issues = analyzeDay(
          visible,
          state.travelSegments.filter((x) => x.date === intent.date),
        ).issues;
      setExplanation(
        deterministicIssueExplanation(
          issues.map((x) => ({
            code: x.code,
            severity: x.severity,
            itemIds: x.tripItemIds,
          })),
        ),
      );
      setExplanationProvenance({ producerType: "tripflow_deterministic", producerStage: "issue_explanation", provider: "tripflow", model: null, requestId: aiDebugRequestId.current, traceEventId: null, transformedBy: [], reason: "Rendered from deterministic DayFeasibility issues." });
    } else {
      const proposal = state.solverResult?.proposals.find(
        (x) => x.id === intent.proposalId,
      );
      setExplanation(
        proposal
          ? deterministicProposalExplanation(proposal)
          : "That proposal is no longer available.",
      );
      setExplanationProvenance({ producerType: "tripflow_deterministic", producerStage: "proposal_explanation", provider: "tripflow", model: null, requestId: aiDebugRequestId.current, traceEventId: null, transformedBy: [], reason: proposal ? "Rendered from an existing deterministic proposal." : "The referenced proposal was unavailable." });
    }
  };
  const submitAI = async (message: string) => {
    const request = aiRequest.current.begin();
    aiController.current?.abort();
    aiController.current = new AbortController();
    setActiveUserPrompt({ text: message, requestId: null });
    setAiStatus("understanding");
    setInterpretation(null);
    setExplanation(null);
    setAiError(null);
    setInterpretationProvenance(null);
    setDiscoveryProvenance(null);
    setExplanationProvenance(null);
    setErrorProvenance(null);
    setSuggestions([]);
    setGeographicClarification(null);
    setGeographicClarificationError(null);
    setGeographicClarificationSubmitting(false);
    setDiscoveryMapContext(null);
    setDiscoveryRelevance(null);
    setDiscoveryReranking(null);
    setAiDebugTrace(null);
    setAiDebugOpen(false);
    setAiDebugError(null);
    try {
      const response = await aiClient.current.interpret(
        state.activeTrip!.id,
        state.selectedDate,
        message,
        aiController.current.signal,
      );
      if (!aiRequest.current.isCurrent(request)) return;
      aiDebugRequestId.current = response.requestId ?? null;
      setActiveUserPrompt((current) => current?.text === message ? { ...current, requestId: response.requestId ?? null } : current);
      setInterpretationProvenance({ ...response.provenance, transformedBy: [...response.provenance.transformedBy, "PlanningAssistant presentation"] });
      await executeInterpretation(response.interpretation, request, message);
      if (aiDebugEnabled && aiDebugRequestId.current && aiRequest.current.isCurrent(request)) {
        await aiDebugClient.current.update(aiDebugRequestId.current, "frontendRendering", { component: "PlanningAssistant", status: "rendered", interpretationStatus: response.interpretation.status, intentType: response.interpretation.status === "resolved" ? response.interpretation.intent.type : null });
        const trace = await aiDebugClient.current.trace(aiDebugRequestId.current); setAiDebugTrace(trace); correlateVisibleProvenance(trace);
      }
    } catch (error) {
      if (error && typeof error === "object" && "requestId" in error && typeof error.requestId === "string") { aiDebugRequestId.current = error.requestId; setActiveUserPrompt((current) => current?.text === message ? { ...current, requestId: error.requestId as string } : current); }
      if (
        !aiRequest.current.isCurrent(request) ||
        (error instanceof DOMException && error.name === "AbortError")
      )
        return;
      setAiError(
        error instanceof Error
          ? error.message
          : "The request could not be completed. Nothing was changed; try again.",
      );
      setErrorProvenance(error && typeof error === "object" && "provenance" in error ? (error.provenance as AssistantMessageProvenance | undefined) ?? null : { producerType: "frontend", producerStage: "error_handler", provider: "react", model: null, requestId: aiDebugRequestId.current, traceEventId: null, transformedBy: [], reason: "The frontend generated the fallback because no verified server provenance was available." });
      setAiStatus("error");
      if (aiDebugEnabled && aiDebugRequestId.current) {
        await aiDebugClient.current.update(aiDebugRequestId.current, "frontendRendering", { component: "PlanningAssistant", status: "error", messageDisplayed: true }).catch(() => undefined);
        const trace = await aiDebugClient.current.trace(aiDebugRequestId.current).catch(() => null); setAiDebugTrace(trace); if (trace) correlateVisibleProvenance(trace);
      }
    }
  };
  const loadDebugTrace = async (openPanel = true) => { if (openPanel) setAiDebugOpen(true); setAiDebugError(null); const id = aiDebugRequestId.current; if (!id) { setAiDebugTrace(null); return; } setAiDebugLoading(true); try { setAiDebugTrace(await aiDebugClient.current.trace(id)); } catch (error) { setAiDebugError(error instanceof Error ? error.message : "Debug trace unavailable"); } finally { setAiDebugLoading(false); } };
  const cancelAI = () => {
    aiRequest.current.invalidate();
    aiController.current?.abort();
    aiController.current = null;
    setAiStatus("idle");
    setInterpretation(null);
    setAiError(null);
    setInterpretationProvenance(null);
    setDiscoveryProvenance(null);
    setExplanationProvenance(null);
    setErrorProvenance(null);
    setGeographicClarification(null);
    setGeographicClarificationError(null);
    setGeographicClarificationSubmitting(false);
  };
  const applyDiscoveryResult = (found: PlaceDiscoveryResult) => {
    if (found.status === "clarification_required") {
      setDiscoveryProvenance({ producerType: "tripflow_deterministic", producerStage: "geographic_clarification", provider: "tripflow", model: null, requestId: aiDebugRequestId.current, traceEventId: null, transformedBy: ["Geoapify geographic grounding"], reason: "Material ambiguity requires explicit user selection." });
      setGeographicClarification(found);
      setGeographicClarificationError(null);
      setAiStatus("clarification");
      return;
    }
    setGeographicClarification(null);
    setGeographicClarificationError(null);
    setSuggestions(found.suggestions);
    setDiscoveryMapContext(found.status === "ready" ? found.context ?? null : null);
    setDiscoveryRelevance(found.status === "ready" ? found.relevanceConfidence ?? null : null);
    setDiscoveryReranking(found.status === "ready" ? found.reranking ?? null : null);
    setExplanation(found.status === "unsupported" ? found.reason ?? "TripFlow needs a location before it can search nearby places." : null);
    setExplanationProvenance(found.status === "unsupported" ? { producerType: "tripflow_deterministic", producerStage: "discovery_error_handling", provider: "tripflow", model: null, requestId: aiDebugRequestId.current, traceEventId: null, transformedBy: ["Geographic and provider validation"], reason: found.reason ?? null } : null);
    setDiscoveryProvenance({ producerType: "place_provider", producerStage: "places_discovery", provider: "geoapify", model: null, requestId: aiDebugRequestId.current, traceEventId: null, transformedBy: ["TripFlow semantic eligibility", "TripFlow deterministic ranking"], reason: found.status === "ready" ? "Suggestions originate from normalized provider results." : "Discovery did not produce suggestions." });
    setAiStatus("resolved");
  };
  const resumeGeographicDiscovery = async (selectedCandidateId: string) => {
    if (!geographicClarification || geographicClarificationSubmitting) return;
    const request = aiRequest.current.current();
    setGeographicClarificationSubmitting(true);
    setGeographicClarificationError(null);
    try {
      const found = await discoveryClient.current.resume(
        geographicClarification.clarificationToken,
        selectedCandidateId,
        aiController.current?.signal,
      );
      if (!aiRequest.current.isCurrent(request)) return;
      applyDiscoveryResult(found);
      if (aiDebugEnabled && aiDebugRequestId.current) {
        await aiDebugClient.current.update(aiDebugRequestId.current, "frontendRendering", { component: "PlanningAssistant", status: "rendered", responseType: "geographic_clarification_resumed" });
        const trace = await aiDebugClient.current.trace(aiDebugRequestId.current); setAiDebugTrace(trace); correlateVisibleProvenance(trace);
      }
    } catch (error) {
      if (!aiRequest.current.isCurrent(request) || (error instanceof DOMException && error.name === "AbortError")) return;
      const code = error && typeof error === "object" && "code" in error ? error.code : null;
      setGeographicClarificationError(code === "expired" || code === "not_found"
        ? "This location choice expired. Retry the original search."
        : error instanceof Error ? error.message : "The location choice could not be verified.");
    } finally {
      if (aiRequest.current.isCurrent(request)) setGeographicClarificationSubmitting(false);
    }
  };
  const selectedDayContext =
    state.dayContexts.find((context) => context.date === state.selectedDate) ?? null;
  const endpointLabel = (endpoint: import("@/domain/routing").SegmentEndpoint) => endpoint.kind === "day_start"
    ? `Day Start${selectedDayContext?.startLocation ? `: ${selectedDayContext.startLocation.name}` : ""}`
    : endpoint.kind === "day_end"
      ? `Day End${selectedDayContext?.endLocation ? `: ${selectedDayContext.endLocation.name}` : ""}`
      : state.tripItems.find((item) => item.id === endpoint.tripItemId)?.title ?? "Missing activity";
  const movementEdges: MovementEdgeOption[] = deriveSegmentSpecs(state.tripItems, state.activeTrip.timezone, state.dayContexts)
    .filter((spec) => spec.date === state.selectedDate)
    .map((spec) => ({ id: `${segmentEndpointKey(spec.fromEndpoint)}--${segmentEndpointKey(spec.toEndpoint)}`, label: `${endpointLabel(spec.fromEndpoint)} → ${endpointLabel(spec.toEndpoint)}`, fromEndpoint: spec.fromEndpoint, toEndpoint: spec.toEndpoint }));
  const saveDayContextLocation = async (
    slot: DayContextLocationSlot,
    location: GroundedPlaceRef | null,
  ) => {
    const now = new Date().toISOString();
    const existing =
      state.dayContexts.find((context) => context.date === state.selectedDate) ?? null;
    await state.setDayContext({
      tripId: state.activeTrip!.id,
      date: state.selectedDate,
      startLocation: existing?.startLocation ?? null,
      baseLocation: existing?.baseLocation ?? null,
      endLocation: existing?.endLocation ?? null,
      [slot]: location,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    });
  };

  return (
    <DndContext
      sensors={sensors}
      onDragStart={startDrag}
      onDragMove={dragPreview}
      onDragCancel={() => {
        setPreview(null);
        setUnscheduleDrag(null);
      }}
      onDragEnd={finishDrag}
    >
      <main className="mobile-touch-targets flex h-[100dvh] min-w-0 flex-col overflow-hidden bg-canvas">
        <TripHeader
          trip={state.activeTrip}
          saveStatus={state.saveStatus}
          onRetry={() => void state.retrySave()}
          canUndo={state.past.length > 0}
          canRedo={state.future.length > 0}
          onUndo={() => void state.undo()}
          onRedo={() => void state.redo()}
          onRename={openRename}
        />
        <DaySelector
          trip={state.activeTrip}
          selected={state.selectedDate}
          onSelect={state.setSelectedDate}
        />
        <DayContextEditor
          trip={state.activeTrip}
          date={state.selectedDate}
          context={selectedDayContext}
          saveStatus={state.saveStatus}
          saveError={state.saveError}
          onSave={saveDayContextLocation}
        />
        <div className="grid min-h-0 min-w-0 flex-1 grid-cols-1 overflow-hidden pb-[calc(3.25rem+env(safe-area-inset-bottom))] xl:grid-cols-[270px_minmax(400px,1.2fr)_minmax(460px,1fr)] xl:pb-0">
          <div className={`${mobileSection === "explore" || mobileSection === "candidates" ? "flex" : "hidden"} min-h-0 min-w-0 flex-col overflow-hidden xl:flex`}>
          <ExplorePanel
            candidates={state.candidates}
            results={state.searchResults}
            query={state.searchQuery}
            searchStatus={state.searchStatus}
            searchError={state.searchError}
            selection={state.selection}
            unscheduleDrop={unscheduleDrag}
            onSearch={(query) => void state.searchPlaces(query)}
            onClear={state.clearSearch}
            onSelect={state.select}
            onAdd={(id) => void state.addSearchResult(id)}
            onRemove={(id) => void state.removeCandidate(id)}
            onFindTime={setSolveCandidateId}
            onAddManual={() => setManualOpen(true)}
            mobileMode={mobileSection === "candidates" ? "candidates" : mobileSection === "explore" ? "explore" : "all"}
          />
          </div>
          <div className={`${mobileSection === "map" ? "block" : "hidden"} min-h-0 min-w-0 xl:block`}>
          <Suspense
            fallback={
              <section
                className="h-full min-h-[280px] min-w-0 border-r border-slate-200 bg-[#e8eee7]"
                aria-label="Loading trip map"
              />
            }
          >
            <TripMap
              items={state.tripItems}
              candidates={state.candidates}
              results={state.searchResults}
              suggestions={suggestions}
              discoveryContext={discoveryMapContext}
              segments={state.travelSegments}
              selectedDate={state.selectedDate}
              timezone={state.activeTrip.timezone}
              selection={state.selection}
              proposal={state.proposalPreview}
              destination={state.activeTrip.destination}
              onSelect={state.select}
              onWantToGo={state.addPlace}
              onAddToTimeflow={(place, candidateId) => setMapSchedule({ place, candidateId })}
              onUseManualLocation={(coordinate) => { setManualMapCoordinate(coordinate); setManualOpen(true); }}
            />
          </Suspense>
          </div>
          <div className={`${mobileSection === "planner" ? "block" : "hidden"} min-h-0 min-w-0 overflow-hidden xl:block`}>
          <Timeflow
            items={state.tripItems}
            candidates={state.candidates}
            segments={state.travelSegments}
            dayContext={selectedDayContext}
            selectedDate={state.selectedDate}
            timezone={state.activeTrip.timezone}
            selectedItemId={selectedItemId}
            selectedSegmentId={selectedSegmentId}
            preview={preview}
            proposal={state.proposalPreview}
            onSelect={(id) =>
              state.select(id ? { type: "tripItem", id } : null)
            }
            onSelectSegment={(id) =>
              state.select({ type: "travelSegment", id })
            }
            onResize={(id, end) => void state.resizeItem(id, end)}
            onSuggestRepair={state.suggestRepair}
            onMode={(id, mode) => void state.setTravelMode(id, mode)}
            onRetryRoute={(id) => void state.retryRoute(id)}
            onDurationOverride={(id, minutes) => void state.setTravelDurationOverride(id, minutes)}
            onDelete={confirmDelete}
            onUnschedule={(id) => void state.unscheduleItem(id)}
          />
          </div>
        </div>
        <MobilePlannerNav active={mobileSection} onChange={setMobileSection}/>
        {selectedItem && (
          <Suspense fallback={null}>
            <TripItemEditor
              item={selectedItem}
              timezone={state.activeTrip.timezone}
              trip={state.activeTrip}
              movementEdges={movementEdges}
              onClose={() => state.select(null)}
              onSave={(edit) => state.editItem(selectedItem.id, edit)}
              onDelete={() => confirmDelete(selectedItem.id)}
            />
          </Suspense>
        )}
        {manualOpen && (
          <ManualItemDialog
            trip={state.activeTrip}
            selectedDate={state.selectedDate}
            movementEdges={movementEdges}
            initialMapCoordinate={manualMapCoordinate}
            onCancel={() => { setManualOpen(false); setManualMapCoordinate(null); }}
            onCreate={async (input) => {
              await state.createItem(input);
              setManualOpen(false);
              setManualMapCoordinate(null);
            }}
          />
        )}
        {solveCandidateId &&
          state.candidates.find((x) => x.id === solveCandidateId) && (
            <CandidateSolveDialog
              candidate={state.candidates.find(
                (x) => x.id === solveCandidateId,
              )!}
              trip={state.activeTrip}
              selectedDate={state.selectedDate}
              onCancel={() => setSolveCandidateId(null)}
              onSolve={(options) => {
                const id = solveCandidateId;
                setSolveCandidateId(null);
                void state.findCandidateTime(id, options);
              }}
            />
          )}
        {mapSchedule && (
          <MapScheduleDialog
            place={mapSchedule.place}
            candidateId={mapSchedule.candidateId}
            trip={state.activeTrip}
            selectedDate={state.selectedDate}
            onCancel={() => setMapSchedule(null)}
            onFind={(options) => {
              const current = mapSchedule;
              setMapSchedule(null);
              if (current.candidateId) void state.findCandidateTime(current.candidateId, options);
              else void state.findPlaceTime(current.place, options);
            }}
            onManual={(options) => {
              const current = mapSchedule;
              setMapSchedule(null);
              if (current.candidateId) {
                if (options.date !== state.selectedDate) state.setSelectedDate(options.date);
                void state.scheduleCandidate(current.candidateId, options.startMinutes);
              } else void state.schedulePlaceManually(current.place, options);
            }}
          />
        )}
        <Suspense fallback={null}>
          <ProposalPreview
            result={state.solverResult}
            proposal={state.proposalPreview}
            items={state.tripItems}
            candidates={[...state.candidates, ...(state.pendingProposalCandidate ? [state.pendingProposalCandidate] : [])]}
            timezone={state.activeTrip.timezone}
            onSelect={state.selectProposal}
            onCancel={() => state.selectProposal(null)}
            onApply={() => void state.applyProposal()}
          />
        </Suspense>
        {(state.solverStatus === "preparing_routes" ||
          state.solverStatus === "solving") && (
          <div className="fixed inset-0 z-[73] flex items-center justify-center bg-slate-950/20">
            <div className="flex items-center gap-3 rounded-xl bg-white px-5 py-4 text-sm font-semibold shadow-xl">
              <LoaderCircle className="animate-spin text-sage-600" size={18} />
              {state.solverStatus === "preparing_routes"
                ? "Checking travel times…"
                : "Finding schedule…"}
              <button
                onClick={state.cancelSolve}
                className="rounded p-1 text-slate-400 hover:bg-slate-100"
                aria-label="Cancel solve"
              >
                <X size={15} />
              </button>
            </div>
          </div>
        )}
        {renameOpen && (
          <div
            className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/30 p-4"
            role="presentation"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget && !renaming)
                setRenameOpen(false);
            }}
          >
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void rename();
              }}
              className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl"
              role="dialog"
              aria-modal="true"
              aria-labelledby="rename-trip-title"
            >
              <h2 id="rename-trip-title" className="text-lg font-semibold">
                Edit trip
              </h2>
              <label className="mt-4 block text-xs font-semibold text-slate-600">
                Trip name
                <input
                  autoFocus
                  value={renameName}
                  onChange={(event) => setRenameName(event.target.value)}
                  className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-sage-500 focus:ring-2 focus:ring-sage-100"
                />
              </label>
              <label className="mt-4 block text-xs font-semibold text-slate-600">Destination<DestinationCombobox value={editDestination} onChange={(destination)=>{setEditDestination(destination);if(destination?.timezone&&!editTimezoneTouched&&editTimezone===state.activeTrip!.timezone)setEditTimezone(destination.timezone);}} /></label>
              <label className="mt-4 block text-xs font-semibold text-slate-600">Timezone<TimezoneCombobox value={editTimezone} date={state.activeTrip!.startDate} onChange={(timezone)=>{setEditTimezoneTouched(true);setEditTimezone(timezone);}} /></label>
              {renameError && (
                <p className="mt-2 text-xs text-rose-600" role="alert">
                  {renameError}
                </p>
              )}
              <div className="mt-5 flex justify-end gap-2">
                <button
                  type="button"
                  disabled={renaming}
                  onClick={() => setRenameOpen(false)}
                  className="rounded-lg px-3 py-2 text-sm text-slate-600 hover:bg-slate-100"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={renaming}
                  className="rounded-lg bg-sage-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
                >
                  {renaming ? "Saving…" : "Save"}
                </button>
              </div>
            </form>
          </div>
        )}
        {state.saveStatus === "error" && (
          <div className="fixed bottom-4 left-1/2 z-[60] flex -translate-x-1/2 items-center gap-3 rounded-xl border border-rose-200 bg-white px-4 py-3 text-xs text-rose-700 shadow-lg">
            <AlertCircle size={14} />
            {state.saveError}
            <button
              onClick={() => void state.retrySave()}
              className="font-semibold underline"
            >
              Retry
            </button>
          </div>
        )}
        {!assistantOpen && (
          <button
            onClick={() => { setMobileSection("map"); setAssistantOpen(true); }}
            className={`fixed bottom-[calc(4.25rem+env(safe-area-inset-bottom))] right-3 z-[60] flex min-h-11 items-center gap-2 rounded-full bg-sage-700 px-4 py-3 text-sm font-semibold text-white shadow-xl xl:bottom-4 xl:right-4 ${mobileSection === "planner" || mobileSection === "explore" ? "" : "hidden xl:flex"}`}
          >
            <Bot size={17} />
            Ask TripFlow
          </button>
        )}
        {assistantOpen && (
          <PlanningAssistant
            status={aiStatus}
            errorMessage={aiError}
            interpretation={interpretation}
            explanation={explanation}
            suggestions={suggestions}
            relevanceConfidence={discoveryRelevance}
            reranking={discoveryReranking}
            geographicClarification={geographicClarification}
            geographicClarificationSubmitting={geographicClarificationSubmitting}
            geographicClarificationError={geographicClarificationError}
            userPrompt={activeUserPrompt}
            onSubmit={(message) => void submitAI(message)}
            onCancel={cancelAI}
            onClose={() => {
              cancelAI();
              setSuggestions([]);
              setDiscoveryMapContext(null);
              setDiscoveryRelevance(null);
              setDiscoveryReranking(null);
              setAssistantOpen(false);
            }}
            onChoose={(candidateId) => {
              const candidate = state.candidates.find(
                (x) => x.id === candidateId,
              );
              if (candidate) {
                setInterpretationProvenance({ producerType: "tripflow_deterministic", producerStage: "clarification_selection", provider: "tripflow", model: null, requestId: aiDebugRequestId.current, traceEventId: null, transformedBy: [], reason: "The user selected a canonical Candidate from bounded clarification options." });
                void executeInterpretation({
                  status: "resolved",
                  intent: {
                    type: "insert_candidate",
                    candidateId,
                    date: state.selectedDate,
                    durationMinutes: candidate.estimatedDuration,
                    travelMode: "driving",
                  },
                  summary: `Find a time for ${candidate.title}.`,
                });
              }
            }}
            onChooseMany={(candidateIds,scheduling)=>{ setInterpretationProvenance({ producerType: "tripflow_deterministic", producerStage: "clarification_selection", provider: "tripflow", model: null, requestId: aiDebugRequestId.current, traceEventId: null, transformedBy: [], reason: "The user selected canonical Candidates from bounded clarification options." }); void executeInterpretation({status:"resolved",intent:{type:"insert_candidates",candidateIds,date:scheduling.date,timeWindow:scheduling.timeWindow,...(scheduling.travelMode?{travelMode:scheduling.travelMode}:{})},summary:`Find one schedule for ${candidateIds.length} saved places.`}); }}
            onSelectSuggestion={(id) =>
              state.select({ type: "suggestion", id })
            }
            onViewSuggestion={(id) => {
              state.select({ type: "suggestion", id });
              setMobileSection("map");
            }}
            onClearSuggestions={() => {
              setSuggestions([]);
              setDiscoveryMapContext(null);
              setDiscoveryRelevance(null);
              setDiscoveryReranking(null);
              if (state.selection?.type === "suggestion") state.select(null);
            }}
            onConfirmGeographicCandidate={(candidateId) => void resumeGeographicDiscovery(candidateId)}
            onCancelGeographicClarification={() => {
              setGeographicClarification(null);
              setGeographicClarificationError(null);
              setAiStatus("idle");
            }}
            onEditGeographicSearch={() => {
              setGeographicClarification(null);
              setGeographicClarificationError(null);
              setAiStatus("idle");
            }}
            onAddSuggestion={(suggestion) =>
              void (async () => {
                if (!(await state.addPlace(suggestion.place))) return;
                setSuggestions((current) =>
                  markSuggestionAdded(current, suggestion.id),
                );
              })()
            }
            debugEnabled={aiDebugEnabled}
            debugDetailed={aiDebugDetailed}
            onDebug={() => void loadDebugTrace()}
            debugTrace={aiDebugTrace}
            debugLoading={aiDebugLoading}
            onRefreshTrace={() => void loadDebugTrace(false)}
            interpretationProvenance={interpretationProvenance}
            discoveryProvenance={discoveryProvenance}
            explanationProvenance={explanationProvenance}
            errorProvenance={errorProvenance}
          />
        )}
        {aiDebugDetailed && aiDebugOpen && <PlanningAIDebugPanel trace={aiDebugTrace} loading={aiDebugLoading} error={aiDebugError} onRefresh={() => void loadDebugTrace(false)} onClose={() => setAiDebugOpen(false)} />}
        <DragOverlay dropAnimation={null}>
          {activeDrag && (
            <div className="w-56 rounded-xl border border-sage-300 bg-white px-3 py-2 shadow-2xl">
              <div className="flex items-center gap-2">
                <span>{typeStyle[activeDrag.type].icon}</span>
                <p className="truncate text-xs font-semibold">
                  {activeDrag.title}
                </p>
              </div>
              <p className="mt-1 text-[10px] font-medium text-sage-700">
                {activeDrag.action}
              </p>
            </div>
          )}
        </DragOverlay>
      </main>
    </DndContext>
  );
}
