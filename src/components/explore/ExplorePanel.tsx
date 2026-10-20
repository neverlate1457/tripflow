import { useEffect, useState } from "react";
import { Check, LoaderCircle, Plus, Search, Sparkles } from "lucide-react";
import type {
  Candidate,
  NormalizedPlace,
  PlannerSelection,
} from "@/domain/models";
import { CandidateCard } from "./CandidateCard";
import { useDroppable } from "@dnd-kit/core";

export function ExplorePanel({
  candidates,
  results,
  query,
  searchStatus,
  searchError,
  selection,
  unscheduleDrop,
  onSearch,
  onClear,
  onSelect,
  onAdd,
  onRemove,
  onFindTime,
  onAddManual,
  mobileMode = "all",
}: {
  candidates: Candidate[];
  results: NormalizedPlace[];
  query: string;
  searchStatus: string;
  searchError: string | null;
  selection: PlannerSelection;
  onSearch: (query: string) => void;
  onClear: () => void;
  onSelect: (selection: PlannerSelection) => void;
  onAdd: (id: string) => void;
  onRemove: (id: string) => void;
  onFindTime: (id: string) => void;
  onAddManual: () => void;
  mobileMode?: "all" | "explore" | "candidates";
  unscheduleDrop: { eligible: boolean; reason?: string } | null;
}) {
  const [value, setValue] = useState(query);
  useEffect(() => {
    const timer = window.setTimeout(
      () => (value.trim() ? onSearch(value) : onClear()),
      350,
    );
    return () => clearTimeout(timer);
  }, [value]);
  useEffect(() => {
    if (selection?.type === "candidate")
      document
        .getElementById(`candidate-${selection.id}`)
        ?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [selection]);
  const selectedResult =
    selection?.type === "searchResult"
      ? results.find((result) => result.providerPlaceId === selection.id)
      : null;
  const alreadyAdded = (place: NormalizedPlace) =>
    candidates.some(
      (candidate) =>
        candidate.provider === place.provider &&
        candidate.placeId === place.providerPlaceId,
    );
  const { setNodeRef, isOver } = useDroppable({
    id: "want-to-go-dropzone",
    disabled: !unscheduleDrop?.eligible,
  });
  return (
    <aside className="flex min-h-0 min-w-0 flex-col border-r border-slate-200 bg-[#fafbf8]">
      {mobileMode !== "candidates" && <div className="border-b border-slate-200 p-4">
        <div className="mb-3 flex items-start justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold">Explore</h2>
            <p className="text-[11px] text-slate-500">
              Search places, then save ideas
            </p>
          </div>
          <button
            onClick={onAddManual}
            className="flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-[11px] font-semibold text-slate-700 hover:bg-slate-50"
          >
            <Plus size={13} /> Add
          </button>
        </div>
        <div className="relative">
          <Search
            size={14}
            className="absolute left-3 top-2.5 text-slate-400"
          />
          <input
            aria-label="Search places"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            placeholder="Search places or another city"
            className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-8 pr-3 text-xs outline-none focus:border-sage-500"
          />
        </div>
      </div>}
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {mobileMode !== "candidates" && value.trim() && (
          <section className="mb-5">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                Search results
              </h3>
              {searchStatus === "loading" && (
                <LoaderCircle
                  size={13}
                  className="animate-spin text-sage-600"
                />
              )}
            </div>
            {searchError && (
              <p className="rounded-lg bg-rose-50 p-2 text-[11px] text-rose-700">
                {searchError}
              </p>
            )}
            {searchStatus === "loaded" && !results.length && (
              <p className="rounded-lg border border-dashed p-4 text-center text-xs text-slate-400">
                No places found.
              </p>
            )}
            <div className="space-y-1.5">
              {results.map((place) => (
                <button
                  key={`${place.provider}:${place.providerPlaceId}`}
                  onClick={() =>
                    onSelect({
                      type: "searchResult",
                      id: place.providerPlaceId,
                    })
                  }
                  className={`w-full rounded-lg border bg-white p-2.5 text-left ${selection?.type === "searchResult" && selection.id === place.providerPlaceId ? "border-sage-500 ring-2 ring-sage-100" : "border-slate-200"}`}
                >
                  <p className="truncate text-xs font-semibold">{place.name}</p>
                  <p className="mt-1 truncate text-[10px] text-slate-500">
                    {place.address ?? place.category}
                  </p>
                </button>
              ))}
            </div>
            {selectedResult && (
              <div className="mt-2 rounded-xl border border-sage-200 bg-sage-50 p-3">
                <p className="text-xs font-semibold">{selectedResult.name}</p>
                <p className="mt-1 text-[10px] text-slate-500">
                  {selectedResult.category ?? "Place"} ·{" "}
                  {selectedResult.address}
                </p>
                <p className="mt-1 text-[9px] text-slate-400">
                  {selectedResult.location.latitude.toFixed(5)},{" "}
                  {selectedResult.location.longitude.toFixed(5)} ·{" "}
                  {selectedResult.attribution}
                </p>
                <button
                  disabled={alreadyAdded(selectedResult)}
                  onClick={() => onAdd(selectedResult.providerPlaceId)}
                  className="mt-3 flex w-full items-center justify-center gap-1 rounded-lg bg-sage-600 py-2 text-xs font-semibold text-white disabled:bg-slate-300"
                >
                  {alreadyAdded(selectedResult) ? (
                    <>
                      <Check size={12} /> Added to trip
                    </>
                  ) : (
                    "Add to trip"
                  )}
                </button>
              </div>
            )}
          </section>
        )}
        {mobileMode !== "explore" && <section
          ref={setNodeRef}
          className={`rounded-xl p-1 transition ${isOver && unscheduleDrop?.eligible ? "bg-sage-100 ring-2 ring-sage-500" : unscheduleDrop?.eligible ? "bg-sage-50/60 ring-1 ring-dashed ring-sage-300" : ""}`}
        >
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
              Want to go · {candidates.length}
            </h3>
            {unscheduleDrop?.eligible && (
              <span className="text-[10px] font-semibold text-sage-700">
                {isOver ? "Release to unschedule" : "Move to Want to go"}
              </span>
            )}
          </div>
          {unscheduleDrop &&
            !unscheduleDrop.eligible &&
            unscheduleDrop.reason && (
              <p className="mb-2 rounded-lg bg-amber-50 px-2 py-1.5 text-[10px] text-amber-700">
                {unscheduleDrop.reason}
              </p>
            )}
          <div className="space-y-2">
            {candidates.length ? (
              candidates.map((candidate) => (
                <CandidateCard
                  key={candidate.id}
                  candidate={candidate}
                  selected={
                    selection?.type === "candidate" &&
                    selection.id === candidate.id
                  }
                  onSelect={() =>
                    onSelect({ type: "candidate", id: candidate.id })
                  }
                  onRemove={() => onRemove(candidate.id)}
                  onFindTime={() => onFindTime(candidate.id)}
                />
              ))
            ) : (
              <div className="flex h-32 flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 p-5 text-center">
                <Sparkles size={18} className="mb-2 text-sage-500" />
                <p className="text-xs font-medium">No saved ideas yet</p>
                <p className="mt-1 text-[10px] text-slate-500">
                  Search above to add a place.
                </p>
              </div>
            )}
          </div>
        </section>}
      </div>
    </aside>
  );
}
