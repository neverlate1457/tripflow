import { describe, expect, it } from "vitest";
import {
  createManualTripItem,
  validateManualItemInput,
  validateTransportDetails,
} from "./manual-items";
import type { Trip } from "./models";

const trip: Trip = {
  id: "trip",
  name: "Taiwan",
  startDate: "2026-11-14",
  endDate: "2026-11-16",
  timezone: "Asia/Taipei",
  createdAt: "2026-01-01",
  updatedAt: "2026-01-01",
};
const base = {
  title: "Museum",
  type: "place" as const,
  startDate: "2026-11-14",
  startMinutes: 601,
  endDate: "2026-11-14",
  endMinutes: 664,
  address: "Taipei",
  notes: "Manual",
  reservation: null,
  transportDetails: null,
  flightDetails: null,
};

describe("manual itinerary items", () => {
  it("persists a confirmed manual location as routable canonical coordinates", () => {
    const item = createManualTripItem({ ...base, location: { displayName: "Taipei Main Station", originalInput: "台北車站", formattedAddress: "Taipei Main Station, Taiwan", latitude: 25.0478, longitude: 121.517, provider: "geoapify", providerPlaceId: "taipei-main", source: "manual" } }, trip);
    expect(item).toMatchObject({ latitude: 25.0478, longitude: 121.517, address: "Taipei Main Station, Taiwan", provider: "geoapify", placeId: "taipei-main", locationSource: "manual", originalLocationInput: "台北車站" });
  });
  it.each(["place", "restaurant", "hotel", "note"] as const)(
    "creates a canonical %s item with snapped times",
    (type) => {
      const item = createManualTripItem({ ...base, type }, trip, "2026-01-02");
      expect(item).toMatchObject({
        tripId: "trip",
        type,
        provider: null,
        sourceCandidateId: null,
        placeId: null,
      });
      expect(item.startAt).toBe("2026-11-14T02:00:00.000Z");
      expect(item.endAt).toBe("2026-11-14T03:00:00.000Z");
    },
  );
  it("stores explicit transport mode and endpoints", () => {
    const item = createManualTripItem(
      {
        ...base,
        type: "transport",
        title: "",
        transportDetails: {
          mode: "ferry",
          from: "A",
          to: "B",
          service: "Line",
        },
      },
      trip,
    );
    expect(item).toMatchObject({
      title: "A → B",
      transportDetails: { mode: "ferry", from: "A", to: "B", service: "Line" },
    });
  });
  it("accepts transport without a manual title or optional metadata", () => {
    const item = createManualTripItem(
      {
        ...base,
        type: "transport",
        title: undefined,
        address: undefined,
        notes: undefined,
        transportDetails: { mode: "train", from: "宜蘭", to: "台北" },
      },
      trip,
    );
    expect(item).toMatchObject({
      title: "宜蘭 → 台北",
      address: null,
      notes: null,
      transportDetails: { mode: "train", from: "宜蘭", to: "台北" },
    });
  });
  it("accepts same-day and cross-midnight transport", () => {
    expect(
      createManualTripItem(
        {
          ...base,
          type: "transport",
          title: "",
          transportDetails: { mode: "bus", from: "A", to: "B" },
        },
        trip,
      ).type,
    ).toBe("transport");
    const overnight = createManualTripItem(
      {
        ...base,
        type: "transport",
        title: "",
        startMinutes: 23 * 60 + 30,
        endDate: "2026-11-15",
        endMinutes: 60,
        transportDetails: { mode: "ferry", from: "A", to: "B" },
      },
      trip,
    );
    expect(Date.parse(overnight.endAt) - Date.parse(overnight.startAt)).toBe(
      90 * 60_000,
    );
  });
  it("returns field-specific transport and time errors", () => {
    expect(
      validateTransportDetails({ mode: "train", from: "", to: "B" }),
    ).toEqual({ from: "Enter an origin." });
    expect(
      validateTransportDetails({ mode: "train", from: "A", to: "" }),
    ).toEqual({ to: "Enter a destination." });
    expect(
      validateTransportDetails({
        mode: "invalid" as "train",
        from: "A",
        to: "B",
      }),
    ).toEqual({ mode: "Choose a transport mode." });
    expect(
      validateManualItemInput(
        {
          ...base,
          type: "transport",
          title: "",
          endMinutes: 600,
          transportDetails: { mode: "train", from: "A", to: "B" },
        },
        trip,
      ).endTime,
    ).toMatch(/Arrival must be after/);
    expect(
      validateManualItemInput(
        {
          ...base,
          type: "transport",
          title: "",
          startMinutes: Number.NaN,
          transportDetails: { mode: "train", from: "A", to: "B" },
        },
        trip,
      ).startTime,
    ).toBe("Choose a departure time.");
  });
  it("stores flight metadata and permits a cross-day interval", () => {
    const item = createManualTripItem(
      {
        ...base,
        type: "flight",
        title: "",
        endDate: "2026-11-15",
        endMinutes: 60,
        flightDetails: {
          origin: "TPE",
          destination: "OKA",
          airline: "EVA",
          flightNumber: "BR112",
        },
      },
      trip,
    );
    expect(item).toMatchObject({
      title: "TPE → OKA",
      flightDetails: { flightNumber: "BR112" },
    });
  });
  it("rejects invalid intervals, trip dates, transport, and flights", () => {
    expect(() =>
      createManualTripItem({ ...base, endMinutes: 600 }, trip),
    ).toThrow("Arrival must be after departure");
    expect(() =>
      createManualTripItem(
        { ...base, startDate: "2026-11-17", endDate: "2026-11-17" },
        trip,
      ),
    ).toThrow("Departure date is outside the trip");
    expect(() =>
      createManualTripItem(
        {
          ...base,
          type: "transport",
          transportDetails: { mode: "train", from: "", to: "B" },
        },
        trip,
      ),
    ).toThrow("Enter an origin");
    expect(() =>
      createManualTripItem(
        {
          ...base,
          type: "flight",
          flightDetails: { origin: "TPE", destination: "" },
        },
        trip,
      ),
    ).toThrow("Enter a destination");
  });
});
