import { describe, expect, it } from "vitest";
import { buildCalendarDays, calendarDropMinutes, tripCalendarDates } from "./calendar";
import { moveItem } from "./time";
import type { Trip, TripItem } from "./models";

const trip: Trip = { id: "t", name: "Trip", startDate: "2026-10-30", endDate: "2026-11-02", timezone: "Asia/Tokyo", createdAt: "", updatedAt: "" };
const item: TripItem = { id: "i", tripId: "t", type: "place", title: "A", description: null, startAt: "2026-10-30T00:00:00.000Z", endAt: "2026-10-30T01:00:00.000Z", latitude: null, longitude: null, address: null, provider: null, placeId: null, notes: null, sortOrder: 0, flexibility: "flexible", schedulingConstraint: null, reservation: null, transportDetails: null, flightDetails: null, createdAt: "", updatedAt: "" };

describe("multi-day calendar projection", () => {
  it("builds every trip date and groups canonical items", () => {
    expect(tripCalendarDates(trip.startDate, trip.endDate)).toEqual(["2026-10-30", "2026-10-31", "2026-11-01", "2026-11-02"]);
    const days = buildCalendarDays(trip, [item], [], []);
    expect(days).toHaveLength(4);
    expect(days[0].items.map((value) => value.id)).toEqual(["i"]);
    expect(days[1].items).toEqual([]);
  });

  it("maps vertical pointer position to the shared 15-minute scale", () => {
    expect(calendarDropMinutes(70, 0, 60, 60)).toBe(7 * 60 + 15);
  });

  it("moves an item across dates atomically while preserving duration", () => {
    const moved = moveItem(item, "2026-10-31", 10 * 60 + 7, trip.timezone);
    expect(buildCalendarDays(trip, [moved], [], [])[1].items[0].id).toBe("i");
    expect(new Date(moved.endAt).getTime() - new Date(moved.startAt).getTime()).toBe(60 * 60_000);
  });

  it("keeps DayContext and segments date-scoped", () => {
    const context = { tripId: "t", date: "2026-10-31", startLocation: null, baseLocation: null, endLocation: null, createdAt: "", updatedAt: "" };
    const days = buildCalendarDays(trip, [], [{ id: "s", date: "2026-10-31" } as never], [context]);
    expect(days[0]).toMatchObject({ context: null, segments: [] });
    expect(days[1].context).toBe(context);
    expect(days[1].segments).toHaveLength(1);
  });
});
