import { describe, expect, it } from "vitest";
import type { TripItem } from "@/domain/models";
import { segmentConnectorTop } from "./TravelSegmentCard";

const value = (id: string, startAt: string, endAt: string): TripItem => ({
  id,
  tripId: "t",
  type: "place",
  title: id,
  description: null,
  startAt,
  endAt,
  latitude: 1,
  longitude: 2,
  address: null,
  placeId: "p",
  notes: null,
  sortOrder: 0,
  createdAt: "",
  updatedAt: "",
  flexibility: "flexible",
  schedulingConstraint: null,
  reservation: null,
});
describe("TravelSegmentCard layout", () => {
  it("positions a connector visibly midway between adjacent activities", () => {
    const a = value("a", "2026-01-01T10:00:00Z", "2026-01-01T11:00:00Z"),
      b = value("b", "2026-01-01T12:00:00Z", "2026-01-01T13:00:00Z");
    expect(segmentConnectorTop(a, b, "UTC", 64)).toBe(5.5 * 64);
  });
});
