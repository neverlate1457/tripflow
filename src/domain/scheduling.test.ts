import { describe, expect, it, vi } from "vitest";
import type { Candidate } from "./models";
import {
  candidateToTripItem,
  tripItemToCandidate,
  unscheduleEligibility,
} from "./scheduling";
import { minutesOfDay } from "./time";

describe("candidate scheduling", () => {
  it("converts a candidate to a distinct TripItem with snapped time and duration", () => {
    vi.spyOn(Date, "now").mockReturnValue(42);
    const candidate: Candidate = {
      id: "c1",
      tripId: "t1",
      type: "restaurant",
      title: "Soba",
      latitude: 1,
      longitude: 2,
      address: "Naha",
      placeId: "p1",
      provider: "test",
      estimatedDuration: 52,
      notes: "Cash",
    };
    const item = candidateToTripItem(
      candidate,
      "2026-10-24",
      9 * 60 + 8,
      "Asia/Tokyo",
      "2026-01-01T00:00:00.000Z",
    );
    expect(item).toMatchObject({
      id: "item-c1-42",
      tripId: "t1",
      type: "restaurant",
      title: "Soba",
      notes: "Cash",
    });
    expect(item).toMatchObject({
      provider: "test",
      sourceCandidateId: "c1",
      placeId: "p1",
      latitude: 1,
      longitude: 2,
    });
    expect(minutesOfDay(item.startAt, "Asia/Tokyo")).toBe(9 * 60 + 15);
    expect(
      new Date(item.endAt).getTime() - new Date(item.startAt).getTime(),
    ).toBe(45 * 60_000);
    expect(candidate).not.toHaveProperty("startAt");
  });
  it("round-trips a provider-backed Candidate without losing identity or duration", () => {
    const candidate: Candidate = {
      id: "candidate-place",
      tripId: "trip",
      type: "place",
      title: "Beach",
      latitude: 24.1,
      longitude: 121.9,
      address: "Coast",
      placeId: "provider-place",
      provider: "geoapify",
      estimatedDuration: 90,
      notes: "Sunset",
    };
    const item = candidateToTripItem(
      candidate,
      "2026-11-14",
      14 * 60,
      "Asia/Taipei",
    );
    const restored = tripItemToCandidate(item);
    expect(restored).toEqual(candidate);
  });
  it("protects fixed, reserved, transport, note, and ungrounded items from unscheduling", () => {
    const base = candidateToTripItem(
      {
        id: "c",
        tripId: "t",
        type: "place",
        title: "Place",
        latitude: 1,
        longitude: 2,
        address: null,
        placeId: "p",
        provider: "geoapify",
        estimatedDuration: 60,
        notes: null,
      },
      "2026-11-14",
      12 * 60,
      "UTC",
    );
    expect(unscheduleEligibility(base)).toEqual({ eligible: true });
    for (const invalid of [
      { ...base, flexibility: "fixed" as const },
      { ...base, reservation: { id: "r", status: "confirmed" as const } },
      { ...base, type: "transport" as const },
      { ...base, type: "note" as const },
      { ...base, provider: null },
      { ...base, placeId: null },
    ])
      expect(unscheduleEligibility(invalid).eligible).toBe(false);
  });
});
