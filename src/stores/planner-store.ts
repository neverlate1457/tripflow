import { create } from "zustand";
import type {
  Candidate,
  DayContext,
  NormalizedPlace,
  PlannerSelection,
  SegmentPreference,
  Trip,
  TripItem,
} from "@/domain/models";
import { isEmptyDayContext, validateDayContext } from "@/domain/day-context";
import {
  candidateToTripItem,
  tripItemToCandidate,
  unscheduleEligibility,
} from "@/domain/scheduling";
import {
  editTripItem,
  itemsForDate,
  moveItem,
  resizeItem,
  type TripItemEdit,
} from "@/domain/time";
import {
  HttpTripPersistence,
  PersistenceCoordinator,
  TripNotFoundError,
  type TripPersistence,
} from "@/services/client-trip-persistence";
import type { TripSnapshot } from "@/services/trip-repository";
import {
  HttpPlaceSearchClient,
  type PlaceSearchClient,
} from "@/services/client-place-search";
import { hasCandidateForPlace, placeToCandidate } from "@/domain/places";
import { generateId } from "@/lib/id";
import {
  deriveSegmentSpecs,
  emptySegment,
  routeCacheKey,
  resolveEffectiveDuration,
  segmentEndpointKey,
  isValidDurationOverride,
  type TravelMode,
  type TravelSegment,
} from "@/domain/routing";
import {
  HttpRoutingClient,
  type RoutingClient,
} from "@/services/client-routing";
import {
  insertCandidate,
  insertCandidates,
  previewProposal as buildPreview,
  repairSchedule,
  type ScheduleProposal,
  type SolverResult,
} from "@/domain/planning";
import { prepareCandidateRoutes, prepareCandidateSetRoutes } from "@/services/planning-route-preparation";
import {
  createManualTripItem,
  type ManualItemInput,
} from "@/domain/manual-items";
import { normalizeFlightDetails, validatePersistedFlight } from "@/domain/flight";
import { applyEffectiveMovement, bindingIsValid, isBoundTransport, transportBindingKey } from "@/domain/bound-transport";

export type LoadStatus = "initial" | "loading" | "loaded" | "error";
export type SaveStatus = "idle" | "saving" | "saved" | "error";
interface HistorySnapshot {
  tripItems: TripItem[];
  candidates: Candidate[];
  segmentPreferences: SegmentPreference[];
}

export interface PlannerState {
  activeTrip: Trip | null;
  selectedDate: string;
  tripItems: TripItem[];
  candidates: Candidate[];
  dayContexts: DayContext[];
  selection: PlannerSelection;
  searchQuery: string;
  searchResults: NormalizedPlace[];
  searchStatus: LoadStatus;
  searchError: string | null;
  travelSegments: TravelSegment[];
  segmentPreferences: SegmentPreference[];
  solverStatus:
    | "idle"
    | "preparing_routes"
    | "solving"
    | "ready"
    | "error"
    | "cancelled"
    | "unsupported";
  solverResult: SolverResult | null;
  proposalPreview: ScheduleProposal | null;
  pendingProposalCandidate: Candidate | null;
  loadStatus: LoadStatus;
  loadError: string | null;
  saveStatus: SaveStatus;
  saveError: string | null;
  past: HistorySnapshot[];
  future: HistorySnapshot[];
  hydrate(tripId: string): Promise<void>;
  retryHydration(): Promise<void>;
  retrySave(): Promise<void>;
  setSelectedDate(date: string): void;
  select(selection: PlannerSelection): void;
  searchPlaces(query: string): Promise<void>;
  clearSearch(): void;
  addSearchResult(id: string): Promise<boolean>;
  addPlace(place: NormalizedPlace): Promise<boolean>;
  addCandidate(candidate: Candidate): Promise<void>;
  removeCandidate(id: string): Promise<void>;
  setDayContext(context: DayContext): Promise<void>;
  removeDayContext(date: string): Promise<void>;
  scheduleCandidate(id: string, startMinutes: number, date?: string): Promise<void>;
  moveItem(id: string, startMinutes: number, date?: string): Promise<void>;
  resizeItem(id: string, endMinutes: number): Promise<void>;
  editItem(id: string, edit: TripItemEdit): Promise<void>;
  createItem(input: ManualItemInput): Promise<TripItem>;
  deleteItem(id: string): Promise<void>;
  undo(): Promise<void>;
  redo(): Promise<void>;
  unscheduleItem(id: string): Promise<boolean>;
  recalculateRoutes(): Promise<void>;
  retryRoute(id: string): Promise<void>;
  setTravelMode(id: string, mode: TravelMode): Promise<void>;
  setTravelDurationOverride(id: string, minutes: number | null): Promise<void>;
  suggestRepair(options?: import("@/domain/planning").RepairOptions): Promise<void>;
  findCandidateTime(
    candidateId: string,
    options?: { date?: string; durationMinutes?: number; mode?: TravelMode; timeWindow?: { start: string; end: string } },
  ): Promise<void>;
  findCandidatesTime(candidateIds: string[], options: { date: string; mode?: TravelMode; timeWindow: { start: string; end: string } }): Promise<void>;
  findPlaceTime(place: NormalizedPlace, options: { date: string; durationMinutes: number; mode: TravelMode }): Promise<void>;
  schedulePlaceManually(place: NormalizedPlace, options: { date: string; startMinutes: number; durationMinutes: number }): Promise<void>;
  cancelSolve(): void;
  selectProposal(proposal: ScheduleProposal | null): void;
  applyProposal(): Promise<void>;
}

const historyOf = (state: PlannerState): HistorySnapshot => ({
  tripItems: state.tripItems,
  candidates: state.candidates,
  segmentPreferences: state.segmentPreferences,
});
const snapshotOf = (state: PlannerState): TripSnapshot | null =>
  state.activeTrip
    ? {
        trip: state.activeTrip,
        items: state.tripItems,
        candidates: state.candidates,
        segmentPreferences: state.segmentPreferences,
        dayContexts: state.dayContexts,
      }
    : null;

export function createPlannerStore(
  persistence: TripPersistence = new HttpTripPersistence(),
  placeSearch: PlaceSearchClient = new HttpPlaceSearchClient(),
  routing: RoutingClient = new HttpRoutingClient(),
) {
  const coordinator = new PersistenceCoordinator(persistence);
  let hydrationId = "";
  let saveSequence = 0;
  let searchSequence = 0;
  let solveSequence = 0;
  let solveController: AbortController | null = null;
  return create<PlannerState>((set, get) => {
    const specsFor = (state: PlannerState) => deriveSegmentSpecs(
      state.tripItems,
      state.activeTrip?.timezone ?? "UTC",
      state.dayContexts,
    );
    const loadSegment = async (segment: TravelSegment) => {
      const spec = specsFor(get()).find((entry) => entry.id === segment.id);
      if (!spec) return;
      if (segment.mode === "transit") {
        set((state) => ({ travelSegments: state.travelSegments.map((entry) => entry.id === segment.id ? { ...applyEffectiveMovement(entry, state.tripItems), status: entry.movementSource === "bound_transport" || entry.durationSource === "manual" ? "loaded" : "error", error: entry.movementSource === "bound_transport" || entry.durationSource === "manual" ? null : "Scheduled transit routing is not supported by the configured provider." } : entry) }));
        return;
      }
      set((state) => ({
        travelSegments: state.travelSegments.map((entry) =>
          entry.id === segment.id
            ? { ...entry, status: "loading", error: null }
            : entry,
        ),
      }));
      try {
        const route = await routing.route(
          spec.tripId,
          spec,
          {
            origin: spec.origin,
            destination: spec.destination,
            mode: segment.mode,
            departureAt: spec.departureAt,
          },
        );
        const latest = specsFor(get()).find((entry) => entry.id === segment.id);
        if (!latest) return;
        const preference = get().segmentPreferences.find((value) => value.fromEndpointKey === segmentEndpointKey(latest.fromEndpoint) && value.toEndpointKey === segmentEndpointKey(latest.toEndpoint));
        const duration = resolveEffectiveDuration(route.durationSeconds, preference?.durationOverrideMinutes);
        set((state) => ({
          travelSegments: state.travelSegments.map((entry) =>
            entry.id === segment.id && entry.mode === segment.mode
              ? applyEffectiveMovement({
                  ...entry,
                  durationSeconds: route.durationSeconds,
                  durationOverrideMinutes: duration.durationOverrideMinutes,
                  effectiveDurationSeconds: duration.effectiveDurationSeconds,
                  durationSource: duration.durationSource,
                  distanceMeters: route.distanceMeters,
                  provider: route.provider,
                  routeGeometry: route.geometry,
                  routeEvidenceKey: routeCacheKey(route.provider, { origin: latest.origin, destination: latest.destination, mode: segment.mode }),
                  calculatedAt: new Date().toISOString(),
                  status: "loaded",
                  error: null,
                }, state.tripItems)
              : entry,
          ),
        }));
      } catch (error) {
        set((state) => ({
          travelSegments: state.travelSegments.map((entry) =>
            entry.id === segment.id
              ? {
                  ...entry,
                  status: entry.movementSource === "bound_transport" || entry.durationSource === "manual" ? "loaded" : "error",
                  error:
                    entry.movementSource === "bound_transport" ? null : error instanceof Error
                      ? error.message
                      : "Route calculation failed",
                }
              : entry,
          ),
        }));
      }
    };
    const reconcileRoutes = async () => {
      const state = get();
      if (!state.activeTrip) return;
      const specs = deriveSegmentSpecs(
          state.tripItems,
          state.activeTrip.timezone,
          state.dayContexts,
        ),
        current = new Map(
          state.travelSegments.map((segment) => [segment.id, segment]),
        );
      const next = specs.map((spec) => {
        const preference = state.segmentPreferences.find(
          (p) =>
            (p.fromEndpointKey === segmentEndpointKey(spec.fromEndpoint) || p.fromEndpointKey === spec.fromTripItemId) &&
            (p.toEndpointKey === segmentEndpointKey(spec.toEndpoint) || p.toEndpointKey === spec.toTripItemId),
        );
        const existing = current.get(spec.id);
        const mode = preference?.travelMode ?? existing?.mode ?? "driving";
        const duration = resolveEffectiveDuration(existing?.durationSeconds ?? null, preference?.durationOverrideMinutes);
        const expectedEvidenceKey = routeCacheKey(existing?.provider ?? "geoapify", { origin: spec.origin, destination: spec.destination, mode });
        const base: TravelSegment = existing
          ? {
              ...existing,
              ...spec,
              mode,
              durationOverrideMinutes: duration.durationOverrideMinutes,
              effectiveDurationSeconds: duration.effectiveDurationSeconds,
              durationSource: duration.durationSource,
              tripId: spec.tripId,
              date: spec.date,
              status: mode === "transit" ? duration.durationSource === "manual" ? "loaded" as const : "error" as const : existing.routeEvidenceKey && existing.routeEvidenceKey !== expectedEvidenceKey ? "stale" as const : existing.status,
              error: mode === "transit" ? duration.durationSource === "manual" ? null : "Scheduled transit routing is not supported by the configured provider." : existing.error,
            }
          : mode === "transit" ? { ...emptySegment(spec, mode, preference?.durationOverrideMinutes ?? null), status: duration.durationSource === "manual" ? "loaded" as const : "error" as const, error: duration.durationSource === "manual" ? null : "Scheduled transit routing is not supported by the configured provider." } : emptySegment(spec, mode, preference?.durationOverrideMinutes ?? null);
        const effective = applyEffectiveMovement(base, state.tripItems);
        if (effective.movementSource === "bound_transport") return { ...effective, status: "loaded" as const, error: null };
        if (mode !== "transit" && effective.durationSeconds == null && effective.durationOverrideMinutes == null && effective.status === "loaded") return { ...effective, status: "idle" as const, error: null };
        return effective;
      });
      set({ travelSegments: next });
      await Promise.all(
        next
          .filter(
            (segment) =>
              segment.status === "idle" || segment.status === "stale",
          )
          .map(loadSegment),
      );
    };
    const persist = async () => {
      const snapshot = snapshotOf(get());
      if (!snapshot) return;
      const sequence = ++saveSequence;
      set({ saveStatus: "saving", saveError: null });
      try {
        await coordinator.saveTrip(snapshot);
        if (sequence === saveSequence) set({ saveStatus: "saved" });
      } catch {
        if (sequence === saveSequence)
          set({
            saveStatus: "error",
            saveError:
              "Your changes are still here. Retry saving when the connection recovers.",
          });
      }
    };
    const commit = async (changes: Partial<PlannerState>) => {
      const before = historyOf(get());
      set((state) => ({
        ...changes,
        past: [...state.past, before].slice(-100),
        future: [],
      }));
      await persist();
      await reconcileRoutes();
    };
    return {
      activeTrip: null,
      selectedDate: "",
      tripItems: [],
      candidates: [],
      dayContexts: [],
      selection: null,
      travelSegments: [],
      segmentPreferences: [],
      solverStatus: "idle",
      solverResult: null,
      proposalPreview: null,
      pendingProposalCandidate: null,
      searchQuery: "",
      searchResults: [],
      searchStatus: "initial",
      searchError: null,
      loadStatus: "initial",
      loadError: null,
      saveStatus: "idle",
      saveError: null,
      past: [],
      future: [],
      hydrate: async (tripId) => {
        hydrationId = tripId;
        set({ loadStatus: "loading", loadError: null });
        try {
          const snapshot = await coordinator.loadTrip(tripId);
          set({
            activeTrip: snapshot.trip,
            selectedDate: snapshot.trip.startDate,
            tripItems: snapshot.items,
            candidates: snapshot.candidates,
            dayContexts: snapshot.dayContexts ?? [],
            segmentPreferences: snapshot.segmentPreferences,
            travelSegments: [],
            selection: null,
            loadStatus: "loaded",
            loadError: null,
            saveStatus: "saved",
            past: [],
            future: [],
            solverStatus: "idle",
            solverResult: null,
            proposalPreview: null,
            pendingProposalCandidate: null,
          });
          void reconcileRoutes();
        } catch (error) {
          set({
            loadStatus: "error",
            loadError:
              error instanceof TripNotFoundError
                ? "Trip not found."
                : "We could not load this trip. Please try again.",
          });
        }
      },
      retryHydration: async () => {
        if (hydrationId) await get().hydrate(hydrationId);
      },
      retrySave: persist,
      setSelectedDate: (selectedDate) => set({ selectedDate, selection: null }),
      select: (selection) => set({ selection }),
      searchPlaces: async (query) => {
        const sequence = ++searchSequence;
        const trimmed = query.trim();
        set({ searchQuery: query });
        if (!trimmed) {
          set({
            searchResults: [],
            searchStatus: "initial",
            searchError: null,
            selection:
              get().selection?.type === "searchResult" ? null : get().selection,
          });
          return;
        }
        set({ searchStatus: "loading", searchError: null });
        const points = [...get().tripItems, ...get().candidates].filter(
          (value) => value.latitude != null && value.longitude != null,
        );
        const latitude = points.length
          ? points.reduce((sum, value) => sum + value.latitude!, 0) /
            points.length
          : get().activeTrip?.destination?.latitude;
        const longitude = points.length
          ? points.reduce((sum, value) => sum + value.longitude!, 0) /
            points.length
          : get().activeTrip?.destination?.longitude;
        try {
          const results = await placeSearch.search(trimmed, {
            latitude,
            longitude,
          });
          if (sequence === searchSequence)
            set({ searchResults: results, searchStatus: "loaded" });
        } catch (error) {
          if (sequence === searchSequence)
            set({
              searchResults: [],
              searchStatus: "error",
              searchError:
                error instanceof Error ? error.message : "Search failed",
            });
        }
      },
      clearSearch: () => {
        searchSequence++;
        set({
          searchQuery: "",
          searchResults: [],
          searchStatus: "initial",
          searchError: null,
          selection:
            get().selection?.type === "searchResult" ? null : get().selection,
        });
      },
      addSearchResult: async (id) => {
        const state = get();
        const place = state.searchResults.find(
          (result) => result.providerPlaceId === id,
        );
        if (
          !place ||
          !state.activeTrip ||
          hasCandidateForPlace(state.candidates, place)
        )
          return false;
        const candidate = placeToCandidate(place, state.activeTrip.id);
        await commit({
          candidates: [...state.candidates, candidate],
          selection: { type: "candidate", id: candidate.id },
        });
        return true;
      },
      addPlace: async (place) => {
        const state = get();
        if (
          !state.activeTrip ||
          hasCandidateForPlace(state.candidates, place) ||
          state.tripItems.some((x) => x.placeId === place.providerPlaceId)
        )
          return false;
        const candidate = placeToCandidate(place, state.activeTrip.id);
        await commit({
          candidates: [...state.candidates, candidate],
          selection: { type: "candidate", id: candidate.id },
        });
        return true;
      },
      addCandidate: async (candidate) =>
        commit({ candidates: [...get().candidates, candidate] }),
      removeCandidate: async (id) =>
        commit({
          candidates: get().candidates.filter(
            (candidate) => candidate.id !== id,
          ),
        }),
      setDayContext: async (context) => {
        const state = get();
        if (!state.activeTrip || !validateDayContext(context, state.activeTrip)) throw new Error("INVALID_DAY_CONTEXT");
        const dayContexts = state.dayContexts.filter((value) => value.date !== context.date);
        set({ dayContexts: isEmptyDayContext(context) ? dayContexts : [...dayContexts, context].sort((a, b) => a.date.localeCompare(b.date)) });
        await persist();
        await reconcileRoutes();
      },
      removeDayContext: async (date) => {
        set({ dayContexts: get().dayContexts.filter((value) => value.date !== date) });
        await persist();
        await reconcileRoutes();
      },
      scheduleCandidate: async (id, startMinutes, date) => {
        const state = get();
        const candidate = state.candidates.find((entry) => entry.id === id);
        if (!candidate || !state.activeTrip) return;
        const scheduled = candidateToTripItem(
          candidate,
          date ?? state.selectedDate,
          startMinutes,
          state.activeTrip.timezone,
        );
        await commit({
          tripItems: [...state.tripItems, scheduled],
          candidates: state.candidates.filter((entry) => entry.id !== id),
          selectedDate: date ?? state.selectedDate,
          selection: { type: "tripItem", id: scheduled.id },
        });
      },
      moveItem: async (id, startMinutes, date) => {
        const state = get();
        if (!state.activeTrip) return;
        if (
          state.tripItems.find((entry) => entry.id === id)?.flexibility ===
          "fixed"
        )
          return;
        await commit({
          tripItems: state.tripItems.map((entry) =>
            entry.id === id
              ? moveItem(
                  entry,
                  date ?? state.selectedDate,
                  startMinutes,
                  state.activeTrip!.timezone,
                )
              : entry,
          ),
          selectedDate: date ?? state.selectedDate,
        });
      },
      resizeItem: async (id, endMinutes) => {
        const state = get();
        if (!state.activeTrip) return;
        if (
          state.tripItems.find((entry) => entry.id === id)?.flexibility ===
          "fixed"
        )
          return;
        await commit({
          tripItems: state.tripItems.map((entry) =>
            entry.id === id
              ? resizeItem(entry, endMinutes, state.activeTrip!.timezone)
              : entry,
          ),
        });
      },
      editItem: async (id, edit) => {
        const state = get();
        if (!state.activeTrip) return;
        const currentItem = state.tripItems.find((entry) => entry.id === id)!;
        const targetType = edit.type ?? currentItem.type;
        const normalizedEdit = targetType === "flight" ? { ...edit, address: edit.address?.trim() || null, notes: edit.notes?.trim() || null, ...(edit.flightDetails ? { flightDetails: normalizeFlightDetails(edit.flightDetails) } : {}) } : edit;
        const nextItem = editTripItem(currentItem, normalizedEdit, state.activeTrip.timezone);
        if (nextItem.type === "flight" && !validatePersistedFlight(nextItem, state.activeTrip)) throw new Error("INVALID_FLIGHT");
        if (isBoundTransport(nextItem)) {
          const specs = deriveSegmentSpecs(state.tripItems.map((entry) => entry.id === id ? nextItem : entry), state.activeTrip.timezone, state.dayContexts);
          if (!bindingIsValid(nextItem.transportDetails, specs)) throw new Error("INVALID_TRANSPORT_BINDING");
          const key = transportBindingKey(nextItem.transportDetails);
          if (state.tripItems.some((entry) => entry.id !== id && isBoundTransport(entry) && transportBindingKey(entry.transportDetails) === key)) throw new Error("DUPLICATE_TRANSPORT_BINDING");
        }
        await commit({
          tripItems: state.tripItems.map((entry) =>
            entry.id === id
              ? nextItem
              : entry,
          ),
        });
      },
      createItem: async (input) => {
        const state = get();
        if (!state.activeTrip) throw new Error("TRIP_NOT_LOADED");
        const item = createManualTripItem(input, state.activeTrip);
        if (isBoundTransport(item)) {
          const specs = deriveSegmentSpecs([...state.tripItems, item], state.activeTrip.timezone, state.dayContexts);
          if (!bindingIsValid(item.transportDetails, specs)) throw new Error("INVALID_TRANSPORT_BINDING");
          const key = transportBindingKey(item.transportDetails);
          if (state.tripItems.some((entry) => isBoundTransport(entry) && transportBindingKey(entry.transportDetails) === key)) throw new Error("DUPLICATE_TRANSPORT_BINDING");
        }
        await commit({
          tripItems: [...state.tripItems, item],
          selection: { type: "tripItem", id: item.id },
        });
        return item;
      },
      deleteItem: async (id) => {
        const state = get();
        await commit({
          tripItems: state.tripItems.filter((entry) => entry.id !== id),
          segmentPreferences: state.segmentPreferences.filter(
            (preference) =>
              preference.fromEndpointKey !== `trip-item:${id}` &&
              preference.toEndpointKey !== `trip-item:${id}` &&
              preference.fromEndpointKey !== id &&
              preference.toEndpointKey !== id,
          ),
          selection:
            state.selection?.type === "tripItem" && state.selection?.id === id
              ? null
              : state.selection,
        });
      },
      unscheduleItem: async (id) => {
        const state = get(),
          item = state.tripItems.find((entry) => entry.id === id);
        if (!item || !unscheduleEligibility(item).eligible) return false;
        const restored = tripItemToCandidate(item),
          existing = state.candidates.find(
            (candidate) =>
              candidate.id === restored.id ||
              (candidate.provider === restored.provider &&
                candidate.placeId === restored.placeId),
          );
        const candidate = existing ?? restored;
        await commit({
          tripItems: state.tripItems.filter((entry) => entry.id !== id),
          candidates: existing
            ? state.candidates
            : [...state.candidates, candidate],
          segmentPreferences: state.segmentPreferences.filter(
            (preference) =>
              preference.fromEndpointKey !== `trip-item:${id}` &&
              preference.toEndpointKey !== `trip-item:${id}` &&
              preference.fromEndpointKey !== id &&
              preference.toEndpointKey !== id,
          ),
          selection: { type: "candidate", id: candidate.id },
        });
        return true;
      },
      undo: async () => {
        const state = get();
        const previous = state.past.at(-1);
        if (!previous) return;
        set({
          ...previous,
          past: state.past.slice(0, -1),
          future: [historyOf(state), ...state.future],
          selection: null,
        });
        await persist();
        await reconcileRoutes();
      },
      redo: async () => {
        const state = get();
        const next = state.future[0];
        if (!next) return;
        set({
          ...next,
          past: [...state.past, historyOf(state)],
          future: state.future.slice(1),
          selection: null,
        });
        await persist();
        await reconcileRoutes();
      },
      recalculateRoutes: reconcileRoutes,
      retryRoute: async (id) => {
        const segment = get().travelSegments.find((entry) => entry.id === id);
        if (segment) await loadSegment(segment);
      },
      setTravelMode: async (id, mode) => {
        const segment = get().travelSegments.find((entry) => entry.id === id),
          trip = get().activeTrip;
        if (!segment || !trip || segment.mode === mode) return;
        const existingPreference = get().segmentPreferences.find((value) => value.fromEndpointKey === segmentEndpointKey(segment.fromEndpoint) && value.toEndpointKey === segmentEndpointKey(segment.toEndpoint));
        const manual = existingPreference?.durationOverrideMinutes ?? null;
        const duration = resolveEffectiveDuration(mode === segment.mode ? segment.durationSeconds : null, manual);
        const changed = applyEffectiveMovement({
          ...segment,
          mode,
          durationSeconds: mode === segment.mode ? segment.durationSeconds : null,
          distanceMeters: mode === segment.mode ? segment.distanceMeters : null,
          provider: mode === segment.mode ? segment.provider : null,
          routeGeometry: mode === segment.mode ? segment.routeGeometry : undefined,
          durationOverrideMinutes: duration.durationOverrideMinutes,
          effectiveDurationSeconds: duration.effectiveDurationSeconds,
          durationSource: duration.durationSource,
          status: mode === "transit" ? duration.durationSource === "manual" ? "loaded" as const : "error" as const : "stale" as const,
          error: mode === "transit" ? duration.durationSource === "manual" ? null : "Scheduled transit routing is not supported by the configured provider." : null,
        }, get().tripItems);
        const preference = {
          tripId: trip.id,
          fromEndpointKey: segmentEndpointKey(segment.fromEndpoint),
          toEndpointKey: segmentEndpointKey(segment.toEndpoint),
          travelMode: mode,
          durationOverrideMinutes: manual,
        };
        const others = get().segmentPreferences.filter(
          (p) =>
            !(
              p.fromEndpointKey === segmentEndpointKey(segment.fromEndpoint) &&
              p.toEndpointKey === segmentEndpointKey(segment.toEndpoint)
            ),
        );
        set((state) => ({
          travelSegments: state.travelSegments.map((entry) =>
            entry.id === id ? changed : entry,
          ),
          segmentPreferences: [...others, preference],
        }));
        await persist();
        if (mode !== "transit") await loadSegment(changed);
      },
      setTravelDurationOverride: async (id, minutes) => {
        if (minutes != null && !isValidDurationOverride(minutes)) throw new Error("INVALID_DURATION_OVERRIDE");
        const state = get(), segment = state.travelSegments.find((entry) => entry.id === id), trip = state.activeTrip;
        if (!segment || !trip) return;
        const duration = resolveEffectiveDuration(segment.durationSeconds, minutes);
        const fromEndpointKey = segmentEndpointKey(segment.fromEndpoint), toEndpointKey = segmentEndpointKey(segment.toEndpoint);
        const existing = state.segmentPreferences.find((value) => value.fromEndpointKey === fromEndpointKey && value.toEndpointKey === toEndpointKey);
        const preference = { tripId: trip.id, fromEndpointKey, toEndpointKey, travelMode: existing?.travelMode ?? segment.mode, durationOverrideMinutes: minutes };
        const others = state.segmentPreferences.filter((value) => !(value.fromEndpointKey === fromEndpointKey && value.toEndpointKey === toEndpointKey));
        const updated = applyEffectiveMovement({ ...segment, durationOverrideMinutes: duration.durationOverrideMinutes, effectiveDurationSeconds: duration.effectiveDurationSeconds, durationSource: duration.durationSource, status: segment.mode === "transit" ? duration.durationSource === "manual" ? "loaded" : "error" : segment.status, error: segment.mode === "transit" ? duration.durationSource === "manual" ? null : "Scheduled transit routing is not supported by the configured provider." : segment.error }, state.tripItems);
        set({
          segmentPreferences: [...others, preference],
          travelSegments: state.travelSegments.map((entry) => entry.id === id ? updated : entry),
        });
        await persist();
        if (updated.movementSource === "unavailable" && updated.mode !== "transit") await loadSegment(updated);
      },
      suggestRepair: async (options = {}) => {
        const initial = get();
        if (!initial.activeTrip) return;
        const request = ++solveSequence;
        solveController?.abort();
        solveController = new AbortController();
        set({
          solverStatus: "preparing_routes",
          solverResult: null,
          proposalPreview: null,
        });
        try {
          await reconcileRoutes();
          if (request !== solveSequence) return;
          set({ solverStatus: "solving" });
          await Promise.resolve();
          if (request !== solveSequence) return;
          const state = get(),
            result = repairSchedule({
              tripId: state.activeTrip!.id,
              date: state.selectedDate,
              timezone: state.activeTrip!.timezone,
              items: itemsForDate(
                state.tripItems,
                state.selectedDate,
                state.activeTrip!.timezone,
              ),
              segments: state.travelSegments.filter(
                (x) => x.date === state.selectedDate,
              ),
              candidates: state.candidates,
            }, [], options);
          if (request !== solveSequence) return;
          set({
            solverStatus: result.status === "ready" ? "ready" : "unsupported",
            solverResult: result,
            proposalPreview: result.proposals[0] ?? null,
          });
        } catch {
          if (request === solveSequence) set({ solverStatus: "error" });
        }
      },
      findCandidateTime: async (candidateId, options = {}) => {
        const state = get();
        if (!state.activeTrip) return;
        const request = ++solveSequence;
        solveController?.abort();
        solveController = new AbortController();
        const date = options.date ?? state.selectedDate,
          mode = options.mode ?? "driving",
          snapshot = {
            tripId: state.activeTrip.id,
            date,
            timezone: state.activeTrip.timezone,
            items: itemsForDate(
              state.tripItems,
              date,
              state.activeTrip.timezone,
            ),
            segments: state.travelSegments.filter((x) => x.date === date),
            candidates: state.candidates,
          };
        set({
          solverStatus: "preparing_routes",
          solverResult: null,
          proposalPreview: null,
          selection: { type: "candidate", id: candidateId },
        });
        try {
          const prepared = await prepareCandidateRoutes(
            snapshot,
            candidateId,
            mode,
            routing,
            solveController.signal,
          );
          if (request !== solveSequence) return;
          if (prepared.status === "unsupported") {
            const result: SolverResult = {
              status: "unsupported",
              proposals: [],
              reason: prepared.reason,
            };
            set({ solverStatus: "unsupported", solverResult: result });
            return;
          }
          set({ solverStatus: "solving" });
          await Promise.resolve();
          if (request !== solveSequence) return;
          const result = insertCandidate(snapshot, candidateId, {
            routeEstimates: prepared.estimates,
            requireRouting: prepared.estimates.length > 0,
            mode,
            durationMinutes: options.durationMinutes,
            timeWindow: options.timeWindow,
          });
          if (request !== solveSequence) return;
          set({
            solverStatus: result.status === "ready" ? "ready" : "unsupported",
            solverResult: result,
            proposalPreview: result.proposals[0] ?? null,
          });
        } catch (error) {
          if (request !== solveSequence) return;
          if (error instanceof DOMException && error.name === "AbortError")
            set({
              solverStatus: "cancelled",
              solverResult: { status: "cancelled", proposals: [] },
            });
          else
            set({
              solverStatus: "error",
              solverResult: {
                status: "error",
                proposals: [],
                reason: "MISSING_ROUTING_DATA",
              },
            });
        }
      },
      findCandidatesTime: async (candidateIds, options) => {
        const state = get(); if (!state.activeTrip) return;
        const request = ++solveSequence; solveController?.abort(); solveController = new AbortController();
        const mode = options.mode ?? "driving", snapshot = { tripId: state.activeTrip.id, date: options.date, timezone: state.activeTrip.timezone, items: itemsForDate(state.tripItems, options.date, state.activeTrip.timezone), segments: state.travelSegments.filter((x) => x.date === options.date), candidates: state.candidates };
        set({ solverStatus: "preparing_routes", solverResult: null, proposalPreview: null, selection: null });
        try {
          const prepared = await prepareCandidateSetRoutes(snapshot, candidateIds, mode, routing, solveController.signal);
          if (request !== solveSequence) return;
          if (prepared.status === "unsupported") { set({ solverStatus: "unsupported", solverResult: { status: "unsupported", proposals: [], reason: prepared.reason } }); return; }
          set({ solverStatus: "solving" }); await Promise.resolve(); if (request !== solveSequence) return;
          const result = insertCandidates(snapshot, candidateIds, { routeEstimates: prepared.estimates, requireRouting: prepared.estimates.length > 0, mode, timeWindow: options.timeWindow });
          if (request !== solveSequence) return;
          set({ solverStatus: result.status === "ready" ? "ready" : "unsupported", solverResult: result, proposalPreview: result.proposals[0] ?? null });
        } catch (error) {
          if (request !== solveSequence) return;
          const cancelled = error instanceof DOMException && error.name === "AbortError";
          set({ solverStatus: cancelled ? "cancelled" : "error", solverResult: cancelled ? { status: "cancelled", proposals: [] } : { status: "error", proposals: [], reason: "MISSING_ROUTING_DATA" } });
        }
      },
      findPlaceTime: async (place, options) => {
        const state = get();
        if (!state.activeTrip || state.candidates.some((candidate) => candidate.provider === place.provider && candidate.placeId === place.providerPlaceId) || state.tripItems.some((item) => item.provider === place.provider && item.placeId === place.providerPlaceId)) return;
        const candidate = { ...placeToCandidate(place, state.activeTrip.id), estimatedDuration: options.durationMinutes };
        const request = ++solveSequence;
        solveController?.abort();
        solveController = new AbortController();
        set({ solverStatus: "preparing_routes", solverResult: null, proposalPreview: null, pendingProposalCandidate: candidate, selectedDate: options.date });
        const snapshot = { tripId: state.activeTrip.id, date: options.date, timezone: state.activeTrip.timezone, items: itemsForDate(state.tripItems, options.date, state.activeTrip.timezone), segments: state.travelSegments.filter((x) => x.date === options.date), candidates: [...state.candidates, candidate] };
        try {
          const groundedRouting: RoutingClient = { ...routing, route: routing.route.bind(routing), estimate: routing.estimate ? (tripId, from, to, mode, signal) => routing.estimate!(tripId, from.type === "candidate" && from.id === candidate.id ? { type: "providerPlace", id: place.providerPlaceId, provider: "geoapify" } : from, to.type === "candidate" && to.id === candidate.id ? { type: "providerPlace", id: place.providerPlaceId, provider: "geoapify" } : to, mode, signal) : undefined };
          const prepared = await prepareCandidateRoutes(snapshot, candidate.id, options.mode, groundedRouting, solveController.signal);
          if (request !== solveSequence) return;
          if (prepared.status === "unsupported") { set({ solverStatus: "unsupported", solverResult: { status: "unsupported", proposals: [], reason: prepared.reason } }); return; }
          set({ solverStatus: "solving" });
          await Promise.resolve();
          const result = insertCandidate(snapshot, candidate.id, { routeEstimates: prepared.estimates, requireRouting: prepared.estimates.length > 0, mode: options.mode, durationMinutes: options.durationMinutes });
          if (request !== solveSequence) return;
          set({ solverStatus: result.status === "ready" ? "ready" : "unsupported", solverResult: result, proposalPreview: result.proposals[0] ?? null });
        } catch (error) {
          if (request !== solveSequence) return;
          const cancelled = error instanceof DOMException && error.name === "AbortError";
          set({ solverStatus: cancelled ? "cancelled" : "error", solverResult: cancelled ? { status: "cancelled", proposals: [] } : { status: "error", proposals: [], reason: "MISSING_ROUTING_DATA" } });
        }
      },
      schedulePlaceManually: async (place, options) => {
        const state = get();
        if (!state.activeTrip || state.candidates.some((candidate) => candidate.provider === place.provider && candidate.placeId === place.providerPlaceId) || state.tripItems.some((item) => item.provider === place.provider && item.placeId === place.providerPlaceId)) return;
        const candidate = { ...placeToCandidate(place, state.activeTrip.id), estimatedDuration: options.durationMinutes };
        const scheduled = candidateToTripItem(candidate, options.date, options.startMinutes, state.activeTrip.timezone);
        await commit({ tripItems: [...state.tripItems, scheduled], selection: { type: "tripItem", id: scheduled.id } });
      },
      cancelSolve: () => {
        solveSequence++;
        solveController?.abort();
        solveController = null;
        set({
          solverStatus: "cancelled",
          solverResult: { status: "cancelled", proposals: [] },
          proposalPreview: null,
          pendingProposalCandidate: null,
        });
      },
      selectProposal: (proposalPreview) =>
        set({
          proposalPreview,
          solverStatus: proposalPreview ? "ready" : "idle",
          solverResult: proposalPreview ? get().solverResult : null,
        }),
      applyProposal: async () => {
        const state = get(),
          proposal = state.proposalPreview;
        if (!proposal) return;
        const proposalCandidates = [...state.candidates, ...(state.pendingProposalCandidate ? [state.pendingProposalCandidate] : [])].filter((c) => proposal.changes.some((x) => x.type === "schedule_candidate" && x.candidateId === c.id));
        const now = new Date().toISOString();
        const items = buildPreview(state.tripItems, proposalCandidates, proposal).map(
          (item) =>
            item.id.startsWith("proposal-")
              ? {
                  ...item,
                  id: generateId(),
                  provider: proposalCandidates.find((c) => `proposal-${c.id}` === item.id)?.provider ?? item.provider ?? null,
                  sourceCandidateId: proposalCandidates.find((c) => `proposal-${c.id}` === item.id)?.id ?? item.sourceCandidateId ?? null,
                  createdAt: now,
                  updatedAt: now,
                }
              : item,
        );
        const scheduledIds = new Set(
          proposal.changes
            .filter((x) => x.type === "schedule_candidate")
            .map((x) => x.candidateId),
        );
        await commit({
          tripItems: items,
          candidates: state.candidates.filter((c) => !scheduledIds.has(c.id)),
          selection: null,
          proposalPreview: null,
          solverResult: null,
          solverStatus: "idle",
          pendingProposalCandidate: null,
        });
      },
    };
  });
}

export const usePlannerStore = createPlannerStore();
