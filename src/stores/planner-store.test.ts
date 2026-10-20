import { beforeEach, describe, expect, it } from "vitest";
import { demoCandidates, demoItems, demoTrip } from "@/data/demo-trip";
import type { TripSnapshot } from "@/services/trip-repository";
import type { TripPersistence } from "@/services/client-trip-persistence";
import { createPlannerStore } from "./planner-store";
import type { PlaceSearchClient } from "@/services/client-place-search";
import type { NormalizedPlace } from "@/domain/models";
import type { RoutingClient } from "@/services/client-routing";
import type { RouteRequest, SegmentSpec } from "@/domain/routing";
import type { ScheduleProposal } from "@/domain/planning";
import { createDayContext } from "@/domain/day-context";

class MemoryPersistence implements TripPersistence {
  saves: TripSnapshot[] = [];
  failLoad = false;
  failSave = false;
  constructor(
    public snapshot: TripSnapshot = {
      trip: demoTrip,
      items: demoItems,
      candidates: demoCandidates,
      segmentPreferences: [],
    },
  ) {}
  async loadTrip() {
    if (this.failLoad) throw new Error("offline");
    return structuredClone(this.snapshot);
  }
  async saveTrip(snapshot: TripSnapshot) {
    if (this.failSave) throw new Error("offline");
    this.snapshot = structuredClone(snapshot);
    this.saves.push(structuredClone(snapshot));
  }
}
class DeferredSearch implements PlaceSearchClient {
  requests: Array<{
    query: string;
    resolve: (value: NormalizedPlace[]) => void;
  }> = [];
  search(query: string) {
    return new Promise<NormalizedPlace[]>((resolve) =>
      this.requests.push({ query, resolve }),
    );
  }
}
class MemoryRouting implements RoutingClient {
  calls: Array<{ from: string; to: string; request: RouteRequest }> = [];
  fail = false;
  async route(_trip: string, segment: SegmentSpec, request: RouteRequest) {
    this.calls.push({ from: segment.id, to: segment.id, request });
    if (this.fail) throw new Error("route offline");
    return {
      provider: "test",
      ...request,
      durationSeconds: request.mode === "walking" ? 900 : 300,
      distanceMeters: 1000,
      geometry: {
        type: "LineString" as const,
        coordinates: [
          [request.origin.longitude, request.origin.latitude],
          [request.destination.longitude, request.destination.latitude],
        ] as [number, number][],
      },
    };
  }
}

describe("planner store persistence and history", () => {
  it("persists a bound Transport atomically, rejects duplicates, and restores it through undo/redo", async () => {
    const a = { ...demoItems.find((item) => item.type === "place")!, id: "edge-a", tripId: demoTrip.id, startAt: `${demoTrip.startDate}T01:00:00.000Z`, endAt: `${demoTrip.startDate}T02:00:00.000Z`, latitude: 25, longitude: 121 };
    const b = { ...a, id: "edge-b", title: "B", startAt: `${demoTrip.startDate}T03:00:00.000Z`, endAt: `${demoTrip.startDate}T04:00:00.000Z`, latitude: 25.1, longitude: 121.1 };
    const local = new MemoryPersistence({ trip: demoTrip, items: [a,b], candidates: [], segmentPreferences: [{ tripId: demoTrip.id, fromEndpointKey: "trip-item:edge-a", toEndpointKey: "trip-item:edge-b", travelMode: "driving", durationOverrideMinutes: 50 }] });
    const routing = new MemoryRouting(), store = createPlannerStore(local, new DeferredSearch(), routing);
    await store.getState().hydrate(demoTrip.id);
    const beforeCalls = routing.calls.length;
    const input = { type: "transport" as const, startDate: demoTrip.startDate, startMinutes: 10 * 60 + 20, endDate: demoTrip.startDate, endMinutes: 11 * 60 + 25, transportDetails: { behavior: "replace_segment" as const, mode: "train" as const, from: "A", to: "B", service: "JR", boundFromEndpoint: { kind: "trip_item" as const, tripItemId: "edge-a" }, boundToEndpoint: { kind: "trip_item" as const, tripItemId: "edge-b" } }, reservation: null };
    const created = await store.getState().createItem(input);
    expect(store.getState().travelSegments[0]).toMatchObject({ movementSource: "bound_transport", effectiveDurationSeconds: 65 * 60, durationOverrideMinutes: 50, boundTransportItemId: created.id });
    expect(routing.calls.length).toBe(beforeCalls);
    await expect(store.getState().createItem(input)).rejects.toThrow("DUPLICATE_TRANSPORT_BINDING");
    await store.getState().undo();
    expect(store.getState().travelSegments[0]).toMatchObject({ movementSource: "manual_duration", effectiveDurationSeconds: 50 * 60 });
    await store.getState().redo();
    expect(store.getState().tripItems.find((item) => item.id === created.id)?.transportDetails?.behavior).toBe("replace_segment");
  });
  it("hydrates, persists, clears, and isolates DayContexts without itinerary history", async () => {
    const context = createDayContext(demoTrip, demoTrip.startDate, { startLocation: null, baseLocation: { name: "Oita", formattedAddress: "Oita, Japan", latitude: 33.2, longitude: 131.6, provider: "geoapify", providerPlaceId: "oita", timezone: "Asia/Tokyo" }, endLocation: null }, "2026-01-01T00:00:00Z");
    const persistence = new MemoryPersistence({ trip: demoTrip, items: [], candidates: [], segmentPreferences: [], dayContexts: [context] }), store = createPlannerStore(persistence, new DeferredSearch(), new MemoryRouting());
    await store.getState().hydrate(demoTrip.id);
    expect(store.getState().dayContexts).toEqual([context]);
    await store.getState().setDayContext({ ...context, baseLocation: null, updatedAt: "2026-01-02T00:00:00Z" });
    expect(store.getState().dayContexts).toEqual([]);
    expect(store.getState().past).toEqual([]);
    persistence.snapshot = { trip: { ...demoTrip, id: "other" }, items: [], candidates: [], segmentPreferences: [], dayContexts: [] };
    await store.getState().hydrate("other");
    expect(store.getState().dayContexts).toEqual([]);
  });
  let persistence: MemoryPersistence;
  beforeEach(() => {
    persistence = new MemoryPersistence();
  });

  it("manually schedules a grounded map place as one canonical operation", async () => {
    const store = createPlannerStore(persistence);
    await store.getState().hydrate(demoTrip.id);
    const place: NormalizedPlace = { provider: "geoapify", providerPlaceId: "map-place-1", name: "犬吠埼燈台", location: { latitude: 35.7, longitude: 140.8 }, address: "Choshi" };
    const before = store.getState().tripItems.length;
    await store.getState().schedulePlaceManually(place, { date: demoTrip.startDate, startMinutes: 12 * 60, durationMinutes: 90 });
    const item = store.getState().tripItems.find((entry) => entry.placeId === "map-place-1");
    expect(store.getState().tripItems).toHaveLength(before + 1);
    expect(item).toMatchObject({ provider: "geoapify", title: "犬吠埼燈台" });
    expect(store.getState().past).toHaveLength(1);
    expect(persistence.saves).toHaveLength(1);
  });

  it("prevents duplicate map-place scheduling", async () => {
    const store = createPlannerStore(persistence); await store.getState().hydrate(demoTrip.id);
    const place: NormalizedPlace = { provider: "geoapify", providerPlaceId: "map-place-2", name: "Grounded place", location: { latitude: 35.7, longitude: 140.8 } };
    await store.getState().addPlace(place);
    const before = store.getState().tripItems.length;
    await store.getState().schedulePlaceManually(place, { date: demoTrip.startDate, startMinutes: 720, durationMinutes: 60 });
    expect(store.getState().tripItems).toHaveLength(before);
  });

  it("creates a manual item as one persisted undoable operation", async () => {
    const store = createPlannerStore(persistence);
    await store.getState().hydrate(demoTrip.id);
    const before = store.getState().tripItems.length;
    const item = await store.getState().createItem({
      type: "note",
      title: "Pack sunscreen",
      startDate: demoTrip.startDate,
      startMinutes: 7 * 60,
      endDate: demoTrip.startDate,
      endMinutes: 7 * 60 + 30,
      address: "",
      notes: "",
      reservation: null,
      transportDetails: null,
      flightDetails: null,
    });
    expect(store.getState().tripItems).toHaveLength(before + 1);
    expect(store.getState().selection).toEqual({
      type: "tripItem",
      id: item.id,
    });
    expect(persistence.saves).toHaveLength(1);
    expect(store.getState().past).toHaveLength(1);
    await store.getState().undo();
    expect(store.getState().tripItems).toHaveLength(before);
    await store.getState().redo();
    expect(
      store.getState().tripItems.some((value) => value.id === item.id),
    ).toBe(true);
  });

  it("persists and reloads a generated transport title", async () => {
    const store = createPlannerStore(persistence);
    await store.getState().hydrate(demoTrip.id);
    const item = await store
      .getState()
      .createItem({
        type: "transport",
        startDate: demoTrip.startDate,
        startMinutes: 8 * 60,
        endDate: demoTrip.startDate,
        endMinutes: 9 * 60,
        transportDetails: { mode: "train", from: "宜蘭", to: "台北" },
        flightDetails: null,
        reservation: null,
      });
    expect(item.title).toBe("宜蘭 → 台北");
    const reloaded = createPlannerStore(persistence);
    await reloaded.getState().hydrate(demoTrip.id);
    expect(
      reloaded.getState().tripItems.find((value) => value.id === item.id)
        ?.title,
    ).toBe("宜蘭 → 台北");
  });

  it("hydrates successfully", async () => {
    const store = createPlannerStore(persistence);
    await store.getState().hydrate(demoTrip.id);
    expect(store.getState()).toMatchObject({
      loadStatus: "loaded",
      activeTrip: demoTrip,
      tripItems: demoItems,
      candidates: demoCandidates,
    });
  });

  it("leaves loading state after hydration failure", async () => {
    persistence.failLoad = true;
    const store = createPlannerStore(persistence);
    await store.getState().hydrate(demoTrip.id);
    expect(store.getState()).toMatchObject({
      loadStatus: "error",
      loadError: "We could not load this trip. Please try again.",
    });
  });

  it("persists one committed move and one history entry", async () => {
    const store = createPlannerStore(persistence);
    await store.getState().hydrate(demoTrip.id);
    await store.getState().moveItem("transport-1", 11 * 60);
    expect(persistence.saves).toHaveLength(1);
    expect(store.getState().past).toHaveLength(1);
    expect(
      persistence.saves[0].items.find((item) => item.id === "transport-1")
        ?.startAt,
    ).toBe(
      store.getState().tripItems.find((item) => item.id === "transport-1")
        ?.startAt,
    );
  });

  it("moves an item across calendar dates as one undoable persisted operation", async () => {
    const store = createPlannerStore(persistence);
    await store.getState().hydrate(demoTrip.id);
    const original = store
      .getState()
      .tripItems.find((item) => item.id === "transport-1")!.startAt;

    await store
      .getState()
      .moveItem("transport-1", 11 * 60, "2026-10-25");

    const moved = store
      .getState()
      .tripItems.find((item) => item.id === "transport-1")!;
    expect(store.getState().selectedDate).toBe("2026-10-25");
    expect(moved.startAt).not.toBe(original);
    expect(persistence.saves).toHaveLength(1);
    expect(store.getState().past).toHaveLength(1);

    await store.getState().undo();
    expect(
      store.getState().tripItems.find((item) => item.id === "transport-1")!
        .startAt,
    ).toBe(original);

    await store.getState().redo();
    expect(
      store.getState().tripItems.find((item) => item.id === "transport-1")!
        .startAt,
    ).toBe(moved.startAt);
  });

  it("persists one committed resize and one history entry", async () => {
    const store = createPlannerStore(persistence);
    await store.getState().hydrate(demoTrip.id);
    await store.getState().resizeItem("transport-1", 13 * 60);
    expect(persistence.saves).toHaveLength(1);
    expect(store.getState().past).toHaveLength(1);
  });

  it("keeps optimistic local state and exposes save failure", async () => {
    const store = createPlannerStore(persistence);
    await store.getState().hydrate(demoTrip.id);
    persistence.failSave = true;
    await store.getState().deleteItem("note-1");
    expect(
      store.getState().tripItems.some((item) => item.id === "note-1"),
    ).toBe(false);
    expect(store.getState()).toMatchObject({
      saveStatus: "error",
      saveError: expect.any(String),
    });
  });

  it("undoes and redoes a move, persisting both results", async () => {
    const store = createPlannerStore(persistence);
    await store.getState().hydrate(demoTrip.id);
    const original = store
      .getState()
      .tripItems.find((item) => item.id === "transport-1")!.startAt;
    await store.getState().moveItem("transport-1", 11 * 60);
    const moved = store
      .getState()
      .tripItems.find((item) => item.id === "transport-1")!.startAt;
    await store.getState().undo();
    expect(
      store.getState().tripItems.find((item) => item.id === "transport-1")!
        .startAt,
    ).toBe(original);
    await store.getState().redo();
    expect(
      store.getState().tripItems.find((item) => item.id === "transport-1")!
        .startAt,
    ).toBe(moved);
    expect(persistence.saves).toHaveLength(3);
  });

  it("undoes deletion", async () => {
    const store = createPlannerStore(persistence);
    await store.getState().hydrate(demoTrip.id);
    await store.getState().deleteItem("note-1");
    await store.getState().undo();
    expect(
      store.getState().tripItems.some((item) => item.id === "note-1"),
    ).toBe(true);
  });

  it("undoes candidate scheduling", async () => {
    const store = createPlannerStore(persistence);
    await store.getState().hydrate(demoTrip.id);
    await store.getState().scheduleCandidate("candidate-1", 9 * 60);
    expect(
      store.getState().candidates.some((item) => item.id === "candidate-1"),
    ).toBe(false);
    await store.getState().undo();
    expect(
      store.getState().candidates.some((item) => item.id === "candidate-1"),
    ).toBe(true);
  });

  it("schedules a Candidate into an explicit calendar date as one operation", async () => {
    const store = createPlannerStore(persistence);
    await store.getState().hydrate(demoTrip.id);

    await store
      .getState()
      .scheduleCandidate("candidate-1", 9 * 60, "2026-10-26");

    const scheduled = store
      .getState()
      .tripItems.find((item) => item.title === "Cape Manzamo")!;
    expect(store.getState().selectedDate).toBe("2026-10-26");
    expect(scheduled.startAt.slice(0, 10)).toBe("2026-10-26");
    expect(store.getState().past).toHaveLength(1);
    expect(persistence.saves).toHaveLength(1);
  });

  it("ignores a stale place-search response", async () => {
    const search = new DeferredSearch();
    const store = createPlannerStore(persistence, search);
    await store.getState().hydrate(demoTrip.id);
    const first = store.getState().searchPlaces("Tokyo");
    const second = store.getState().searchPlaces("Kyoto");
    const kyoto: NormalizedPlace = {
      provider: "test",
      providerPlaceId: "kyoto",
      name: "Kyoto",
      location: { latitude: 35, longitude: 135 },
    };
    search.requests[1].resolve([kyoto]);
    await second;
    search.requests[0].resolve([
      { ...kyoto, providerPlaceId: "tokyo", name: "Tokyo" },
    ]);
    await first;
    expect(store.getState().searchResults).toEqual([kyoto]);
  });

  it("persists a search result as one Candidate and prevents duplicates", async () => {
    const place: NormalizedPlace = {
      provider: "test",
      providerPlaceId: "place-1",
      name: "Temple",
      location: { latitude: 35, longitude: 135 },
      category: "tourism.sights",
    };
    const search: PlaceSearchClient = { search: async () => [place] };
    const store = createPlannerStore(persistence, search);
    await store.getState().hydrate(demoTrip.id);
    await store.getState().searchPlaces("Temple");
    expect(await store.getState().addSearchResult("place-1")).toBe(true);
    expect(await store.getState().addSearchResult("place-1")).toBe(false);
    expect(
      store
        .getState()
        .candidates.filter((candidate) => candidate.placeId === "place-1"),
    ).toHaveLength(1);
    expect(
      persistence.saves
        .at(-1)
        ?.candidates.some((candidate) => candidate.placeId === "place-1"),
    ).toBe(true);
  });

  it("uses one discriminated shared selection", async () => {
    const store = createPlannerStore(persistence);
    await store.getState().hydrate(demoTrip.id);
    store.getState().select({ type: "candidate", id: "candidate-1" });
    expect(store.getState().selection).toEqual({
      type: "candidate",
      id: "candidate-1",
    });
    store.getState().select({ type: "tripItem", id: "flight-1" });
    expect(store.getState().selection).toEqual({
      type: "tripItem",
      id: "flight-1",
    });
  });
  it("adds a grounded suggestion through the existing Candidate conversion and blocks duplicates", async () => {
    const store = createPlannerStore(
        new MemoryPersistence(),
        new DeferredSearch(),
        new MemoryRouting(),
      ),
      place: NormalizedPlace = {
        provider: "geo",
        providerPlaceId: "grounded-1",
        name: "Grounded Beach",
        location: { latitude: 26.2, longitude: 127.7 },
        category: "beach",
      };
    await store.getState().hydrate(demoTrip.id);
    expect(await store.getState().addPlace(place)).toBe(true);
    expect(store.getState().candidates.at(-1)).toMatchObject({
      provider: "geo",
      placeId: "grounded-1",
      title: "Grounded Beach",
    });
    expect(await store.getState().addPlace(place)).toBe(false);
  });

  it("derives routes, changes only one segment mode, and exposes route errors", async () => {
    const routing = new MemoryRouting();
    const snapshot = structuredClone(persistence.snapshot);
    snapshot.items = snapshot.items.map((value) =>
      value.id === "restaurant-1"
        ? { ...value, latitude: 26.219, longitude: 127.716 }
        : value,
    );
    persistence = new MemoryPersistence(snapshot);
    const store = createPlannerStore(
      persistence,
      new DeferredSearch(),
      routing,
    );
    await store.getState().hydrate(demoTrip.id);
    await store.getState().recalculateRoutes();
    const segment = store
      .getState()
      .travelSegments.find((value) => value.id === "place-1--restaurant-1")!;
    expect(segment.status).toBe("loaded");
    const before = routing.calls.length;
    await store.getState().setTravelMode(segment.id, "walking");
    expect(routing.calls).toHaveLength(before + 1);
    expect(
      store.getState().travelSegments.find((value) => value.id === segment.id)
        ?.mode,
    ).toBe("walking");
    routing.fail = true;
    await store.getState().setTravelMode(segment.id, "cycling");
    expect(
      store.getState().travelSegments.find((value) => value.id === segment.id)
        ?.status,
    ).toBe("error");
  });

  it("derives date-scoped boundary routes and exposes unsupported transit without fallback", async () => {
    const routing = new MemoryRouting(), snapshot = structuredClone(persistence.snapshot);
    const scheduled = snapshot.items.filter((value) => value.id === "place-1" || value.id === "restaurant-1").map((value, index) => ({ ...value, startAt: `2026-10-24T${String(9 + index * 2).padStart(2, "0")}:00:00.000Z`, endAt: `2026-10-24T${String(10 + index * 2).padStart(2, "0")}:00:00.000Z`, latitude: 26.2 + index * .01, longitude: 127.7 + index * .01 }));
    snapshot.items = scheduled;
    snapshot.dayContexts = [createDayContext(snapshot.trip, "2026-10-24", { startLocation: { name: "Start", formattedAddress: null, latitude: 26.19, longitude: 127.69, provider: "geoapify", providerPlaceId: "start", timezone: "Asia/Tokyo" }, baseLocation: null, endLocation: { name: "End", formattedAddress: null, latitude: 26.23, longitude: 127.73, provider: "geoapify", providerPlaceId: "end", timezone: "Asia/Tokyo" } })];
    const store = createPlannerStore(new MemoryPersistence(snapshot), new DeferredSearch(), routing);
    await store.getState().hydrate(snapshot.trip.id); await store.getState().recalculateRoutes();
    const segments = store.getState().travelSegments.filter((value) => value.date === "2026-10-24");
    expect(segments).toHaveLength(3);
    const boundary = segments.find((value) => value.fromEndpoint.kind === "day_start")!;
    const before = routing.calls.length;
    await store.getState().setTravelMode(boundary.id, "transit");
    expect(routing.calls).toHaveLength(before);
    expect(store.getState().travelSegments.find((value) => value.id === boundary.id)).toMatchObject({ mode: "transit", status: "error", error: "Scheduled transit routing is not supported by the configured provider." });
  });

  it("persists effective overrides for internal and boundary endpoints without refetching provider evidence", async () => {
    const routing = new MemoryRouting(), snapshot = structuredClone(persistence.snapshot);
    snapshot.items = snapshot.items.filter((value) => value.id === "place-1" || value.id === "restaurant-1").map((value, index) => ({ ...value, startAt: `2026-10-24T${String(9 + index * 2).padStart(2, "0")}:00:00.000Z`, endAt: `2026-10-24T${String(10 + index * 2).padStart(2, "0")}:00:00.000Z`, latitude: 26.2 + index * .01, longitude: 127.7 + index * .01 }));
    snapshot.dayContexts = [createDayContext(snapshot.trip, "2026-10-24", { startLocation: { name: "Start", formattedAddress: null, latitude: 26.19, longitude: 127.69, provider: "geoapify", providerPlaceId: "start", timezone: null }, baseLocation: null, endLocation: { name: "End", formattedAddress: null, latitude: 26.23, longitude: 127.73, provider: "geoapify", providerPlaceId: "end", timezone: null } })];
    const memory = new MemoryPersistence(snapshot), store = createPlannerStore(memory, new DeferredSearch(), routing);
    await store.getState().hydrate(snapshot.trip.id); await store.getState().recalculateRoutes();
    const segments = store.getState().travelSegments, internal = segments.find((value) => value.fromEndpoint.kind === "trip_item" && value.toEndpoint.kind === "trip_item")!, start = segments.find((value) => value.fromEndpoint.kind === "day_start")!, end = segments.find((value) => value.toEndpoint.kind === "day_end")!;
    const calls = routing.calls.length;
    await store.getState().setTravelDurationOverride(internal.id, 35);
    await store.getState().setTravelDurationOverride(start.id, 50);
    await store.getState().setTravelDurationOverride(end.id, 30);
    expect(routing.calls).toHaveLength(calls);
    expect(store.getState().travelSegments.find((value) => value.id === internal.id)).toMatchObject({ durationSeconds: 300, effectiveDurationSeconds: 2100, durationSource: "manual" });
    await store.getState().setTravelDurationOverride(internal.id, null);
    expect(store.getState().travelSegments.find((value) => value.id === internal.id)).toMatchObject({ effectiveDurationSeconds: 300, durationSource: "provider" });
    expect(routing.calls).toHaveLength(calls);
    const reloaded = createPlannerStore(memory, new DeferredSearch(), routing); await reloaded.getState().hydrate(snapshot.trip.id); await reloaded.getState().recalculateRoutes();
    expect(reloaded.getState().travelSegments.find((value) => value.id === start.id)).toMatchObject({ effectiveDurationSeconds: 3000, durationSource: "manual" });
    memory.snapshot = { trip: { ...snapshot.trip, id: "other" }, items: [], candidates: [], segmentPreferences: [], dayContexts: [] };
    await reloaded.getState().hydrate("other"); await reloaded.getState().recalculateRoutes();
    expect(reloaded.getState().segmentPreferences).toEqual([]);
  });

  it("uses a manual transit duration without calling the routing provider or fabricating route evidence", async () => {
    const routing = new MemoryRouting(), store = createPlannerStore(persistence, new DeferredSearch(), routing);
    await store.getState().hydrate(demoTrip.id); await store.getState().recalculateRoutes();
    const segment = store.getState().travelSegments[0], before = routing.calls.length;
    await store.getState().setTravelMode(segment.id, "transit");
    expect(store.getState().travelSegments.find((value) => value.id === segment.id)?.status).toBe("error");
    await store.getState().setTravelDurationOverride(segment.id, 55);
    expect(routing.calls).toHaveLength(before);
    expect(store.getState().travelSegments.find((value) => value.id === segment.id)).toMatchObject({ mode: "transit", durationSeconds: null, effectiveDurationSeconds: 3300, durationSource: "manual", provider: null, distanceMeters: null, routeGeometry: undefined, status: "loaded" });
  });

  it("isolates boundary evidence across date and trip switches", async () => {
    const routing = new MemoryRouting(), first = structuredClone(persistence.snapshot), item = { ...first.items.find((value) => value.id === "place-1")!, startAt: "2026-10-24T09:00:00.000Z", endAt: "2026-10-24T10:00:00.000Z", latitude: 26.2, longitude: 127.7 };
    first.items = [item]; first.dayContexts = [createDayContext(first.trip, "2026-10-24", { startLocation: { name: "Start", formattedAddress: null, latitude: 26.1, longitude: 127.6, provider: "geoapify", providerPlaceId: "start", timezone: null }, baseLocation: null, endLocation: null })];
    const memory = new MemoryPersistence(first), store = createPlannerStore(memory, new DeferredSearch(), routing);
    await store.getState().hydrate(first.trip.id); await store.getState().recalculateRoutes();
    expect(store.getState().travelSegments.filter((value) => value.date === "2026-10-24")).toHaveLength(1);
    store.getState().setSelectedDate("2026-10-25");
    expect(store.getState().travelSegments.filter((value) => value.date === store.getState().selectedDate)).toHaveLength(0);
    memory.snapshot = { trip: { ...first.trip, id: "other" }, items: [], candidates: [], segmentPreferences: [], dayContexts: [] };
    await store.getState().hydrate("other"); await store.getState().recalculateRoutes();
    expect(store.getState().travelSegments).toEqual([]);
  });

  it("re-derives correct neighbor segments after deletion and undo", async () => {
    const routing = new MemoryRouting();
    const snapshot = structuredClone(persistence.snapshot);
    snapshot.items = snapshot.items.map((value) =>
      ["restaurant-1", "place-2"].includes(value.id)
        ? { ...value, latitude: 26.22, longitude: 127.71 }
        : value,
    );
    persistence = new MemoryPersistence(snapshot);
    const store = createPlannerStore(
      persistence,
      new DeferredSearch(),
      routing,
    );
    await store.getState().hydrate(demoTrip.id);
    await store.getState().recalculateRoutes();
    await store.getState().deleteItem("restaurant-1");
    expect(
      store
        .getState()
        .travelSegments.some((value) => value.id === "place-1--place-2"),
    ).toBe(true);
    await store.getState().undo();
    expect(
      store
        .getState()
        .travelSegments.some((value) => value.id === "place-1--restaurant-1"),
    ).toBe(true);
    expect(
      store
        .getState()
        .travelSegments.some((value) => value.id === "restaurant-1--place-2"),
    ).toBe(true);
  });

  it("blocks fixed drag but allows explicit edit, with undo and redo", async () => {
    const store = createPlannerStore(persistence);
    await store.getState().hydrate(demoTrip.id);
    const original = store
      .getState()
      .tripItems.find((x) => x.id === "flight-1")!.startAt;
    await store.getState().moveItem("flight-1", 12 * 60);
    expect(
      store.getState().tripItems.find((x) => x.id === "flight-1")!.startAt,
    ).toBe(original);
    expect(store.getState().past).toHaveLength(0);
    await store.getState().editItem("flight-1", { flexibility: "flexible" });
    expect(
      store.getState().tripItems.find((x) => x.id === "flight-1")!.flexibility,
    ).toBe("flexible");
    await store.getState().undo();
    expect(
      store.getState().tripItems.find((x) => x.id === "flight-1")!.flexibility,
    ).toBe("fixed");
    await store.getState().redo();
    expect(
      store.getState().tripItems.find((x) => x.id === "flight-1")!.flexibility,
    ).toBe("flexible");
  });

  it("undoes and redoes reservation and constraint edits", async () => {
    const store = createPlannerStore(persistence);
    await store.getState().hydrate(demoTrip.id);
    const reservation = {
      id: "r",
      status: "confirmed" as const,
      provider: "Test",
    };
    const schedulingConstraint = {
      earliestStartAt: "2026-10-25T00:00:00.000Z",
    };
    await store
      .getState()
      .editItem("place-1", { reservation, schedulingConstraint });
    expect(
      store.getState().tripItems.find((x) => x.id === "place-1")?.reservation,
    ).toEqual(reservation);
    await store.getState().undo();
    expect(
      store.getState().tripItems.find((x) => x.id === "place-1")?.reservation,
    ).toBeNull();
    await store.getState().redo();
    expect(
      store.getState().tripItems.find((x) => x.id === "place-1")
        ?.schedulingConstraint,
    ).toEqual(schedulingConstraint);
  });

  it("persists travel mode preference across hydration", async () => {
    const routing = new MemoryRouting();
    const snapshot = structuredClone(persistence.snapshot);
    snapshot.items = snapshot.items.map((x) =>
      x.id === "restaurant-1" ? { ...x, latitude: 26.2, longitude: 127.7 } : x,
    );
    persistence = new MemoryPersistence(snapshot);
    const store = createPlannerStore(
      persistence,
      new DeferredSearch(),
      routing,
    );
    await store.getState().hydrate(demoTrip.id);
    await store.getState().recalculateRoutes();
    await store.getState().setTravelMode("place-1--restaurant-1", "walking");
    const reloaded = createPlannerStore(
      persistence,
      new DeferredSearch(),
      routing,
    );
    await reloaded.getState().hydrate(demoTrip.id);
    await reloaded.getState().recalculateRoutes();
    expect(
      reloaded
        .getState()
        .travelSegments.find((x) => x.id === "place-1--restaurant-1")?.mode,
    ).toBe("walking");
  });

  it("applies, undoes, and redoes a multi-change proposal as one history transaction", async () => {
    const routing = new MemoryRouting();
    const store = createPlannerStore(
      persistence,
      new DeferredSearch(),
      routing,
    );
    await store.getState().hydrate(demoTrip.id);
    const first = store
        .getState()
        .tripItems.find((x) => x.id === "transport-1")!,
      second = store.getState().tripItems.find((x) => x.id === "place-1")!;
    const shifted = (iso: string, minutes: number) =>
      new Date(Date.parse(iso) + minutes * 60000).toISOString();
    const metric = (after: boolean) => ({
      issuesBefore: 1,
      issuesAfter: after ? 0 : 1,
      errorsBefore: 0,
      errorsAfter: 0,
      warningsBefore: 1,
      warningsAfter: after ? 0 : 1,
      errorsResolved: 0,
      warningsResolved: after ? 1 : 0,
      errorsRemaining: 0,
      warningsRemaining: after ? 0 : 1,
      modifiedItemCount: after ? 2 : 0,
      totalMovementMinutes: after ? 30 : 0,
      travelTimeBeforeMinutes: null,
      travelTimeAfterMinutes: null,
      travelTimeChangeMinutes: null,
      minimumBufferMinutes: null,
      totalIdleMinutes: null,
    });
    const proposal: ScheduleProposal = {
      id: "repair:test",
      kind: "repair",
      changes: [
        {
          type: "move_item",
          itemId: first.id,
          fromStartAt: first.startAt,
          toStartAt: shifted(first.startAt, 15),
        },
        {
          type: "move_item",
          itemId: second.id,
          fromStartAt: second.startAt,
          toStartAt: shifted(second.startAt, 15),
        },
      ],
      before: metric(false),
      after: metric(true),
      score: 1000,
      reasons: [
        { code: "REDUCES_ISSUES", itemIds: [first.id, second.id], count: 1 },
      ],
      confidence: "full",
      routeEstimates: [],
    };
    store.setState({
      proposalPreview: proposal,
      solverResult: { status: "ready", proposals: [proposal] },
      solverStatus: "ready",
    });
    await store.getState().applyProposal();
    expect(store.getState().past).toHaveLength(1);
    expect(persistence.saves).toHaveLength(1);
    expect(store.getState().travelSegments).toBeDefined();
    await store.getState().undo();
    expect(
      store.getState().tripItems.find((x) => x.id === first.id)?.startAt,
    ).toBe(first.startAt);
    expect(
      store.getState().tripItems.find((x) => x.id === second.id)?.startAt,
    ).toBe(second.startAt);
    await store.getState().redo();
    expect(
      store.getState().tripItems.find((x) => x.id === first.id)?.startAt,
    ).toBe(shifted(first.startAt, 15));
    expect(
      store.getState().tripItems.find((x) => x.id === second.id)?.startAt,
    ).toBe(shifted(second.startAt, 15));
  });

  it("ignores stale route preparation and keeps cancellation canonical-state neutral", async () => {
    const pending: Array<
      (value: {
        provider: string;
        origin: { latitude: number; longitude: number };
        destination: { latitude: number; longitude: number };
        mode: "driving";
        durationSeconds: number;
        distanceMeters: number;
      }) => void
    > = [];
    const routing: RoutingClient = {
      route: async (_t, _segment, request) => ({
        provider: "mock",
        ...request,
        durationSeconds: 60,
        distanceMeters: 1,
      }),
      estimate: async () =>
        new Promise((resolve) => pending.push(resolve as never)),
    };
    const store = createPlannerStore(
      persistence,
      new DeferredSearch(),
      routing,
    );
    await store.getState().hydrate(demoTrip.id);
    const before = structuredClone(store.getState().tripItems);
    const solving = store
      .getState()
      .findCandidateTime("candidate-1", { mode: "driving" });
    expect(store.getState().solverStatus).toBe("preparing_routes");
    store.getState().cancelSolve();
    for (const resolve of pending)
      resolve({
        provider: "mock",
        origin: { latitude: 1, longitude: 1 },
        destination: { latitude: 2, longitude: 2 },
        mode: "driving",
        durationSeconds: 60,
        distanceMeters: 1,
      });
    await solving;
    expect(store.getState().solverStatus).toBe("cancelled");
    expect(store.getState().proposalPreview).toBeNull();
    expect(store.getState().tripItems).toEqual(before);
  });

  it("unschedules as one persisted history transaction and supports reload, undo, redo, and rescheduling", async () => {
    const snapshot = structuredClone(persistence.snapshot),
      candidate = {
        ...snapshot.candidates[0],
        id: "grounded-candidate",
        provider: "geoapify",
        placeId: "geo-place",
        latitude: 26.2,
        longitude: 127.7,
        estimatedDuration: 90,
      };
    snapshot.candidates = [candidate];
    persistence = new MemoryPersistence(snapshot);
    const store = createPlannerStore(
      persistence,
      new DeferredSearch(),
      new MemoryRouting(),
    );
    await store.getState().hydrate(demoTrip.id);
    await store.getState().scheduleCandidate(candidate.id, 12 * 60);
    const scheduled = store
      .getState()
      .tripItems.find((item) => item.sourceCandidateId === candidate.id)!;
    persistence.saves = [];
    store.setState({ past: [], future: [] });
    expect(await store.getState().unscheduleItem(scheduled.id)).toBe(true);
    expect(store.getState().past).toHaveLength(1);
    expect(persistence.saves).toHaveLength(1);
    expect(
      store.getState().tripItems.some((item) => item.id === scheduled.id),
    ).toBe(false);
    expect(store.getState().candidates).toContainEqual(candidate);
    const reloaded = createPlannerStore(
      persistence,
      new DeferredSearch(),
      new MemoryRouting(),
    );
    await reloaded.getState().hydrate(demoTrip.id);
    expect(reloaded.getState().candidates).toContainEqual(candidate);
    await store.getState().undo();
    expect(
      store.getState().tripItems.find((item) => item.id === scheduled.id),
    ).toEqual(scheduled);
    expect(
      store.getState().candidates.some((item) => item.id === candidate.id),
    ).toBe(false);
    await store.getState().redo();
    expect(store.getState().candidates).toContainEqual(candidate);
    await store.getState().scheduleCandidate(candidate.id, 13 * 60);
    expect(
      store
        .getState()
        .tripItems.some((item) => item.sourceCandidateId === candidate.id),
    ).toBe(true);
  });

  it("reconciles neighbor routes and prevents duplicate Candidates when unscheduling", async () => {
    const make = (id: string, hour: number) => ({
      ...demoItems.find((item) => item.id === "place-1")!,
      id,
      title: id,
      startAt: `2026-10-25T0${hour}:00:00.000Z`,
      endAt: `2026-10-25T0${hour + 1}:00:00.000Z`,
      provider: "geoapify",
      placeId: `place-${id}`,
      sourceCandidateId: `candidate-${id}`,
      latitude: 26 + hour / 100,
      longitude: 127.7,
    });
    const a = make("a", 0),
      b = make("b", 2),
      c = make("c", 4),
      snapshot = {
        trip: demoTrip,
        items: [a, b, c],
        candidates: [
          {
            id: "existing-b",
            tripId: demoTrip.id,
            type: "place" as const,
            title: "Existing B",
            latitude: b.latitude,
            longitude: b.longitude,
            address: b.address,
            placeId: b.placeId,
            provider: b.provider!,
            estimatedDuration: 60,
            notes: null,
          },
        ],
        segmentPreferences: [
          {
            tripId: demoTrip.id,
            fromEndpointKey: "trip-item:a",
            toEndpointKey: "trip-item:b",
            travelMode: "walking" as const,
          },
        ],
      };
    persistence = new MemoryPersistence(snapshot);
    const store = createPlannerStore(
      persistence,
      new DeferredSearch(),
      new MemoryRouting(),
    );
    await store.getState().hydrate(demoTrip.id);
    await store.getState().recalculateRoutes();
    expect(await store.getState().unscheduleItem("b")).toBe(true);
    expect(
      store
        .getState()
        .candidates.filter((value) => value.placeId === b.placeId),
    ).toHaveLength(1);
    expect(
      store.getState().travelSegments.some((segment) => segment.id === "a--c"),
    ).toBe(true);
    expect(
      store
        .getState()
        .travelSegments.some(
          (segment) =>
            segment.fromTripItemId === "b" || segment.toTripItemId === "b",
        ),
    ).toBe(false);
    expect(
      store
        .getState()
        .segmentPreferences.some(
          (preference) =>
            preference.fromEndpointKey === "trip-item:b" ||
            preference.toEndpointKey === "trip-item:b",
        ),
    ).toBe(false);
  });

  it("refuses invalid unschedule operations without history or persistence", async () => {
    const store = createPlannerStore(persistence);
    await store.getState().hydrate(demoTrip.id);
    for (const id of ["flight-1", "transport-1", "note-1", "place-1"])
      expect(await store.getState().unscheduleItem(id)).toBe(false);
    expect(store.getState().past).toHaveLength(0);
    expect(persistence.saves).toHaveLength(0);
  });
});
