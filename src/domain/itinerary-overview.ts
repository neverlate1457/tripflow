import { isBoundTransport } from "./bound-transport";
import { analyzeDay, type DayFeasibility, type ScheduleIssue } from "./constraints";
import { isGroundedFlight } from "./flight";
import type { DayContext, Trip, TripItem } from "./models";
import type { TravelSegment } from "./routing";
import { durationMinutes, itemsForDate } from "./time";

export interface ItineraryDayView {
  date: string;
  dayNumber: number;
  items: TripItem[];
  movements: TravelSegment[];
  context: DayContext | null;
  feasibility: DayFeasibility;
}

export function tripDateKeys(startDate: string, endDate: string) {
  const dates: string[] = [];
  const cursor = new Date(`${startDate}T12:00:00Z`);
  const end = new Date(`${endDate}T12:00:00Z`);
  while (cursor <= end) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

/** Read-only projection. It never synthesizes or mutates canonical itinerary data. */
export function buildItineraryOverview(
  trip: Trip,
  items: TripItem[],
  dayContexts: DayContext[],
  travelSegments: TravelSegment[],
): ItineraryDayView[] {
  return tripDateKeys(trip.startDate, trip.endDate).map((date, index) => {
    const allDayItems = itemsForDate(items, date, trip.timezone);
    const visibleItems = allDayItems
      .filter((item) => !isBoundTransport(item))
      .sort((a, b) => a.startAt.localeCompare(b.startAt) || a.sortOrder - b.sortOrder || a.id.localeCompare(b.id));
    const movements = travelSegments.filter((segment) => segment.date === date);
    return {
      date,
      dayNumber: index + 1,
      items: visibleItems,
      movements,
      context: dayContexts.find((context) => context.date === date) ?? null,
      feasibility: analyzeDay(allDayItems, movements),
    };
  });
}

export function formatClockInZone(iso: string, timezone: string) {
  return new Intl.DateTimeFormat("en", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(iso));
}

export function flightDisplay(item: TripItem, tripTimezone: string) {
  const details = item.flightDetails;
  const grounded = isGroundedFlight(details);
  const originTimezone = details?.originAirport?.timezone ?? tripTimezone;
  const destinationTimezone = details?.destinationAirport?.timezone ?? tripTimezone;
  return {
    grounded,
    origin: details?.originAirport?.iataCode || details?.originAirport?.name || details?.origin || item.title,
    originName: details?.originAirport?.name ?? details?.origin ?? item.title,
    destination: details?.destinationAirport?.iataCode || details?.destinationAirport?.name || details?.destination || "Destination",
    destinationName: details?.destinationAirport?.name ?? details?.destination ?? "Destination",
    originTimezone,
    destinationTimezone,
    departureTime: formatClockInZone(item.startAt, originTimezone),
    arrivalTime: formatClockInZone(item.endAt, destinationTimezone),
    durationMinutes: durationMinutes(item),
    airline: details?.airline,
    flightNumber: details?.flightNumber,
  };
}

export const issueLabel = (issue: ScheduleIssue) => {
  switch (issue.code) {
    case "activity_overlap": return "Activities overlap";
    case "insufficient_travel": return "Not enough travel time";
    case "fixed_event_unreachable": return "Fixed activity may be unreachable";
    case "transport_departure_missed": return "Previous activity ends after transport departure";
    case "transport_arrival_late": return "Transport arrives after the next activity starts";
    case "before_earliest_start": return "Activity starts before its preferred window";
    case "after_latest_start": return "Activity starts after its preferred window";
    case "before_earliest_end": return "Activity ends before its preferred window";
    case "after_latest_end": return "Activity ends after its preferred window";
    case "malformed_window": return "Scheduling window needs attention";
    case "reservation_mismatch": return "Reservation time differs from the itinerary";
  }
};
