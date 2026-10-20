import type { AITripContext, IntentInterpretation } from "./ai-planning";

export type TemporalDaypart =
  | "morning"
  | "afternoon"
  | "evening"
  | "overnight"
  | "am"
  | "pm";

export interface TemporalExtraction {
  originalPhrase: string;
  dateReference?: string;
  startExpression?: string;
  endExpression?: string;
  startDaypart?: TemporalDaypart;
  endDaypart?: TemporalDaypart;
  explicit24HourEvidence: boolean;
}

export interface TemporalGrounding {
  status: "none" | "resolved" | "ambiguous" | "unsupported" | "invalid";
  extraction: TemporalExtraction;
  resolvedDate: string;
  timeWindow?: { start: string; end: string };
  timezone: string;
  reason: string;
}

const rangePattern = /((?:(?:早上|上午|下午|晚上|今晚|凌晨)\s*)?\d{1,2}(?::\d{2})?\s*(?:點|点)?(?:\s*(?:am|pm))?)\s*(?:到|至|[-–—]|\bto\b)\s*((?:(?:早上|上午|下午|晚上|今晚|凌晨)\s*)?\d{1,2}(?::\d{2})?\s*(?:點|点)?(?:\s*(?:am|pm))?)/iu;

const dateReference = (message: string) =>
  message.match(/後天|后天|明天|今天|今晚|tomorrow|today|day\s*\d+|\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}|oct(?:ober)?\s+\d{1,2}/iu)?.[0];

function addDays(value: string, days: number) {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function resolveTemporalDate(message: string, context: AITripContext) {
  const lower = message.toLowerCase();
  if (/後天|后天|day after tomorrow/.test(lower)) return addDays(context.selectedDate, 2);
  if (/tomorrow|明天/.test(lower)) return addDays(context.selectedDate, 1);
  const day = lower.match(/day\s*(\d+)/i);
  if (day) return addDays(context.trip.startDate, Number(day[1]) - 1);
  const iso = lower.match(/\b(\d{4}-\d{2}-\d{2})\b/);
  if (iso) return iso[1];
  const slash = lower.match(/\b(\d{1,2})\/(\d{1,2})\b/);
  if (slash) return `${context.trip.startDate.slice(0, 4)}-${slash[1].padStart(2, "0")}-${slash[2].padStart(2, "0")}`;
  const month = lower.match(/oct(?:ober)?\s+(\d{1,2})/);
  if (month) return `${context.trip.startDate.slice(0, 4)}-10-${month[1].padStart(2, "0")}`;
  return context.selectedDate;
}

function endpoint(expression: string) {
  const value = expression.toLowerCase();
  const daypart: TemporalDaypart | undefined = /凌晨/.test(value)
    ? "overnight"
    : /下午/.test(value)
      ? "afternoon"
      : /晚上|今晚|tonight|evening/.test(value)
        ? "evening"
        : /早上|上午|morning/.test(value)
          ? "morning"
          : /pm\b/.test(value)
            ? "pm"
            : /am\b/.test(value)
              ? "am"
              : undefined;
  const clock = value.match(/(\d{1,2})(?::(\d{2}))?/);
  if (!clock) return null;
  const hour = Number(clock[1]), minute = Number(clock[2] ?? 0);
  return {
    expression: expression.trim(),
    daypart,
    hour,
    minute,
    colon: expression.includes(":"),
    explicit24: hour > 12,
  };
}

function normalizeClock(value: NonNullable<ReturnType<typeof endpoint>>, inherited?: TemporalDaypart) {
  const part = value.daypart ?? inherited;
  if (value.minute > 59 || value.hour > 23 || value.hour < 0) return null;
  if ((part === "am" || part === "pm") && (value.hour < 1 || value.hour > 12)) return null;
  let hour = value.hour;
  if (part === "am") hour = hour === 12 ? 0 : hour;
  if (part === "pm") hour = hour === 12 ? 12 : hour + 12;
  if (part === "afternoon" || part === "evening") hour = hour === 12 ? 12 : hour < 12 ? hour + 12 : hour;
  if (part === "morning") hour = hour === 12 ? 0 : hour;
  if (part === "overnight") hour = hour === 12 ? 0 : hour;
  if (hour > 23) return null;
  return `${String(hour).padStart(2, "0")}:${String(value.minute).padStart(2, "0")}`;
}

export function groundTemporalExpression(message: string, context: AITripContext): TemporalGrounding {
  const resolvedDate = resolveTemporalDate(message, context), timezone = context.trip.timezone;
  const match = message.match(rangePattern);
  const extraction: TemporalExtraction = {
    originalPhrase: match?.[0] ?? message,
    dateReference: dateReference(message),
    startExpression: match?.[1]?.trim(),
    endExpression: match?.[2]?.trim(),
    explicit24HourEvidence: false,
  };
  if (!match) {
    const generic = /下午|afternoon/i.test(message)
      ? { start: "12:00", end: "18:00" }
      : /晚上|今晚|evening|tonight/i.test(message)
        ? { start: "18:00", end: "23:00" }
        : undefined;
    return { status: generic ? "resolved" : "none", extraction, resolvedDate, ...(generic ? { timeWindow: generic } : {}), timezone, reason: generic ? "daypart_default_window" : "no_time_window" };
  }
  const start = endpoint(match[1]), end = endpoint(match[2]);
  if (!start || !end) return { status: "invalid", extraction, resolvedDate, timezone, reason: "malformed_time_window" };
  extraction.startDaypart = start.daypart;
  extraction.endDaypart = end.daypart;
  extraction.explicit24HourEvidence = start.explicit24 || end.explicit24 || start.colon || end.colon;
  const inheritedEnd = !end.daypart && start.daypart ? start.daypart : undefined;
  const normalizedStart = normalizeClock(start), normalizedEnd = normalizeClock(end, inheritedEnd);
  if (!normalizedStart || !normalizedEnd) return { status: "invalid", extraction, resolvedDate, timezone, reason: "malformed_time_window" };
  if (start.daypart === "evening" && end.daypart === "overnight" && normalizedEnd <= normalizedStart)
    return { status: "unsupported", extraction, resolvedDate, timezone, reason: "cross_midnight_not_supported" };
  const lacksDaypart = !start.daypart && !end.daypart;
  if (lacksDaypart && !start.colon && !end.colon && !start.explicit24 && !end.explicit24)
    return { status: "ambiguous", extraction, resolvedDate, timezone, reason: "unqualified_12_hour_range" };
  if (normalizedEnd <= normalizedStart)
    return { status: start.daypart && !end.daypart && !end.explicit24 ? "ambiguous" : start.daypart || end.daypart || extraction.explicit24HourEvidence ? "unsupported" : "ambiguous", extraction, resolvedDate, timezone, reason: start.daypart && !end.daypart && !end.explicit24 ? "partial_daypart_inversion" : "inverted_or_cross_midnight_window" };
  return { status: "resolved", extraction, resolvedDate, timeWindow: { start: normalizedStart, end: normalizedEnd }, timezone, reason: inheritedEnd ? "shared_leading_daypart" : "explicit_temporal_evidence" };
}

export function temporalInterpretationFailure(value: TemporalGrounding): IntentInterpretation | null {
  if (value.status === "ambiguous") return { status: "clarification_required", question: "你指的是哪一個明確的開始與結束時間？請加上上午、下午、晚上或 AM/PM。" };
  if (value.status === "unsupported") return { status: "unsupported", reason: value.reason === "cross_midnight_not_supported" ? "TripFlow does not currently support a scheduling window that crosses midnight." : "The requested time window is inverted or crosses midnight and cannot be scheduled safely." };
  if (value.status === "invalid") return { status: "clarification_required", question: "TripFlow could not validate that time window. Please provide both times with AM/PM or a 24-hour clock." };
  return null;
}
