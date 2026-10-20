import { useEffect, useMemo, useState } from "react";
import { AlertCircle, ArrowLeft, CalendarDays } from "lucide-react";
import { buildItineraryOverview } from "@/domain/itinerary-overview";
import { usePlannerStore } from "@/stores/planner-store";
import { MultiDayCalendar } from "./MultiDayCalendar";

const dateLabel = (date: string, options: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat("en-US", { timeZone: "UTC", ...options }).format(
    new Date(`${date}T12:00:00Z`),
  );

export function ItineraryOverview({ tripId }: { tripId: string }) {
  const state = usePlannerStore();
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  useEffect(() => {
    void state.hydrate(tripId);
  }, [tripId]);

  useEffect(() => {
    if (state.activeTrip?.id === tripId)
      setSelectedDate((current) =>
        current &&
        current >= state.activeTrip!.startDate &&
        current <= state.activeTrip!.endDate
          ? current
          : state.activeTrip!.startDate,
      );
  }, [state.activeTrip?.id, tripId]);

  const days = useMemo(
    () =>
      state.activeTrip
        ? buildItineraryOverview(
            state.activeTrip,
            state.tripItems,
            state.dayContexts,
            state.travelSegments,
          )
        : [],
    [state.activeTrip, state.tripItems, state.dayContexts, state.travelSegments],
  );

  if (state.loadStatus === "initial" || state.loadStatus === "loading")
    return (
      <main className="flex min-h-screen items-center justify-center bg-canvas">
        <div className="text-sm font-medium text-slate-600">Loading itinerary…</div>
      </main>
    );

  if (state.loadStatus === "error" || !state.activeTrip)
    return (
      <main className="flex min-h-screen items-center justify-center bg-canvas p-6">
        <div className="max-w-sm rounded-2xl border bg-white p-8 text-center">
          <AlertCircle className="mx-auto text-rose-500" />
          <h1 className="mt-3 font-semibold">Trip unavailable</h1>
          <p className="mt-1 text-sm text-slate-500">{state.loadError}</p>
          <button onClick={() => void state.retryHydration()} className="mt-4 rounded-lg bg-sage-600 px-4 py-2 text-sm font-semibold text-white">Try again</button>
        </div>
      </main>
    );

  const trip = state.activeTrip;
  const activeDate = selectedDate ?? trip.startDate;
  const range = `${dateLabel(trip.startDate, { month: "short", day: "numeric" })} – ${dateLabel(trip.endDate, { month: "short", day: "numeric", year: "numeric" })}`;

  return (
    <main className="min-h-screen overflow-x-hidden bg-canvas text-ink">
      <header className="sticky top-0 z-50 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <a href="/" aria-label="Back to all trips" className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"><ArrowLeft size={18}/></a>
            <div className="min-w-0">
              <h1 className="truncate text-lg font-semibold">{trip.name}</h1>
              <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-slate-500">
                <span className="inline-flex items-center gap-1"><CalendarDays size={12}/>{range}</span>
                {trip.destination && <span>{trip.destination.name}</span>}
                <span>{trip.timezone}</span>
              </div>
            </div>
          </div>
          <nav aria-label="Trip view" className="flex rounded-xl bg-slate-100 p-1 text-sm">
            <a href={`/trips/${trip.id}?date=${activeDate}`} className="rounded-lg px-3 py-1.5 text-slate-600 hover:bg-white">Planner</a>
            <span aria-current="page" className="rounded-lg bg-white px-3 py-1.5 font-semibold text-sage-700 shadow-sm">Itinerary</span>
          </nav>
        </div>
      </header>
      <div className="px-3 py-4 sm:px-5 sm:py-6">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 className="text-xl font-semibold">Itinerary calendar</h2>
            <p className="mt-1 text-xs text-slate-500">Read-only overview · select a day or activity to edit it in Planner</p>
          </div>
          <a href={`/trips/${trip.id}?date=${activeDate}`} className="rounded-lg bg-sage-600 px-3 py-2 text-xs font-semibold text-white">Edit selected day in Planner</a>
        </div>
        <MultiDayCalendar
          trip={trip}
          days={days}
          allItems={state.tripItems}
          selectedDate={activeDate}
          onSelectDate={setSelectedDate}
        />
      </div>
    </main>
  );
}
