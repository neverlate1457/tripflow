import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, ChevronRight, LoaderCircle, MapPin, X } from "lucide-react";
import type { DayContext, GroundedPlaceRef, NormalizedPlace, Trip } from "@/domain/models";
import { HttpPlaceSearchClient, type PlaceSearchClient } from "@/services/client-place-search";
import type { SaveStatus } from "@/stores/planner-store";

export type DayContextLocationSlot = "startLocation" | "baseLocation" | "endLocation";
type Slot = DayContextLocationSlot;
const labels: Record<Slot, string> = { startLocation: "Start", baseLocation: "Base", endLocation: "End" };

export function dayContextSummary(context: DayContext | null, trip: Trip): string {
  const configured = (["startLocation", "baseLocation", "endLocation"] as Slot[])
    .flatMap((slot) => context?.[slot] ? [`${labels[slot]}: ${context[slot]!.name}`] : []);
  if (configured.length) return configured.join(" · ");
  return `Not configured${trip.destination ? ` · Trip fallback: ${trip.destination.name}` : ""}`;
}

export function DayContextEditor({ trip, date, context, saveStatus, saveError, onSave, searchClient, defaultExpanded = false }: {
  trip: Trip;
  date: string;
  context: DayContext | null;
  saveStatus: SaveStatus;
  saveError: string | null;
  onSave: (slot: Slot, place: GroundedPlaceRef | null) => Promise<void>;
  searchClient?: PlaceSearchClient;
  defaultExpanded?: boolean;
}) {
  const client = useRef(searchClient ?? new HttpPlaceSearchClient()), sequence = useRef(0);
  const [expanded, setExpanded] = useState(defaultExpanded), [active, setActive] = useState<Slot | null>(null), [query, setQuery] = useState(""), [results, setResults] = useState<NormalizedPlace[]>([]), [selected, setSelected] = useState<NormalizedPlace | null>(null), [status, setStatus] = useState<"idle"|"loading"|"error">("idle");
  useEffect(() => { setActive(null); setQuery(""); setResults([]); setSelected(null); }, [date, trip.id]);
  useEffect(() => {
    if (!active || !query.trim()) { setResults([]); setStatus("idle"); return; }
    const id = ++sequence.current, timer = window.setTimeout(async () => {
      setStatus("loading");
      try {
        const values = await client.current.search(query.trim(), trip.destination ? { latitude: trip.destination.latitude, longitude: trip.destination.longitude } : undefined);
        if (id === sequence.current) { setResults(values); setStatus("idle"); }
      } catch { if (id === sequence.current) setStatus("error"); }
    }, 300);
    return () => window.clearTimeout(timer);
  }, [active, query, trip.destination?.latitude, trip.destination?.longitude]);
  const close = () => { setActive(null); setQuery(""); setResults([]); setSelected(null); setStatus("idle"); };
  const saveSelected = async () => {
    if (!active || !selected) return;
    await onSave(active, normalizedPlaceToGroundedPlaceRef(selected));
    close();
  };
  return <section className="border-b border-slate-200 bg-white px-4 py-2" aria-label={`Day context for ${date}`}>
    <button
      type="button"
      aria-expanded={expanded}
      aria-controls="day-context-editor-content"
      aria-label={`${expanded ? "Collapse" : "Expand"} day context for ${date}`}
      onClick={() => { if (expanded) close(); setExpanded((value) => !value); }}
      className="flex w-full min-w-0 items-center gap-2 rounded-md py-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sage-500"
    >
      <span className="shrink-0 text-[10px] font-bold uppercase tracking-wider text-slate-400">Day context</span>
      <span className="min-w-0 flex-1 break-words text-[10px] text-slate-600">{dayContextSummary(context, trip)}</span>
      <span className={`shrink-0 text-[10px] ${saveStatus === "error" ? "text-rose-600" : "text-slate-400"}`}>{saveStatus === "saving" ? "Saving…" : saveStatus === "error" ? "Save failed" : saveStatus === "saved" ? "Saved" : ""}</span>
      {expanded ? <ChevronDown aria-hidden="true" size={14} className="shrink-0 text-slate-400"/> : <ChevronRight aria-hidden="true" size={14} className="shrink-0 text-slate-400"/>}
    </button>
    {expanded && <div id="day-context-editor-content">
    <div className="mt-2 flex flex-wrap items-center gap-2">
      {(["startLocation", "baseLocation", "endLocation"] as Slot[]).map((slot) => {
        const location = context?.[slot] ?? null;
        return <div key={slot} className="min-w-[150px] flex-1 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-2">
          <div className="flex items-start justify-between gap-2"><div className="min-w-0"><p className="text-[9px] font-bold uppercase tracking-wide text-slate-400">{labels[slot]}</p><p className="truncate text-xs font-semibold text-slate-700">{location?.name ?? "Not set"}</p>{!location && slot === "baseLocation" && trip.destination && <p className="truncate text-[9px] text-slate-400">Trip fallback: {trip.destination.name}</p>}</div><div className="flex gap-1"><button onClick={() => { setActive(slot); setQuery(""); setResults([]); setSelected(null); }} className="text-[10px] font-semibold text-sage-700">{location ? "Change" : "Set"}</button>{location && <button aria-label={`Clear ${labels[slot]}`} onClick={() => void onSave(slot, null)} className="text-slate-400 hover:text-rose-600"><X size={12}/></button>}</div></div>
        </div>;
      })}
    </div>
    {saveError && saveStatus === "error" && <p className="mt-1 text-[10px] text-rose-600">{saveError}</p>}
    {active && <div className="mt-2 rounded-xl border border-sage-200 bg-sage-50 p-3">
      <div className="flex items-center gap-2"><MapPin size={13} className="text-sage-600"/><p className="text-xs font-semibold">Set {labels[active]} for {date}</p><button onClick={close} className="ml-auto" aria-label="Close location search"><X size={14}/></button></div>
      <input autoFocus aria-label={`Search ${labels[active]} location`} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search provider-backed places" className="mt-2 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs outline-none focus:border-sage-500"/>
      {status === "loading" && <p className="mt-2 flex items-center gap-1 text-[10px] text-slate-500"><LoaderCircle size={11} className="animate-spin"/>Searching…</p>}
      {status === "error" && <p className="mt-2 text-[10px] text-rose-600">Place search failed. Try again.</p>}
      <div className="mt-2 grid max-h-36 gap-1 overflow-y-auto sm:grid-cols-2 lg:grid-cols-3">{results.map((place) => <button key={`${place.provider}:${place.providerPlaceId}`} onClick={() => setSelected(place)} className={`rounded-lg border bg-white p-2 text-left ${selected?.providerPlaceId === place.providerPlaceId ? "border-sage-500 ring-1 ring-sage-300" : "border-slate-200"}`}><p className="truncate text-[11px] font-semibold">{place.name}</p><p className="truncate text-[9px] text-slate-500">{place.address}</p></button>)}</div>
      {selected && <div className="mt-2 flex items-center gap-2 text-[10px]"><Check size={12} className="text-sage-600"/><span className="min-w-0 flex-1 truncate">{selected.name}</span><button disabled={saveStatus === "saving"} onClick={() => void saveSelected()} className="rounded-lg bg-sage-600 px-3 py-1.5 font-semibold text-white disabled:bg-slate-300">Save location</button></div>}
    </div>}
    </div>}
  </section>;
}

export function normalizedPlaceToGroundedPlaceRef(place: NormalizedPlace): GroundedPlaceRef {
  return {
    name: place.name,
    formattedAddress: place.address ?? null,
    latitude: place.location.latitude,
    longitude: place.location.longitude,
    provider: place.provider,
    providerPlaceId: place.providerPlaceId,
    timezone: null,
  };
}
