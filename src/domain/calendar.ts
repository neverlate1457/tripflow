import type { DayContext, Trip, TripItem } from "./models";
import type { TravelSegment } from "./routing";
import { DAY_START_MINUTES, clampStartMinutes, itemsForDate, snapMinutes } from "./time";

export interface CalendarDay {
  date: string;
  index: number;
  items: TripItem[];
  segments: TravelSegment[];
  context: DayContext | null;
}

export function tripCalendarDates(startDate: string, endDate: string) {
  const dates: string[] = [];
  for (let cursor = new Date(`${startDate}T12:00:00Z`), end = new Date(`${endDate}T12:00:00Z`); cursor <= end; cursor.setUTCDate(cursor.getUTCDate() + 1)) dates.push(cursor.toISOString().slice(0, 10));
  return dates;
}

export function buildCalendarDays(trip: Trip, items: TripItem[], segments: TravelSegment[], contexts: DayContext[]): CalendarDay[] {
  return tripCalendarDates(trip.startDate, trip.endDate).map((date, index) => ({
    date,
    index,
    items: itemsForDate(items, date, trip.timezone),
    segments: segments.filter((segment) => segment.date === date),
    context: contexts.find((context) => context.date === date) ?? null,
  }));
}

export function calendarDropMinutes(top: number, columnTop: number, pixelsPerHour: number, duration: number) {
  return clampStartMinutes(snapMinutes(DAY_START_MINUTES + ((top - columnTop) / pixelsPerHour) * 60), duration);
}
