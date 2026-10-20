import type { Candidate, Trip, TripItem } from "./models";
import type { ScheduleIssue } from "./constraints";
import type { ScheduleProposal } from "./planning";
import type { TravelMode } from "./routing";
import type { DiscoverPlacesIntent } from "./discovery";
import { resolveTemporalDate } from "./temporal-grounding";
import type { TravelRerankInput } from "./travel-relevance";

export const AI_LIMITS = {
  maxMessageLength: 500,
  maxContextItems: 50,
  timeoutMs: 15000,
} as const;
export type Pace = "relaxed" | "balanced" | "compact";
export type PlanningIntent =
  | {
      type: "repair_day";
      date: string;
      timeWindow?: { start: string; end: string };
      preferences?: { pace?: Pace };
      targetItemId?: string;
      targetStartTime?: string;
    }
  | {
      type: "insert_candidate";
      candidateId: string;
      date: string;
      durationMinutes?: number;
      travelMode?: Exclude<TravelMode, "transit">;
      timeWindow?: { start: string; end: string };
    }
  | {
      type: "insert_candidates";
      candidateIds: string[];
      date: string;
      travelMode?: Exclude<TravelMode, "transit">;
      timeWindow: { start: string; end: string };
    }
  | { type: "explain_issues"; date: string }
  | { type: "explain_proposal"; proposalId: string }
  | DiscoverPlacesIntent;
export type ClarificationOption = {
  id: string;
  label: string;
  candidateId?: string;
};
export type IntentInterpretation =
  | { status: "resolved"; intent: PlanningIntent; summary?: string }
  | {
      status: "clarification_required";
      question: string;
      options?: ClarificationOption[];
      selectionMode?: "single" | "multiple";
      minSelections?: number;
      maxSelections?: number;
      candidateScheduling?: {
        date: string;
        timeWindow: { start: string; end: string };
        travelMode?: Exclude<TravelMode, "transit">;
      };
    }
  | { status: "unsupported"; reason: string };
export const validClarificationSelectionCount = (count:number,min:number,max:number) => Number.isInteger(count)&&count>=min&&count<=max;
export interface AITripContext {
  trip: {
    id: string;
    name: string;
    timezone: string;
    startDate: string;
    endDate: string;
  };
  selectedDate: string;
  items: Array<{
    id: string;
    title: string;
    type: string;
    date: string;
    flexibility: "fixed" | "flexible";
  }>;
  candidates: Array<{
    id: string;
    title: string;
    type: string;
    estimatedDuration: number;
  }>;
  issues: Array<{ code: string; severity: string; itemIds: string[] }>;
  proposalIds: string[];
}
export interface PlanningAIInput {
  message: string;
  context: AITripContext;
}
export interface PlanningExplanationInput {
  kind: "issues" | "proposal";
  facts: unknown;
  locale?: string;
}
export interface PlanningAIProvider {
  readonly metadata: { provider: string; model: string };
  interpretIntent(
    input: PlanningAIInput,
    signal?: AbortSignal,
  ): Promise<unknown>;
  repairIntent?(
    input: PlanningAIInput,
    invalidOutput: unknown,
    validationIssue: string,
    signal?: AbortSignal,
  ): Promise<unknown>;
  explain?(
    input: PlanningExplanationInput,
    signal?: AbortSignal,
  ): Promise<{
    text: string;
    usage?: { inputTokens?: number; outputTokens?: number };
  }>;
  rerankPlaces?(input: TravelRerankInput, signal?: AbortSignal): Promise<unknown>;
}
export const localDate = (iso: string, timezone: string) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
export function buildAIContext(
  trip: Trip,
  items: TripItem[],
  candidates: Candidate[],
  selectedDate: string,
  issues: ScheduleIssue[] = [],
  proposals: ScheduleProposal[] = [],
): AITripContext {
  return {
    trip: {
      id: trip.id,
      name: trip.name,
      timezone: trip.timezone,
      startDate: trip.startDate,
      endDate: trip.endDate,
    },
    selectedDate,
    items: items
      .slice(0, AI_LIMITS.maxContextItems)
      .map((x) => ({
        id: x.id,
        title: x.title,
        type: x.type,
        date: localDate(x.startAt, trip.timezone),
        flexibility: x.flexibility,
      })),
    candidates: candidates
      .slice(0, AI_LIMITS.maxContextItems)
      .map((x) => ({
        id: x.id,
        title: x.title,
        type: x.type,
        estimatedDuration: x.estimatedDuration,
      })),
    issues: issues
      .slice(0, AI_LIMITS.maxContextItems)
      .map((x) => ({
        code: x.code,
        severity: x.severity,
        itemIds: x.tripItemIds,
      })),
    proposalIds: proposals.slice(0, 5).map((x) => x.id),
  };
}
const exactKeys = (value: Record<string, unknown>, keys: string[]) =>
  Object.keys(value).every((key) => keys.includes(key));
const validDate = (date: string, context: AITripContext) =>
  /^\d{4}-\d{2}-\d{2}$/.test(date) &&
  date >= context.trip.startDate &&
  date <= context.trip.endDate;
export function validateInterpretation(
  raw: unknown,
  context: AITripContext,
): IntentInterpretation {
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    throw new Error("INVALID_AI_OUTPUT");
  const value = raw as Record<string, unknown>;
  if (value.status === "clarification_required") {
    if (
      !exactKeys(value, ["status", "question", "options", "selectionMode", "minSelections", "maxSelections", "candidateScheduling"]) ||
      typeof value.question !== "string" ||
      !value.question.trim()
    )
      throw new Error("INVALID_AI_OUTPUT");
    if (value.selectionMode !== undefined && !["single", "multiple"].includes(String(value.selectionMode))) throw new Error("INVALID_AI_OUTPUT");
    if (value.selectionMode === "multiple") {
      const min = value.minSelections, max = value.maxSelections;
      if (!Number.isInteger(min) || !Number.isInteger(max) || Number(min) < 2 || Number(max) > 5 || Number(min) > Number(max)) throw new Error("INVALID_AI_OUTPUT");
      const scheduling = value.candidateScheduling as Record<string, unknown> | undefined;
      if (!scheduling || !exactKeys(scheduling, ["date", "timeWindow", "travelMode"]) || typeof scheduling.date !== "string" || !validDate(scheduling.date, context) || !scheduling.timeWindow || typeof scheduling.timeWindow !== "object") throw new Error("INVALID_AI_OUTPUT");
      const window = scheduling.timeWindow as Record<string, unknown>;
      if (!exactKeys(window, ["start", "end"]) || typeof window.start !== "string" || typeof window.end !== "string") throw new Error("INVALID_AI_OUTPUT");
    }
    const options = value.options;
    if (
      options !== undefined &&
      (!Array.isArray(options) ||
        options.some(
          (x) =>
            !x ||
            typeof x !== "object" ||
            typeof (x as ClarificationOption).id !== "string" ||
            typeof (x as ClarificationOption).label !== "string",
        ))
    )
      throw new Error("INVALID_AI_OUTPUT");
    return value as IntentInterpretation;
  }
  if (value.status === "unsupported") {
    if (
      !exactKeys(value, ["status", "reason"]) ||
      typeof value.reason !== "string"
    )
      throw new Error("INVALID_AI_OUTPUT");
    return value as IntentInterpretation;
  }
  if (
    value.status !== "resolved" ||
    !exactKeys(value, ["status", "intent", "summary"]) ||
    !value.intent ||
    typeof value.intent !== "object"
  )
    throw new Error("INVALID_AI_OUTPUT");
  const intent = value.intent as Record<string, unknown>;
  if (intent.type === "repair_day") {
    if (
      !exactKeys(intent, ["type", "date", "timeWindow", "preferences", "targetItemId", "targetStartTime"]) ||
      typeof intent.date !== "string" ||
      !validDate(intent.date, context)
    )
      throw new Error("INVALID_INTENT");
    if (intent.timeWindow !== undefined && !validTimeWindow(intent.timeWindow))
      throw new Error("INVALID_INTENT");
    if (
      intent.preferences !== undefined &&
      (!intent.preferences ||
        typeof intent.preferences !== "object" ||
        !exactKeys(intent.preferences as Record<string, unknown>, ["pace"]) ||
        !["relaxed", "balanced", "compact"].includes(
          String((intent.preferences as { pace?: unknown }).pace),
        ))
    )
      throw new Error("INVALID_INTENT");
    if (
      (intent.targetItemId === undefined) !== (intent.targetStartTime === undefined) ||
      (intent.targetItemId !== undefined && !context.items.some((item) => item.id === intent.targetItemId)) ||
      (intent.targetStartTime !== undefined && (typeof intent.targetStartTime !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(intent.targetStartTime)))
    )
      throw new Error("INVALID_INTENT");
  } else if (intent.type === "insert_candidate") {
    if (
      !exactKeys(intent, [
        "type",
        "candidateId",
        "date",
        "durationMinutes",
        "travelMode",
        "timeWindow",
      ]) ||
      typeof intent.candidateId !== "string" ||
      !context.candidates.some((x) => x.id === intent.candidateId) ||
      typeof intent.date !== "string" ||
      !validDate(intent.date, context)
    )
      throw new Error("INVALID_INTENT");
    if (
      intent.durationMinutes !== undefined &&
      (typeof intent.durationMinutes !== "number" ||
        intent.durationMinutes < 15 ||
        intent.durationMinutes > 720 ||
        intent.durationMinutes % 15 !== 0)
    )
      throw new Error("INVALID_INTENT");
    if (intent.timeWindow !== undefined && !validTimeWindow(intent.timeWindow))
      throw new Error("INVALID_INTENT");
    if (intent.travelMode !== undefined && !["driving", "walking", "cycling"].includes(String(intent.travelMode)))
      throw new Error("INVALID_INTENT");
  } else if (intent.type === "insert_candidates") {
    if (
      !exactKeys(intent, ["type", "candidateIds", "date", "travelMode", "timeWindow"]) ||
      !Array.isArray(intent.candidateIds) ||
      intent.candidateIds.length < 2 ||
      intent.candidateIds.length > 5 ||
      new Set(intent.candidateIds).size !== intent.candidateIds.length ||
      intent.candidateIds.some((id) => typeof id !== "string" || !context.candidates.some((x) => x.id === id)) ||
      typeof intent.date !== "string" ||
      !validDate(intent.date, context) ||
      !validTimeWindow(intent.timeWindow)
    ) throw new Error("INVALID_INTENT");
    if (intent.travelMode !== undefined && !["driving", "walking", "cycling"].includes(String(intent.travelMode)))
      throw new Error("INVALID_INTENT");
  } else if (intent.type === "discover_places") {
    const categories = [
        "attraction",
        "museum",
        "park",
        "beach",
        "viewpoint",
        "shopping",
        "restaurant",
        "cafe",
        "nightlife",
        "parking",
      ],
      themes = [
        "seaside",
        "scenic",
        "local_food",
        "relaxing",
        "rainy_day",
        "shopping",
        "culture",
        "history",
      ];
    if (
      !exactKeys(intent, [
        "type",
        "date",
        "timeWindow",
        "query",
        "categories",
        "preferences",
        "durationMinutes",
        "travelMode",
        "geographicReference",
        "corridorReference",
        "maxDetourMinutes",
        "geographicScope",
      ]) ||
      typeof intent.date !== "string" ||
      !validDate(intent.date, context)
    )
      throw new Error("INVALID_INTENT");
    if (
      intent.categories !== undefined &&
      (!Array.isArray(intent.categories) ||
        intent.categories.some((x) => !categories.includes(String(x))))
    )
      throw new Error("INVALID_INTENT");
    if (intent.geographicReference !== undefined && (!intent.geographicReference || typeof intent.geographicReference !== "object" || !exactKeys(intent.geographicReference as Record<string, unknown>, ["text"]) || typeof (intent.geographicReference as { text?: unknown }).text !== "string" || !(intent.geographicReference as { text: string }).text.trim() || (intent.geographicReference as { text: string }).text.length > 80)) throw new Error("INVALID_INTENT");
    if (intent.corridorReference !== undefined &&
      (!intent.corridorReference || typeof intent.corridorReference !== "object" ||
        !exactKeys(intent.corridorReference as Record<string, unknown>, ["originText", "destinationText"]) ||
        typeof (intent.corridorReference as { originText?: unknown }).originText !== "string" ||
        typeof (intent.corridorReference as { destinationText?: unknown }).destinationText !== "string" ||
        !(intent.corridorReference as { originText: string }).originText.trim() ||
        !(intent.corridorReference as { destinationText: string }).destinationText.trim() ||
        intent.geographicReference !== undefined)) throw new Error("INVALID_INTENT");
    if (intent.maxDetourMinutes !== undefined &&
      (typeof intent.maxDetourMinutes !== "number" || intent.maxDetourMinutes < 0 || intent.maxDetourMinutes > 180))
      throw new Error("INVALID_INTENT");
    if (intent.geographicScope !== undefined && !["city_area", "nearby_point", "corridor", "trip_context"].includes(intent.geographicScope as string)) throw new Error("INVALID_INTENT");
    if (intent.geographicScope === "corridor" && !intent.corridorReference) throw new Error("INVALID_INTENT");
    if (intent.geographicScope === "city_area" && !intent.geographicReference) throw new Error("INVALID_INTENT");
    if (intent.geographicScope === "trip_context" && (intent.geographicReference || intent.corridorReference)) throw new Error("INVALID_INTENT");
    if (
      intent.timeWindow !== undefined &&
      (!intent.timeWindow ||
        typeof intent.timeWindow !== "object" ||
        !exactKeys(intent.timeWindow as Record<string, unknown>, [
          "start",
          "end",
        ]) ||
        Object.values(intent.timeWindow as object).some(
          (x) => typeof x !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(x),
        ))
    )
      throw new Error("INVALID_INTENT");
    if (
      intent.preferences !== undefined &&
      (!intent.preferences ||
        typeof intent.preferences !== "object" ||
        !exactKeys(intent.preferences as Record<string, unknown>, [
          "themes",
          "indoorOutdoor",
        ]) ||
        ((intent.preferences as { themes?: unknown[] }).themes?.some(
          (x) => !themes.includes(String(x)),
        ) ??
          false) ||
        ((intent.preferences as { indoorOutdoor?: unknown }).indoorOutdoor !==
          undefined &&
          !["indoor", "outdoor", "either"].includes(
            String(
              (intent.preferences as { indoorOutdoor?: unknown }).indoorOutdoor,
            ),
          )))
    )
      throw new Error("INVALID_INTENT");
    if (
      intent.durationMinutes !== undefined &&
      (typeof intent.durationMinutes !== "number" ||
        intent.durationMinutes < 15 ||
        intent.durationMinutes > 480 ||
        intent.durationMinutes % 15 !== 0)
    )
      throw new Error("INVALID_INTENT");
    if (
      intent.travelMode !== undefined &&
      !["driving", "walking", "cycling"].includes(String(intent.travelMode))
    )
      throw new Error("INVALID_INTENT");
  } else if (intent.type === "explain_issues") {
    if (
      !exactKeys(intent, ["type", "date"]) ||
      typeof intent.date !== "string" ||
      !validDate(intent.date, context)
    )
      throw new Error("INVALID_INTENT");
  } else if (intent.type === "explain_proposal") {
    if (
      !exactKeys(intent, ["type", "proposalId"]) ||
      typeof intent.proposalId !== "string" ||
      !context.proposalIds.includes(intent.proposalId)
    )
      throw new Error("INVALID_INTENT");
  } else throw new Error("INVALID_INTENT");
  return {
    status: "resolved",
    intent: intent as PlanningIntent,
    summary: typeof value.summary === "string" ? value.summary : undefined,
  };
}

export function describeInterpretationValidationIssue(raw: unknown) {
  if (!raw || typeof raw !== "object") return "The result must be an object matching the supplied schema.";
  const intent = (raw as { intent?: unknown }).intent;
  if (!intent || typeof intent !== "object") return "A resolved result must contain one structured intent.";
  const value = intent as Record<string, unknown>;
  if (value.type === "discover_places") {
    const issues: string[] = [];
    if (typeof value.date !== "string")
      issues.push("discover_places requires date; use the supplied selectedDate when the user omitted a date");
    if (!Array.isArray(value.categories))
      issues.push("discover_places requires categories as a bounded array; infer the requested bounded category and use an empty array only for genuinely generic discovery");
    if (typeof value.geographicScope !== "string")
      issues.push("discover_places requires exactly one geographicScope matching the user's request");
    if (value.geographicReference && value.corridorReference)
      issues.push("use geographicReference for one named place or corridorReference for two endpoints, never both");
    if (value.geographicScope === "corridor" && (!value.corridorReference || value.geographicReference))
      issues.push("corridor scope requires corridorReference with separate originText and destinationText, and forbids geographicReference");
    if (["nearby_point", "city_area"].includes(String(value.geographicScope)) && (!value.geographicReference || value.corridorReference))
      issues.push("nearby_point and city_area require one geographicReference and forbid corridorReference");
    if (value.geographicScope === "trip_context" && (value.geographicReference || value.corridorReference))
      issues.push("trip_context forbids explicit geographicReference and corridorReference");
    if (issues.length) return `${issues.join("; ")}.`;
  }
  return "The result failed TripFlow's strict runtime intent validation; conform exactly to the supplied schema and do not add unknown fields.";
}

export function validateProviderInterpretationContract(raw: unknown) {
  const value = raw as { status?: unknown; intent?: Record<string, unknown> } | null;
  if (value?.status === "resolved" && value.intent?.type === "discover_places") {
    if (!Array.isArray(value.intent.categories) || typeof value.intent.geographicScope !== "string")
      throw new Error("INVALID_INTENT");
  }
}

export function normalizeProviderOutputStructure(raw: unknown, selectedDate?: string): unknown {
  if (!raw || typeof raw !== "object") return raw;
  const value = raw as { status?: unknown; intent?: Record<string, unknown> };
  if (value.status !== "resolved" || !value.intent) return raw;
  let intent = value.intent;
  if (selectedDate && intent.type !== "explain_proposal" && typeof intent.date !== "string")
    intent = { ...intent, date: selectedDate };
  if (intent.type === "discover_places" && !intent.geographicScope && intent.corridorReference && !intent.geographicReference)
    intent = { ...intent, geographicScope: "corridor" };
  return intent === value.intent ? raw : { ...value, intent };
}

function validTimeWindow(value: unknown): value is { start: string; end: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const window = value as Record<string, unknown>, clock = /^([01]\d|2[0-3]):[0-5]\d$/;
  return exactKeys(window, ["start", "end"]) && typeof window.start === "string" && typeof window.end === "string" && clock.test(window.start) && clock.test(window.end) && window.start < window.end;
}
export function resolveDateText(message: string, context: AITripContext) {
  return resolveTemporalDate(message, context);
}
export function deterministicIssueExplanation(issues: AITripContext["issues"]) {
  if (!issues.length) return "No scheduling issues are currently detected.";
  const labels: Record<string, string> = {
    activity_overlap: "activities overlap",
    insufficient_travel: "there is not enough travel time",
    fixed_event_unreachable: "a fixed event cannot be reached in time",
    before_earliest_start: "an activity starts before its window",
    after_latest_start: "an activity starts after its window",
    reservation_mismatch: "a reservation time differs from the itinerary",
  };
  return issues
    .map(
      (x) =>
        `${x.severity === "error" ? "Error" : "Warning"}: ${labels[x.code] ?? x.code.replaceAll("_", " ")}.`,
    )
    .join(" ");
}
export function deterministicProposalExplanation(proposal: ScheduleProposal) {
  const m = proposal.after;
  return `This proposal moves ${m.modifiedItemCount} ${m.modifiedItemCount === 1 ? "activity" : "activities"} by ${m.totalMovementMinutes} minutes total, resolves ${m.errorsResolved + m.warningsResolved} issues, and leaves ${m.errorsRemaining + m.warningsRemaining}. Travel changes from ${m.travelTimeBeforeMinutes ?? "unknown"} to ${m.travelTimeAfterMinutes ?? "unknown"} minutes; minimum buffer is ${m.minimumBufferMinutes ?? "unknown"} minutes. Confidence: ${proposal.confidence}.`;
}
