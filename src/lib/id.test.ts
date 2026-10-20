import { afterEach, describe, expect, it, vi } from "vitest";
import { createManualTripItem } from "@/domain/manual-items";
import { placeToCandidate } from "@/domain/places";
import type { Trip } from "@/domain/models";
import { generateId, isUuidV4 } from "./id";

afterEach(() => vi.unstubAllGlobals());
const fallback = {
  getRandomValues<T extends ArrayBufferView | null>(array: T) {
    const bytes = array as Uint8Array;
    for (let index = 0; index < bytes.length; index++)
      bytes[index] = (index * 17 + cryptoCounter++) % 256;
    return array;
  },
  randomUUID: undefined,
};
let cryptoCounter = 1;
const trip: Trip = {
  id: "t",
  name: "Trip",
  startDate: "2026-11-14",
  endDate: "2026-11-15",
  timezone: "Asia/Taipei",
  createdAt: "",
  updatedAt: "",
};
describe("generateId", () => {
  it("uses native randomUUID when available", () => {
    const randomUUID = vi.fn(
      () =>
        "11111111-1111-4111-8111-111111111111" as `${string}-${string}-${string}-${string}-${string}`,
    );
    expect(generateId({ randomUUID, getRandomValues: vi.fn() })).toBe(
      randomUUID.mock.results[0].value,
    );
    expect(randomUUID).toHaveBeenCalledOnce();
  });
  it("uses getRandomValues for distinct RFC 4122 v4 IDs without window", () => {
    cryptoCounter = 1;
    const first = generateId(fallback),
      second = generateId(fallback);
    expect(isUuidV4(first)).toBe(true);
    expect(isUuidV4(second)).toBe(true);
    expect(first).not.toBe(second);
  });
  it("keeps Transport, Flight, and Candidate creation working without randomUUID", () => {
    cryptoCounter = 1;
    vi.stubGlobal("crypto", fallback);
    const common = {
      startDate: "2026-11-14",
      startMinutes: 600,
      endDate: "2026-11-14",
      endMinutes: 660,
      reservation: null,
    };
    expect(
      createManualTripItem(
        {
          ...common,
          type: "transport",
          transportDetails: { mode: "train", from: "宜蘭", to: "台北" },
        },
        trip,
      ).title,
    ).toBe("宜蘭 → 台北");
    expect(
      createManualTripItem(
        {
          ...common,
          type: "flight",
          flightDetails: { origin: "TPE", destination: "FUK" },
        },
        trip,
      ).title,
    ).toBe("TPE → FUK");
    expect(
      placeToCandidate(
        {
          provider: "test",
          providerPlaceId: "p",
          name: "Place",
          location: { latitude: 1, longitude: 2 },
        },
        trip.id,
      ).id,
    ).toMatch(/^[0-9a-f-]{36}$/);
  });
});
