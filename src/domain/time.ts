import type { TripItem } from "./models";

export const DAY_START_MINUTES = 6 * 60;
export const DAY_END_MINUTES = 24 * 60;
export const SNAP_MINUTES = 15;
export const MIN_DURATION_MINUTES = 15;

export function snapMinutes(minutes: number, interval = SNAP_MINUTES): number {
  return Math.round(minutes / interval) * interval;
}

export function minutesToPosition(
  minutes: number,
  pixelsPerHour: number,
): number {
  return ((minutes - DAY_START_MINUTES) / 60) * pixelsPerHour;
}

export function positionToMinutes(
  position: number,
  pixelsPerHour: number,
): number {
  return snapMinutes(DAY_START_MINUTES + (position / pixelsPerHour) * 60);
}

export function clampStartMinutes(minutes: number, duration: number): number {
  return Math.max(
    DAY_START_MINUTES,
    Math.min(minutes, DAY_END_MINUTES - duration),
  );
}

export function localDateKey(iso: string, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(iso));
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export function minutesOfDay(iso: string, timezone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(iso));
  const value = (type: "hour" | "minute") =>
    Number(parts.find((part) => part.type === type)?.value ?? 0);
  return value("hour") * 60 + value("minute");
}

export function zonedDateTime(
  dateKey: string,
  minutes: number,
  timezone: string,
): string {
  const [year, month, day] = dateKey.split("-").map(Number);
  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;
  const utcGuess = Date.UTC(year, month - 1, day, hour, minute);
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    timeZoneName: "shortOffset",
    hour: "2-digit",
    hourCycle: "h23",
  });
  const offsetText =
    formatter
      .formatToParts(new Date(utcGuess))
      .find((part) => part.type === "timeZoneName")?.value ?? "GMT";
  const match = offsetText.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/);
  const offset = match
    ? (match[1] === "+" ? 1 : -1) *
      (Number(match[2]) * 60 + Number(match[3] ?? 0))
    : 0;
  return new Date(utcGuess - offset * 60_000).toISOString();
}

export function durationMinutes(
  item: Pick<TripItem, "startAt" | "endAt">,
): number {
  return (
    (new Date(item.endAt).getTime() - new Date(item.startAt).getTime()) / 60_000
  );
}

export function moveItem(
  item: TripItem,
  dateKey: string,
  startMinutes: number,
  timezone: string,
): TripItem {
  const duration = durationMinutes(item);
  const start = zonedDateTime(
    dateKey,
    clampStartMinutes(snapMinutes(startMinutes), duration),
    timezone,
  );
  return {
    ...item,
    startAt: start,
    endAt: new Date(
      new Date(start).getTime() + duration * 60_000,
    ).toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

export function resizeItem(
  item: TripItem,
  endMinutes: number,
  timezone: string,
): TripItem {
  const startMinutes = minutesOfDay(item.startAt, timezone);
  const boundedEnd = Math.min(DAY_END_MINUTES, snapMinutes(endMinutes));
  const duration = Math.max(MIN_DURATION_MINUTES, boundedEnd - startMinutes);
  return {
    ...item,
    endAt: new Date(
      new Date(item.startAt).getTime() + duration * 60_000,
    ).toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

export interface TripItemEdit {
  title?: string;
  type?: TripItem["type"];
  startMinutes?: number;
  endMinutes?: number;
  startDate?: string;
  endDate?: string;
  address?: string | null;
  notes?: string | null;
  flexibility?: TripItem["flexibility"];
  schedulingConstraint?: TripItem["schedulingConstraint"];
  reservation?: TripItem["reservation"];
  transportDetails?: TripItem["transportDetails"];
  flightDetails?: TripItem["flightDetails"];
  latitude?: number | null;
  longitude?: number | null;
  placeId?: string | null;
  provider?: string | null;
  locationSource?: TripItem["locationSource"];
  originalLocationInput?: string | null;
}

export function editTripItem(
  item: TripItem,
  edit: TripItemEdit,
  timezone: string,
): TripItem {
  const { startMinutes: editedStart, endMinutes: editedEnd, startDate: editedStartDate, endDate: editedEndDate, ...fields } = edit;
  const nextType = edit.type ?? item.type;
  const nextFlightDetails = edit.flightDetails ?? item.flightDetails;
  const startTimezone = nextType === "flight" ? nextFlightDetails?.originAirport?.timezone ?? timezone : timezone;
  const endTimezone = nextType === "flight" ? nextFlightDetails?.destinationAirport?.timezone ?? timezone : timezone;
  const dateKey = editedStartDate ?? localDateKey(item.startAt, startTimezone);
  const currentStart = minutesOfDay(item.startAt, startTimezone);
  const currentEnd = minutesOfDay(item.endAt, endTimezone);
  const exactTransportTime = nextType === "transport" || nextType === "flight";
  const startMinutes = exactTransportTime ? (editedStart ?? currentStart) : snapMinutes(editedStart ?? currentStart);
  const requestedEnd = exactTransportTime ? (editedEnd ?? currentEnd) : snapMinutes(editedEnd ?? currentEnd);
  const crossDate = editedStartDate !== undefined || editedEndDate !== undefined;
  const boundedStart = Math.max(
    DAY_START_MINUTES,
    Math.min(startMinutes, DAY_END_MINUTES - MIN_DURATION_MINUTES),
  );
  const boundedEnd = crossDate
    ? Math.max(0, Math.min(requestedEnd, DAY_END_MINUTES))
    : Math.min(DAY_END_MINUTES, Math.max(requestedEnd, boundedStart + MIN_DURATION_MINUTES));
  const startAt = zonedDateTime(dateKey, boundedStart, startTimezone);
  const endDateKey = editedEndDate ?? (editedStartDate ? editedStartDate : localDateKey(item.endAt, endTimezone));
  const explicitEndAt = zonedDateTime(endDateKey, boundedEnd, endTimezone);
  if (crossDate && Date.parse(explicitEndAt) - Date.parse(startAt) < MIN_DURATION_MINUTES * 60_000) throw new Error("INVALID_ITEM_CHRONOLOGY");
  return {
    ...item,
    ...fields,
    title: edit.title?.trim() || item.title,
    address: edit.address === undefined ? item.address : edit.address,
    notes: edit.notes === undefined ? item.notes : edit.notes,
    startAt,
    endAt: crossDate ? explicitEndAt : new Date(new Date(startAt).getTime() + (boundedEnd - boundedStart) * 60_000).toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

export function itemsForDate(
  items: TripItem[],
  dateKey: string,
  timezone: string,
): TripItem[] {
  return items.filter(
    (item) => localDateKey(item.startAt, timezone) === dateKey,
  );
}

export function overlaps(
  a: Pick<TripItem, "id" | "startAt" | "endAt">,
  b: Pick<TripItem, "id" | "startAt" | "endAt">,
): boolean {
  return (
    a.id !== b.id &&
    new Date(a.startAt) < new Date(b.endAt) &&
    new Date(b.startAt) < new Date(a.endAt)
  );
}

export function overlappingIds(items: TripItem[]): Set<string> {
  const ids = new Set<string>();
  for (let i = 0; i < items.length; i++)
    for (let j = i + 1; j < items.length; j++) {
      if (overlaps(items[i], items[j])) {
        ids.add(items[i].id);
        ids.add(items[j].id);
      }
    }
  return ids;
}

export function formatClock(minutes: number): string {
  if (minutes === 1440) return "24:00";
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}
