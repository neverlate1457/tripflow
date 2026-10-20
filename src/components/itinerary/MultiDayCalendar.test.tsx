import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { demoItems, demoTrip } from "@/data/demo-trip";
import { buildItineraryOverview } from "@/domain/itinerary-overview";
import type { DayContext, TripItem } from "@/domain/models";
import type { TravelSegment } from "@/domain/routing";
import { layoutCalendarItems, MultiDayCalendar } from "./MultiDayCalendar";

const renderCalendar = (
  items: TripItem[] = demoItems,
  contexts: DayContext[] = [],
  segments: TravelSegment[] = [],
) =>
  renderToStaticMarkup(
    <MultiDayCalendar
      trip={demoTrip}
      days={buildItineraryOverview(demoTrip, items, contexts, segments)}
      allItems={items}
      selectedDate={demoTrip.startDate}
      onSelectDate={() => undefined}
    />,
  );

describe("Itinerary multi-day calendar", () => {
  it("renders dates horizontally, scheduled blocks, and empty days", () => {
    const html = renderCalendar();
    expect(html).toContain("Day 1");
    expect(html).toContain("Day 4");
    expect(html).toContain("Shuri Castle");
    expect(html).toContain("No scheduled plans");
    expect(html).toContain("06:00");
    expect(html).toContain("24:00");
  });

  it("lays overlapping activities into deterministic side-by-side lanes", () => {
    const overlapping = demoItems.filter((item) =>
      ["place-1", "restaurant-1", "place-2"].includes(item.id),
    );
    const first = layoutCalendarItems(overlapping, demoTrip.timezone);
    const second = layoutCalendarItems([...overlapping].reverse(), demoTrip.timezone);
    expect(first.map(({ item, lane, laneCount }) => [item.id, lane, laneCount])).toEqual(
      second.map(({ item, lane, laneCount }) => [item.id, lane, laneCount]),
    );
    expect(Math.max(...first.map((value) => value.lane))).toBeGreaterThan(0);
  });

  it("shows configured DayContext without fabricating missing fields", () => {
    const location = {
      name: "Naha Hotel",
      formattedAddress: "Naha, Japan",
      latitude: 26.21,
      longitude: 127.68,
      provider: "geoapify",
      providerPlaceId: "naha-hotel",
      timezone: "Asia/Tokyo",
    };
    const html = renderCalendar(demoItems, [
      {
        tripId: demoTrip.id,
        date: demoTrip.startDate,
        startLocation: null,
        baseLocation: location,
        endLocation: null,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    ]);
    expect(html).toContain("Base: Naha Hotel");
    expect(html).not.toContain("Start: Naha Hotel");
  });

  it("uses effective bound movement once and links activities back to Planner", () => {
    const a = demoItems.find((item) => item.id === "place-1")!;
    const b = demoItems.find((item) => item.id === "place-2")!;
    const bound: TripItem = {
      ...a,
      id: "bound-train",
      type: "transport",
      title: "JR Kyushu",
      startAt: a.endAt,
      endAt: b.startAt,
      transportDetails: {
        behavior: "replace_segment",
        mode: "train",
        service: "JR Kyushu",
        from: "A",
        to: "B",
        boundFromEndpoint: { kind: "trip_item", tripItemId: a.id },
        boundToEndpoint: { kind: "trip_item", tripItemId: b.id },
      },
    };
    const segment = {
      id: "a--b",
      tripId: demoTrip.id,
      date: "2026-10-25",
      fromEndpoint: { kind: "trip_item", tripItemId: a.id },
      toEndpoint: { kind: "trip_item", tripItemId: b.id },
      fromTripItemId: a.id,
      toTripItemId: b.id,
      mode: "driving",
      durationSeconds: 2460,
      durationOverrideMinutes: 50,
      effectiveDurationSeconds: 45 * 60,
      durationSource: "manual",
      movementSource: "bound_transport",
      boundTransportItemId: bound.id,
      boundTransportDepartureAt: bound.startAt,
      boundTransportArrivalAt: bound.endAt,
      boundTransportStatus: "active",
      distanceMeters: 32000,
      provider: "geoapify",
      calculatedAt: "2026-01-01T00:00:00Z",
      status: "loaded",
      error: null,
    } as TravelSegment;
    const html = renderCalendar([a, b, bound], [], [segment]);
    expect(html).toContain("JR Kyushu · train · 45 min · Manual");
    expect(html).not.toContain("Drive · 41 min");
    expect(html).toContain(`/trips/${demoTrip.id}?date=`);
    expect(html).not.toContain("itinerary-item-bound-train");
  });
});
