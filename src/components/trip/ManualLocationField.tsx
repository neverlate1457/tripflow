import { useEffect, useRef, useState } from "react";
import type { ConfirmedManualLocation, NormalizedPlace } from "@/domain/models";
import { manualLocationFromMap, manualLocationFromPlace } from "@/domain/manual-location";
import { HttpPlaceSearchClient } from "@/services/client-place-search";

export function ManualLocationField({ value, initialMapCoordinate, onChange }: {
  value: ConfirmedManualLocation | null;
  initialMapCoordinate?: { latitude: number; longitude: number } | null;
  onChange: (value: ConfirmedManualLocation | null) => void;
}) {
  const client = useRef(new HttpPlaceSearchClient());
  const sequence = useRef(0);
  const [query, setQuery] = useState(value?.originalInput ?? "");
  const [mapName, setMapName] = useState(value?.displayName ?? "Pinned location");
  const [results, setResults] = useState<NormalizedPlace[]>([]);
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");

  useEffect(() => {
    if (!query.trim() || value) { setResults([]); return; }
    const request = ++sequence.current;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setStatus("loading");
      try {
        const found = await client.current.search(query.trim(), { signal: controller.signal });
        if (request === sequence.current) { setResults(found.slice(0, 8)); setStatus("idle"); }
      } catch (error) {
        if (request === sequence.current && !(error instanceof DOMException && error.name === "AbortError")) setStatus("error");
      }
    }, 300);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [query, value]);

  if (value) return <div className="rounded-lg border border-sage-200 bg-sage-50 p-3 text-xs">
    <div className="flex items-start justify-between gap-3"><div><p className="font-semibold text-slate-800">{value.displayName}</p><p className="mt-1 text-slate-500">{value.formattedAddress ?? `${value.latitude.toFixed(5)}, ${value.longitude.toFixed(5)}`}</p><p className="mt-1 text-[10px] text-slate-400">Confirmed · {value.latitude.toFixed(5)}, {value.longitude.toFixed(5)}</p></div><button type="button" className="text-rose-600" onClick={() => { onChange(null); setQuery(""); }}>Clear</button></div>
  </div>;

  return <div className="space-y-2">
    <label className="block text-xs font-medium text-slate-600">Address or location name
      <input aria-label="Address or location name" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Street address, place, or business" className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm" />
    </label>
    {status === "loading" && <p className="text-[10px] text-slate-500">Searching grounded locations…</p>}
    {status === "error" && <p role="alert" className="text-[10px] text-rose-600">Location search is unavailable. Try again.</p>}
    {!!results.length && <div aria-label="Location candidates" className="max-h-52 overflow-y-auto rounded-lg border bg-white">
      {results.map((place) => <button type="button" key={`${place.provider}:${place.providerPlaceId}`} className="block w-full border-b px-3 py-2 text-left last:border-b-0 hover:bg-sage-50" onClick={() => onChange(manualLocationFromPlace(place, query))}>
        <span className="block text-xs font-semibold">{place.name}</span><span className="block text-[10px] text-slate-500">{place.address ?? "Address unavailable"}</span><span className="block text-[9px] text-slate-400">{place.location.latitude.toFixed(5)}, {place.location.longitude.toFixed(5)}</span>
      </button>)}
    </div>}
    {initialMapCoordinate && <div className="rounded-lg border border-blue-200 bg-blue-50 p-3"><p className="text-[10px] font-semibold text-blue-800">Map pin · {initialMapCoordinate.latitude.toFixed(5)}, {initialMapCoordinate.longitude.toFixed(5)}</p><div className="mt-2 flex gap-2"><input aria-label="Map location display name" value={mapName} onChange={(event) => setMapName(event.target.value)} className="min-w-0 flex-1 rounded-md border px-2 py-1.5 text-xs"/><button type="button" disabled={!mapName.trim()} onClick={() => onChange(manualLocationFromMap(initialMapCoordinate.latitude, initialMapCoordinate.longitude, mapName))} className="rounded-md bg-sage-600 px-3 text-xs font-semibold text-white disabled:opacity-50">Use pin</button></div></div>}
    <p className="text-[10px] text-slate-400">Choose a result explicitly. TripFlow never selects the first match automatically.</p>
  </div>;
}
