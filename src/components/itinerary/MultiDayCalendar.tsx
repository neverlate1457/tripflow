import { AlertTriangle, CheckCircle2, ChevronLeft, ChevronRight, MapPin } from "lucide-react";
import { useEffect, useMemo, useRef } from "react";
import type { Trip, TripItem } from "@/domain/models";
import type { ItineraryDayView } from "@/domain/itinerary-overview";
import { flightDisplay, formatClockInZone } from "@/domain/itinerary-overview";
import type { TravelSegment } from "@/domain/routing";
import {
  DAY_END_MINUTES,
  DAY_START_MINUTES,
  durationMinutes,
  formatClock,
  minutesOfDay,
  minutesToPosition,
} from "@/domain/time";
import { typeStyle } from "@/components/trip/type-style";
import { flightRouteLabel } from "@/domain/flight";

export const CALENDAR_PIXELS_PER_HOUR = 64;

interface CalendarPlacement {
  item: TripItem;
  lane: number;
  laneCount: number;
}

/** Deterministic presentation-only overlap layout; canonical items are untouched. */
export function layoutCalendarItems(items: TripItem[], timezone: string): CalendarPlacement[] {
  const sorted = [...items].sort(
    (a, b) =>
      new Date(a.startAt).getTime() - new Date(b.startAt).getTime() ||
      a.id.localeCompare(b.id),
  );
  const laneEnds: number[] = [];
  const placed = sorted.map((item) => {
    const start = minutesOfDay(item.startAt, timezone);
    const end = start + durationMinutes(item);
    let lane = laneEnds.findIndex((value) => value <= start);
    if (lane < 0) lane = laneEnds.length;
    laneEnds[lane] = end;
    return { item, lane };
  });
  const laneCount = Math.max(1, laneEnds.length);
  return placed.map((value) => ({ ...value, laneCount }));
}

function movementLabel(segment: TravelSegment, allItems: TripItem[]) {
  const bound = segment.boundTransportItemId
    ? allItems.find((item) => item.id === segment.boundTransportItemId)
    : null;
  if (segment.movementSource === "bound_transport" && bound) {
    const details = bound.transportDetails;
    return `${details?.service || bound.title} · ${details?.mode ?? "transport"} · ${Math.ceil((segment.effectiveDurationSeconds ?? 0) / 60)} min · Manual`;
  }
  if (segment.effectiveDurationSeconds == null) return "Travel time unavailable";
  const mode =
    segment.mode === "driving"
      ? "Drive"
      : segment.mode === "walking"
        ? "Walk"
        : segment.mode === "cycling"
          ? "Cycle"
          : "Transit";
  return `${mode} · ${Math.ceil(segment.effectiveDurationSeconds / 60)} min${segment.durationSource === "manual" ? " · Manual" : ""}`;
}

function contextSummary(day: ItineraryDayView) {
  const context = day.context;
  if (!context) return "";
  return [
    context.startLocation && `Start: ${context.startLocation.name}`,
    context.baseLocation && `Base: ${context.baseLocation.name}`,
    context.endLocation && `End: ${context.endLocation.name}`,
  ]
    .filter(Boolean)
    .join(" · ");
}

function CalendarItem({ item, trip, date, lane, laneCount }: CalendarPlacement & { trip: Trip; date: string }) {
  const start = minutesOfDay(item.startAt, trip.timezone);
  const duration = durationMinutes(item);
  const meta = typeStyle[item.type];
  const flight = item.type === "flight" ? flightDisplay(item, trip.timezone) : null;
  const displayStart = flight?.departureTime ?? formatClockInZone(item.startAt, trip.timezone);
  const displayEnd = flight?.arrivalTime ?? formatClockInZone(item.endAt, trip.timezone);
  const left = `${(lane / laneCount) * 100}%`;
  const width = `${100 / laneCount}%`;
  const primaryLabel = item.type === "flight" ? flightRouteLabel(item) : item.title;
  return (
    <a
      href={`/trips/${trip.id}?date=${encodeURIComponent(date)}&item=${encodeURIComponent(item.id)}`}
      id={`itinerary-item-${item.id}`}
      aria-label={`Edit ${primaryLabel}, ${displayStart} to ${displayEnd}`}
      className={`absolute z-10 overflow-hidden rounded-lg border px-2 py-1.5 shadow-sm transition hover:z-30 hover:shadow-md focus:z-30 focus:outline-none focus:ring-2 focus:ring-sage-600 ${meta.color}`}
      style={{
        top: minutesToPosition(start, CALENDAR_PIXELS_PER_HOUR),
        height: Math.max((duration / 60) * CALENDAR_PIXELS_PER_HOUR, 28),
        left: `calc(${left} + 3px)`,
        width: `calc(${width} - 6px)`,
      }}
    >
      <div className="flex min-w-0 items-start gap-1">
        <span aria-hidden="true" className="text-[10px]">{meta.icon}</span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[11px] font-semibold leading-4">{primaryLabel}</div>
          <div className="truncate text-[9px] tabular-nums opacity-75">{displayStart}–{displayEnd}</div>
          {flight?.grounded && <div className="truncate text-[8px] opacity-65">{[flight.airline, flight.flightNumber].filter(Boolean).join(" ") || `${flight.originName} → ${flight.destinationName}`}</div>}
          {!flight && item.address && <div className="mt-0.5 hidden items-center gap-0.5 truncate text-[8px] opacity-65 sm:flex"><MapPin size={8}/><span className="truncate">{item.address}</span></div>}
        </div>
      </div>
    </a>
  );
}

export function MultiDayCalendar({
  trip,
  days,
  allItems,
  selectedDate,
  onSelectDate,
}: {
  trip: Trip;
  days: ItineraryDayView[];
  allItems: TripItem[];
  selectedDate: string;
  onSelectDate: (date: string) => void;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const selectedIndex = Math.max(0, days.findIndex((day) => day.date === selectedDate));
  const calendarHeight = ((DAY_END_MINUTES - DAY_START_MINUTES) / 60) * CALENDAR_PIXELS_PER_HOUR;
  const template = `56px repeat(${days.length}, minmax(var(--itinerary-day-width), 1fr))`;
  const dayPlacements = useMemo(
    () => new Map(days.map((day) => [day.date, layoutCalendarItems(day.items, trip.timezone)])),
    [days, trip.timezone],
  );

  useEffect(() => {
    scroller.current
      ?.querySelector<HTMLElement>(`[data-day-header="${selectedDate}"]`)
      ?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "nearest" });
  }, [selectedDate]);

  const selectRelative = (offset: number) => {
    const next = days[Math.min(days.length - 1, Math.max(0, selectedIndex + offset))];
    if (next) onSelectDate(next.date);
  };

  return (
    <section aria-label="Multi-day itinerary calendar" className="min-w-0">
      <div className="mb-3 flex items-center justify-between gap-3 sm:hidden">
        <button aria-label="Previous day" disabled={selectedIndex === 0} onClick={() => selectRelative(-1)} className="rounded-lg border bg-white p-2 disabled:opacity-40"><ChevronLeft size={16}/></button>
        <span className="text-xs font-semibold">Day {selectedIndex + 1} of {days.length}</span>
        <button aria-label="Next day" disabled={selectedIndex === days.length - 1} onClick={() => selectRelative(1)} className="rounded-lg border bg-white p-2 disabled:opacity-40"><ChevronRight size={16}/></button>
      </div>
      <div ref={scroller} className="max-w-full overflow-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div
          role="grid"
          className="grid [--itinerary-day-width:calc(100vw-76px)] sm:[--itinerary-day-width:220px] lg:[--itinerary-day-width:190px]"
          style={{ minWidth: `calc(56px + ${days.length} * var(--itinerary-day-width))`, gridTemplateColumns: template }}
        >
          <div className="sticky left-0 top-0 z-50 border-b border-r bg-white" />
          {days.map((day) => {
            const summary = contextSummary(day);
            const boundarySummary = day.movements
              .filter(
                (segment) =>
                  segment.fromEndpoint.kind === "day_start" ||
                  segment.toEndpoint.kind === "day_end",
              )
              .map(
                (segment) =>
                  `${segment.fromEndpoint.kind === "day_start" ? "Start" : "End"} travel: ${movementLabel(segment, allItems)}`,
              )
              .join(" · ");
            const selected = day.date === selectedDate;
            return (
              <div key={`header-${day.date}`} data-day-header={day.date} className={`sticky top-0 z-40 min-w-0 border-b border-l px-2 py-2 ${selected ? "bg-sage-100 text-sage-950" : "bg-white"}`}>
                <button aria-pressed={selected} onClick={() => onSelectDate(day.date)} className="block w-full min-w-0 text-left">
                  <span className="block text-[9px] font-bold uppercase tracking-wider text-sage-700">Day {day.dayNumber}</span>
                  <span className="block text-xs font-semibold">{new Intl.DateTimeFormat("en", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${day.date}T12:00:00Z`))}</span>
                  {summary && <span className="mt-1 block whitespace-normal text-[8px] leading-3 text-slate-500">{summary}</span>}
                  {boundarySummary && <span className="mt-1 block whitespace-normal text-[8px] leading-3 text-sky-700">{boundarySummary}</span>}
                  <span className={`mt-1 flex items-center gap-1 text-[8px] font-medium ${day.feasibility.status === "ok" ? "text-emerald-700" : "text-amber-700"}`}>
                    {day.feasibility.status === "ok" ? <CheckCircle2 size={9}/> : <AlertTriangle size={9}/>} {day.feasibility.status === "ok" ? "Feasible" : `${day.feasibility.issues.length} issue${day.feasibility.issues.length === 1 ? "" : "s"}`}
                  </span>
                </button>
                <a href={`/trips/${trip.id}?date=${day.date}`} className="mt-1 inline-block text-[8px] font-semibold text-sage-700 hover:underline">Edit day in Planner</a>
              </div>
            );
          })}
          <div className="sticky left-0 z-30 border-r bg-white" style={{ height: calendarHeight }}>
            {Array.from({ length: 19 }, (_, index) => (
              <div key={index} className="absolute inset-x-0 border-t border-slate-200" style={{ top: index * CALENDAR_PIXELS_PER_HOUR }}>
                <span className="absolute -top-2 right-2 bg-white text-[9px] tabular-nums text-slate-400">{formatClock(DAY_START_MINUTES + index * 60)}</span>
              </div>
            ))}
          </div>
          {days.map((day) => (
            <div key={day.date} role="gridcell" aria-label={`Itinerary for ${day.date}`} className={`relative border-l ${day.date === selectedDate ? "bg-sage-50/30" : "bg-white"}`} style={{ height: calendarHeight }}>
              {Array.from({ length: 19 }, (_, index) => <div key={index} className="absolute inset-x-0 border-t border-slate-100" style={{ top: index * CALENDAR_PIXELS_PER_HOUR }}/>) }
              {(dayPlacements.get(day.date) ?? []).map((placement) => <CalendarItem key={placement.item.id} {...placement} trip={trip} date={day.date}/>) }
              {day.movements.map((segment) => {
                if (segment.fromEndpoint.kind !== "trip_item" || segment.toEndpoint.kind !== "trip_item") return null;
                const from = day.items.find((item) => item.id === segment.fromTripItemId);
                const to = day.items.find((item) => item.id === segment.toTripItemId);
                if (!from || !to) return null;
                const fromEnd = minutesOfDay(from.endAt, trip.timezone);
                const toStart = minutesOfDay(to.startAt, trip.timezone);
                if (toStart - fromEnd < 15) return null;
                const top = (fromEnd + toStart) / 2;
                return <div key={segment.id} title={movementLabel(segment, allItems)} className="absolute inset-x-2 z-20 -translate-y-1/2 truncate rounded-full border border-sky-200 bg-sky-50 px-1.5 py-0.5 text-center text-[8px] font-medium text-sky-800 shadow-sm" style={{ top: minutesToPosition(top, CALENDAR_PIXELS_PER_HOUR) }}>{movementLabel(segment, allItems)}</div>;
              })}
              {!day.items.length && <div className="absolute inset-x-3 top-16 rounded-lg border border-dashed border-slate-200 p-3 text-center text-[9px] text-slate-400">No scheduled plans</div>}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
