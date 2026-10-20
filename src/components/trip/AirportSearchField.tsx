import { useEffect, useRef, useState } from "react";
import type { GroundedAirportRef, NormalizedPlace } from "@/domain/models";
import { HttpAirportSearchClient, type AirportSearchClient } from "@/services/client-airport-search";
import { airportLabel, airportRefFromPlace } from "@/domain/airport-search";
export { hasAirportEvidence } from "@/domain/airport-search";

export function AirportSearchField({ label, value, onChange, searchClient }: {
  label: string; value: GroundedAirportRef | null; onChange: (value: GroundedAirportRef | null) => void; searchClient?: AirportSearchClient;
}) {
  const client = useRef(searchClient ?? new HttpAirportSearchClient()), sequence = useRef(0);
  const [query, setQuery] = useState(""), [results, setResults] = useState<NormalizedPlace[]>([]), [status, setStatus] = useState<"idle"|"loading"|"error">("idle"), [editing, setEditing] = useState(false);
  useEffect(() => {
    if (query.trim().length < 2) { setResults([]); setStatus("idle"); return; }
    const request = ++sequence.current, controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setStatus("loading");
      try {
        const places = await client.current.search(query.trim(), { signal: controller.signal });
        if (request === sequence.current) { setResults(places.slice(0, 6)); setStatus("idle"); }
      } catch { if (!controller.signal.aborted && request === sequence.current) setStatus("error"); }
    }, 300);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [query]);
  const choose = (place: NormalizedPlace) => {
    const airport = airportRefFromPlace(place);
    if (!airport) return;
    onChange(airport); setQuery(""); setResults([]); setEditing(false);
  };
  return <div className="relative text-xs font-medium text-slate-600"><span>{label}</span>{value && !editing ? <div className="mt-1 rounded-lg border bg-white px-3 py-2"><div className="flex items-start justify-between gap-2"><div className="min-w-0"><p className="truncate font-semibold text-slate-700">{airportLabel(value)}</p><p className="truncate text-[10px] text-slate-400">{value.formattedAddress}</p><p className="text-[10px] text-sage-700">{value.timezone}</p></div><button type="button" onClick={() => setEditing(true)} className="text-rose-600">Change</button></div></div> : <><input aria-label={label} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="IATA code, airport, or city" className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm" autoCapitalize="characters"/>{value && editing && <button type="button" onClick={() => { setEditing(false); setQuery(""); setResults([]); }} className="mt-1 text-[10px] text-slate-500">Cancel change</button>}{status === "loading" && <p className="mt-1 text-[10px] text-slate-400">Searching airports…</p>}{status === "error" && <p className="mt-1 text-[10px] text-rose-600">Airport search unavailable.</p>}{status === "idle" && query.trim().length >= 2 && !results.length && <p className="mt-1 text-[10px] text-slate-400">No verified matching airport with timezone found.</p>}{results.length > 0 && <div className="absolute z-30 mt-1 max-h-44 w-full overflow-y-auto rounded-lg border bg-white shadow-lg">{results.map((place) => <button type="button" key={`${place.provider}:${place.providerPlaceId}`} onClick={() => choose(place)} className="block w-full border-b px-3 py-2 text-left"><span className="block font-semibold"><strong className="text-sage-700">{place.iataCode ?? ""}</strong>{place.iataCode ? " — " : ""}{place.name}</span><span className="block truncate text-[10px] text-slate-400">{place.address}</span><span className="block text-[10px] text-sage-700">{place.timezone}</span></button>)}</div>}</>}</div>;
}
