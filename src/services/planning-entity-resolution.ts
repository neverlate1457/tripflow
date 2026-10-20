import { resolveDateText, type IntentInterpretation, type PlanningAIInput } from "@/domain/ai-planning";
import { groundTemporalExpression, temporalInterpretationFailure, type TemporalGrounding } from "@/domain/temporal-grounding";
import { normalizeBoundedCountToken } from "@/domain/quantity";

const schedulingPattern = /找(?:一個)?.{0,16}時間|安排(?:到)?|排到|排進|排入|排一下|幫我排|find\s+(?:a\s+)?time\s+for|schedule|fit\s+into|add\s+to\s+my\s+afternoon|plan\s+a\s+time\s+for/i;
const wholeCollectionPattern = /這些想去的地方|want\s+to\s+go\s+(?:裡|里|中)?(?:的)?這些|these\s+places\s+in\s+want\s+to\s+go|(?:all\s+)?the\s+places\s+i\s+saved/i;
const countedCollectionPattern = /(?:這|这)?\s*([一二兩两三四五\d]+)\s*(?:個|个|間|间|處|处)?\s*(?:want\s+to\s+go\s*(?:的)?地方|想去的地方|地方|景點|景点)|want\s+to\s+go.{0,12}(?:這|这)?\s*([一二兩两三四五\d]+)|these\s+(one|two|three|four|five|\d+)\s+places|the\s+(one|two|three|four|five|\d+)\s+places\s+i\s+saved/i;
const genericPluralCollectionPattern = /(?:幾|几)\s*(?:個|个|間|间|處|处)?\s*(?:want\s+to\s+go\s*(?:的)?地方|想去的地方|地方|景點|景点)|(?:several|a few|some)\s+(?:want\s+to\s+go\s+)?places/i;

export const normalizeCandidateTitle = (value: string) => value.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase().replace(/[\p{P}\p{S}\s]+/gu, "");

export interface EntityResolution {
  scheduling: boolean;
  matchedTitles: Array<{ title: string; normalized: string; candidateIds: string[] }>;
  resolvedCandidateIds: string[];
  pluralResolution: "none" | "all" | "count_exact" | "ambiguous";
  ambiguityReason: string | null;
  timeWindow?: { start: string; end: string };
  temporal: TemporalGrounding;
  deterministicInterpretation?: IntentInterpretation;
}

export function resolvePlanningEntities(input: PlanningAIInput): EntityResolution {
  const { message, context } = input, scheduling = schedulingPattern.test(message), normalizedMessage = normalizeCandidateTitle(message), grouped = new Map<string, typeof context.candidates>();
  for (const candidate of context.candidates) { const key = normalizeCandidateTitle(candidate.title); grouped.set(key, [...(grouped.get(key) ?? []), candidate]); }
  const matchedTitles = [...grouped].filter(([title]) => title.length > 0 && normalizedMessage.includes(title)).map(([normalized, values]) => ({ title: values[0].title, normalized, candidateIds: values.map((x) => x.id) }));
  const uniqueNamed = matchedTitles.filter((x) => x.candidateIds.length === 1), ambiguousNamed = matchedTitles.filter((x) => x.candidateIds.length > 1), temporal = groundTemporalExpression(message, context), window = temporal.timeWindow;
  let resolvedCandidateIds = uniqueNamed.map((x) => x.candidateIds[0]), pluralResolution: EntityResolution["pluralResolution"] = "none", ambiguityReason: string | null = ambiguousNamed.length ? "Multiple Candidates have the same normalized title." : null;
  const countMatch = message.match(countedCollectionPattern), countText = countMatch?.slice(1).find(Boolean), count = normalizeBoundedCountToken(countText), genericPlural = genericPluralCollectionPattern.test(message);
  if (count && scheduling) {
    if (context.candidates.length === count) { resolvedCandidateIds = context.candidates.map((x) => x.id); pluralResolution = "count_exact"; ambiguityReason = null; }
    else { resolvedCandidateIds = []; pluralResolution = "ambiguous"; ambiguityReason = `The request refers to ${count} saved places, but ${context.candidates.length} Candidates are in Want to go.`; }
  } else if (wholeCollectionPattern.test(message) && scheduling) { resolvedCandidateIds = context.candidates.map((x) => x.id); pluralResolution = "all"; ambiguityReason = null; }
  if (!scheduling) return { scheduling, matchedTitles, resolvedCandidateIds: [], pluralResolution, ambiguityReason: null, timeWindow: window, temporal };
  if ((ambiguityReason || genericPlural) && scheduling) {
    const date=resolveDateText(message,context), exact=count&&count>=2?count:undefined, maximum=Math.min(5,context.candidates.length);
    return { scheduling, matchedTitles, resolvedCandidateIds: [], pluralResolution: "ambiguous", ambiguityReason: ambiguityReason ?? "The request refers to multiple saved places without identifying which ones.", timeWindow: window, temporal, deterministicInterpretation: { status: "clarification_required", question: exact ? `Select exactly ${exact} saved places to schedule.` : "Select the saved places TripFlow should schedule.", selectionMode: "multiple", minSelections: exact ?? 2, maxSelections: exact ?? maximum, candidateScheduling: { date, timeWindow: window ?? {start:"12:00",end:"18:00"} }, options: context.candidates.slice(0,5).map((x) => ({ id: x.id, label: x.title, candidateId: x.id })) } };
  }
  if (!resolvedCandidateIds.length) return { scheduling, matchedTitles, resolvedCandidateIds, pluralResolution, ambiguityReason: "No canonical Candidate reference could be resolved.", timeWindow: window, temporal };
  const temporalFailure = temporalInterpretationFailure(temporal);
  if (temporalFailure) return { scheduling, matchedTitles, resolvedCandidateIds, pluralResolution, ambiguityReason: temporal.reason, timeWindow: window, temporal, deterministicInterpretation: temporalFailure };
  const date = resolveDateText(message, context), effectiveWindow = window;
  const intent = resolvedCandidateIds.length === 1
    ? { type: "insert_candidate" as const, candidateId: resolvedCandidateIds[0], date, ...(effectiveWindow ? { timeWindow: effectiveWindow } : {}) }
    : { type: "insert_candidates" as const, candidateIds: resolvedCandidateIds, date, timeWindow: effectiveWindow ?? { start: "06:00", end: "23:45" } };
  return { scheduling, matchedTitles, resolvedCandidateIds, pluralResolution, ambiguityReason: null, timeWindow: effectiveWindow, temporal, deterministicInterpretation: { status: "resolved", intent, summary: resolvedCandidateIds.length === 1 ? `Find a time for ${context.candidates.find((x) => x.id === resolvedCandidateIds[0])?.title} on ${date}.` : `Find one schedule for ${resolvedCandidateIds.length} saved places on ${date}.` } };
}
