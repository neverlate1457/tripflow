import { describe, expect, it } from "vitest";
import type { DayContext, TripItem } from "./models";
import { deriveSegmentSpecs, feasibility, isValidDurationOverride, resolveEffectiveDuration, routeCacheKey } from "./routing";

const item = (
  id: string,
  startAt: string,
  endAt: string,
  latitude: number | null = 26.2,
  longitude: number | null = 127.7,
  type: TripItem["type"] = "place",
): TripItem => ({
  id,
  tripId: "t",
  type,
  title: id,
  description: null,
  startAt,
  endAt,
  latitude,
  longitude,
  address: null,
  placeId: null,
  notes: null,
  sortOrder: 0,
  createdAt: "",
  updatedAt: "",
  flexibility: "flexible",
  schedulingConstraint: null,
  reservation: null,
});
const place = (name: string, latitude: number, longitude: number) => ({ name, formattedAddress: null, latitude, longitude, provider: "geoapify", providerPlaceId: name, timezone: "Asia/Tokyo" });
const context = (values: Partial<DayContext> = {}): DayContext => ({ tripId: "t", date: "2026-01-01", startLocation: null, baseLocation: null, endLocation: null, createdAt: "", updatedAt: "", ...values });
describe("travel segment domain", () => {
  it("resolves provider and manual effective duration without mutating evidence", () => {
    expect(resolveEffectiveDuration(41 * 60, null)).toEqual({ providerDurationSeconds: 41 * 60, durationOverrideMinutes: null, effectiveDurationSeconds: 41 * 60, durationSource: "provider" });
    expect(resolveEffectiveDuration(41 * 60, 50)).toMatchObject({ providerDurationSeconds: 41 * 60, effectiveDurationSeconds: 50 * 60, durationSource: "manual" });
    expect(resolveEffectiveDuration(41 * 60, 30)).toMatchObject({ providerDurationSeconds: 41 * 60, effectiveDurationSeconds: 30 * 60, durationSource: "manual" });
    expect(resolveEffectiveDuration(41 * 60, null).effectiveDurationSeconds).toBe(41 * 60);
    expect(resolveEffectiveDuration(null, 55)).toMatchObject({ providerDurationSeconds: null, effectiveDurationSeconds: 55 * 60, durationSource: "manual" });
  });
  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 1441])("rejects invalid duration override %s", (value) => {
    expect(isValidDurationOverride(value)).toBe(false);
    expect(() => resolveEffectiveDuration(60, value)).toThrow("INVALID_DURATION_OVERRIDE");
  });
  it("derives Start, internal, and End edges without fake TripItem IDs", () => {
    const values = [item("a", "2026-01-01T09:00:00Z", "2026-01-01T10:00:00Z"), item("b", "2026-01-01T11:00:00Z", "2026-01-01T12:00:00Z")];
    const specs = deriveSegmentSpecs(values, "UTC", [context({ startLocation: place("Start", 1, 2), endLocation: place("End", 3, 4) })]);
    expect(specs).toHaveLength(3);
    expect(specs.map((x) => [x.fromEndpoint.kind, x.toEndpoint.kind])).toEqual([["day_start", "trip_item"], ["trip_item", "trip_item"], ["trip_item", "day_end"]]);
    expect(specs[0].fromTripItemId).toBeNull();
    expect(specs[2].toTripItemId).toBeNull();
  });
  it("supports only Start or only End while retaining internal edges", () => {
    const values = [item("a", "2026-01-01T09:00:00Z", "2026-01-01T10:00:00Z"), item("b", "2026-01-01T11:00:00Z", "2026-01-01T12:00:00Z")];
    expect(deriveSegmentSpecs(values, "UTC", [context({ startLocation: place("Start", 1, 2) })]).map((x) => x.fromEndpoint.kind)).toEqual(["day_start", "trip_item"]);
    expect(deriveSegmentSpecs(values, "UTC", [context({ endLocation: place("End", 3, 4) })]).map((x) => x.toEndpoint.kind)).toEqual(["trip_item", "day_end"]);
  });
  it("ignores Base and creates no direct boundary route for an empty day", () => {
    expect(deriveSegmentSpecs([item("a", "2026-01-01T09:00:00Z", "2026-01-01T10:00:00Z")], "UTC", [context({ baseLocation: place("Base", 1, 2) })])).toHaveLength(0);
    expect(deriveSegmentSpecs([], "UTC", [context({ startLocation: place("Start", 1, 2), endLocation: place("End", 3, 4) })])).toHaveLength(0);
  });
  it("changes only the corresponding boundary evidence when coordinates change", () => {
    const values = [item("a", "2026-01-01T09:00:00Z", "2026-01-01T10:00:00Z"), item("b", "2026-01-01T11:00:00Z", "2026-01-01T12:00:00Z")], initial = context({ startLocation: place("Start", 1, 2), baseLocation: place("Base", 5, 6), endLocation: place("End", 3, 4) });
    const keys = (day: DayContext) => deriveSegmentSpecs(values, "UTC", [day]).map((spec) => routeCacheKey("geoapify", { origin: spec.origin, destination: spec.destination, mode: "driving" }));
    const before = keys(initial), changedStart = keys({ ...initial, startLocation: place("Start 2", 1.1, 2) }), changedBase = keys({ ...initial, baseLocation: place("Base 2", 9, 9) }), changedEnd = keys({ ...initial, endLocation: place("End 2", 3.1, 4) });
    expect(changedStart[0]).not.toBe(before[0]); expect(changedStart.slice(1)).toEqual(before.slice(1));
    expect(changedBase).toEqual(before);
    expect(changedEnd.at(-1)).not.toBe(before.at(-1)); expect(changedEnd.slice(0, -1)).toEqual(before.slice(0, -1));
  });
  it("derives chronological adjacent segments", () => {
    const values = [
      item("c", "2026-01-01T06:00:00Z", "2026-01-01T07:00:00Z"),
      item("a", "2026-01-01T01:00:00Z", "2026-01-01T02:00:00Z"),
      item("b", "2026-01-01T03:00:00Z", "2026-01-01T04:00:00Z"),
    ];
    expect(deriveSegmentSpecs(values, "UTC").map((x) => x.id)).toEqual([
      "a--b",
      "b--c",
    ]);
  });
  it("excludes missing coordinates and locationless notes", () => {
    expect(
      deriveSegmentSpecs(
        [
          item("a", "2026-01-01T01:00:00Z", "2026-01-01T02:00:00Z"),
          item(
            "note",
            "2026-01-01T02:00:00Z",
            "2026-01-01T03:00:00Z",
            26,
            127,
            "note",
          ),
          item("b", "2026-01-01T04:00:00Z", "2026-01-01T05:00:00Z", null),
        ],
        "UTC",
      ),
    ).toHaveLength(0);
  });
  it.each(["transport", "flight", "note"] as const)(
    "treats an explicit %s as a routing boundary",
    (type) => {
      const values = [
        item("a", "2026-01-01T01:00:00Z", "2026-01-01T02:00:00Z"),
        item(
          "boundary",
          "2026-01-01T03:00:00Z",
          "2026-01-01T04:00:00Z",
          26,
          127,
          type,
        ),
        item("b", "2026-01-01T05:00:00Z", "2026-01-01T06:00:00Z"),
      ];
      expect(deriveSegmentSpecs(values, "UTC")).toHaveLength(0);
    },
  );
  it("treats a coordinate-less manual activity as a routing boundary", () => {
    const values = [
      item("a", "2026-01-01T01:00:00Z", "2026-01-01T02:00:00Z"),
      item(
        "manual",
        "2026-01-01T03:00:00Z",
        "2026-01-01T04:00:00Z",
        null,
        null,
      ),
      item("b", "2026-01-01T05:00:00Z", "2026-01-01T06:00:00Z"),
    ];
    expect(deriveSegmentSpecs(values, "UTC")).toHaveLength(0);
  });
  it("never connects across dates", () => {
    expect(
      deriveSegmentSpecs(
        [
          item("a", "2026-01-01T22:00:00Z", "2026-01-01T23:00:00Z"),
          item("b", "2026-01-02T01:00:00Z", "2026-01-02T02:00:00Z"),
        ],
        "UTC",
      ),
    ).toHaveLength(0);
  });
  it("reconnects neighbors after deletion", () => {
    const values = [
      item("a", "2026-01-01T01:00:00Z", "2026-01-01T02:00:00Z"),
      item("b", "2026-01-01T03:00:00Z", "2026-01-01T04:00:00Z"),
      item("c", "2026-01-01T05:00:00Z", "2026-01-01T06:00:00Z"),
    ];
    expect(
      deriveSegmentSpecs(
        values.filter((x) => x.id !== "b"),
        "UTC",
      )[0].id,
    ).toBe("a--c");
  });
  it.each([
    [3600, 1800, "feasible"],
    [1800, 1800, "exact"],
    [1200, 1800, "insufficient"],
  ] as const)(
    "calculates %s second gap as %s travel => %s",
    (gap, duration, state) => {
      const from = item("a", "2026-01-01T00:00:00Z", "2026-01-01T01:00:00Z"),
        to = item(
          "b",
          new Date(new Date(from.endAt).getTime() + gap * 1000).toISOString(),
          "2026-01-01T04:00:00Z",
        );
      expect(feasibility(from, to, duration).state).toBe(state);
    },
  );
  it("cache key hits identical requests and invalidates mode or coordinates", () => {
    const base = {
      origin: { latitude: 1, longitude: 2 },
      destination: { latitude: 3, longitude: 4 },
      mode: "driving" as const,
    };
    expect(routeCacheKey("geoapify", base)).toBe(
      routeCacheKey("geoapify", { ...base }),
    );
    expect(routeCacheKey("geoapify", base)).not.toBe(
      routeCacheKey("geoapify", { ...base, mode: "walking" }),
    );
    expect(routeCacheKey("geoapify", base)).not.toBe(
      routeCacheKey("geoapify", {
        ...base,
        destination: { latitude: 3.1, longitude: 4 },
      }),
    );
  });
});
