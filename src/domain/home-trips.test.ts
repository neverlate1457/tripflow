import { describe, expect, it } from "vitest";
import type { Trip } from "./models";
import {
  defaultHomeTripSort,
  defaultHomeTripView,
  parseHomeTripSort,
  parseHomeTripView,
  sortHomeTrips,
  tripHref,
} from "./home-trips";

const trip = (id: string, name: string, startDate: string): Trip => ({
  id,
  name,
  startDate,
  endDate: startDate,
  timezone: "Asia/Tokyo",
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
});

describe("home trip presentation", () => {
  const trips = [
    trip("guilin", "桂林", "2026-10-07"),
    trip("sapporo", "札幌", "2026-11-26"),
    trip("oita", "大分", "2026-10-30"),
  ];

  it("sorts canonical start dates in both directions", () => {
    expect(sortHomeTrips(trips, "date_asc").map((x) => x.id)).toEqual(["guilin", "oita", "sapporo"]);
    expect(sortHomeTrips(trips, "date_desc").map((x) => x.id)).toEqual(["sapporo", "oita", "guilin"]);
  });

  it("sorts multilingual and numeric names deterministically", () => {
    const values = [trip("b", "Trip 10", "2026-01-02"), trip("a", "Trip 2", "2026-01-03"), trip("c", "京都", "2026-01-01")];
    expect(sortHomeTrips(values, "name_asc").map((x) => x.id)).toEqual(sortHomeTrips([...values].reverse(), "name_asc").map((x) => x.id));
    expect(sortHomeTrips(values, "name_asc").findIndex((x) => x.id === "a")).toBeLessThan(sortHomeTrips(values, "name_asc").findIndex((x) => x.id === "b"));
  });

  it("uses name then stable id to break identical date ties", () => {
    const values = [trip("z", "Beta", "2026-01-01"), trip("b", "Alpha", "2026-01-01"), trip("a", "Alpha", "2026-01-01")];
    expect(sortHomeTrips(values, "date_asc").map((x) => x.id)).toEqual(["a", "b", "z"]);
  });

  it("does not mutate the source collection", () => {
    const source = [...trips];
    const before = source.map((x) => x.id);
    expect(sortHomeTrips(source, "date_desc")).not.toBe(source);
    expect(source.map((x) => x.id)).toEqual(before);
  });

  it("defaults to grid and earliest-first and safely parses saved preferences", () => {
    expect(defaultHomeTripSort).toBe("date_asc");
    expect(defaultHomeTripView).toBe("grid");
    expect(parseHomeTripSort("name_asc")).toBe("name_asc");
    expect(parseHomeTripView("list")).toBe("list");
    expect(parseHomeTripSort("stale")).toBe("date_asc");
    expect(parseHomeTripView("table")).toBe("grid");
  });

  it("uses the same trip navigation target for both presentations", () => {
    expect(tripHref(trips[0])).toBe("/trips/guilin");
  });

  it("handles an empty collection", () => expect(sortHomeTrips([], "date_asc")).toEqual([]));
});
