import { useEffect, useMemo, useRef, useState } from "react";
import { LngLat, LngLatBounds, Map, Marker, NavigationControl, type MapMouseEvent } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { Candidate, NormalizedPlace, PlannerSelection, TripDestination, TripItem } from "@/domain/models";
import { itemsForDate } from "@/domain/time";
import type { TravelSegment } from "@/domain/routing";
import type { ScheduleProposal } from "@/domain/planning";
import type { PlaceSuggestion } from "@/domain/discovery";
import { HttpMapPlaceClient } from "@/services/client-map-places";
import type { DiscoveryMapContext } from "@/services/client-place-discovery";
import { selectedFlightRoute } from "@/domain/flight-route";

type PointType = "tripItem" | "candidate" | "searchResult" | "suggestion" | "mapPlace";
type MapPoint = { id: string; type: PointType; title: string; latitude: number; longitude: number; place: NormalizedPlace; item?: TripItem; candidate?: Candidate };
export function mapMarkerAppearance(type: PointType) {
  if (type === "tripItem") return { symbol: "✓", className: "trip-map-marker--scheduled" };
  if (type === "candidate") return { symbol: "♥", className: "trip-map-marker--candidate" };
  if (type === "suggestion") return { symbol: "◆", className: "trip-map-marker--suggestion" };
  return { symbol: "●", className: "trip-map-marker--search" };
}
export const selectionForMapPoint = (point: Pick<MapPoint, "id" | "type">): PlannerSelection => ({ type: point.type, id: point.id });
export const shouldCenterMapSelection = (selection: PlannerSelection) => selection?.type === "suggestion";
export function proposalPreviewIds(proposal: ScheduleProposal | null, items: TripItem[]) { const ids = new Set<string>(); for (const c of proposal?.changes ?? []) ids.add(c.type === "schedule_candidate" ? c.candidateId : c.itemId); if (proposal?.kind === "candidate_insertion") { const c = proposal.changes.find((x) => x.type === "schedule_candidate"); if (c?.type === "schedule_candidate") { const all = [...items, { id: `proposal-${c.candidateId}`, startAt: c.startAt, endAt: c.endAt } as TripItem].sort((a, b) => a.startAt.localeCompare(b.startAt)), i = all.findIndex((x) => x.id === `proposal-${c.candidateId}`); if (i > 0) ids.add(all[i - 1].id); if (i < all.length - 1) ids.add(all[i + 1].id); } } return ids; }
export const proposalRouteFeatures = (proposal: ScheduleProposal | null) => (proposal?.routeEstimates ?? []).filter((x) => x.geometry).map((x) => ({ type: "Feature" as const, properties: { fromId: x.fromId, toId: x.toId }, geometry: x.geometry! }));
const asPlace = (v: Candidate | TripItem): NormalizedPlace => ({ provider: v.provider ?? "unknown", providerPlaceId: v.placeId ?? v.id, name: v.title, location: { latitude: v.latitude!, longitude: v.longitude! }, address: v.address ?? undefined });

interface ResizeEventTarget {
  addEventListener(type: string, listener: EventListener): void;
  removeEventListener(type: string, listener: EventListener): void;
}
export function installMapResizeRecovery(
  map: Pick<Map, "resize"> & Partial<Pick<Map, "dragPan" | "touchZoomRotate">>,
  container: Element,
  options: {
    windowTarget?: ResizeEventTarget;
    viewportTarget?: ResizeEventTarget | null;
    createObserver?: (callback: ResizeObserverCallback) => Pick<ResizeObserver, "observe" | "disconnect">;
    requestFrame?: (callback: FrameRequestCallback) => number;
    cancelFrame?: (id: number) => void;
  } = {},
) {
  const windowTarget = options.windowTarget ?? window,
    viewportTarget = options.viewportTarget === undefined ? window.visualViewport : options.viewportTarget,
    requestFrame = options.requestFrame ?? requestAnimationFrame,
    cancelFrame = options.cancelFrame ?? cancelAnimationFrame,
    createObserver = options.createObserver ?? ((callback) => new ResizeObserver(callback));
  let frame: number | null = null;
  const resize = () => {
    if (frame != null) cancelFrame(frame);
    frame = requestFrame(() => {
      frame = null;
      map.resize();
      if (import.meta.env.DEV && typeof window !== "undefined" && (window as Window & { __TRIPFLOW_GESTURE_DEBUG__?: boolean }).__TRIPFLOW_GESTURE_DEBUG__)
        console.debug("TripFlow map viewport recovery", { container: container.getBoundingClientRect().toJSON?.() ?? null, dragPanEnabled: map.dragPan?.isEnabled(), touchZoomRotateEnabled: map.touchZoomRotate?.isEnabled() });
    });
  };
  const observer = createObserver(resize);
  observer.observe(container);
  windowTarget.addEventListener("resize", resize);
  windowTarget.addEventListener("orientationchange", resize);
  viewportTarget?.addEventListener("resize", resize);
  viewportTarget?.addEventListener("scroll", resize);
  return () => {
    if (frame != null) cancelFrame(frame);
    observer.disconnect();
    windowTarget.removeEventListener("resize", resize);
    windowTarget.removeEventListener("orientationchange", resize);
    viewportTarget?.removeEventListener("resize", resize);
    viewportTarget?.removeEventListener("scroll", resize);
  };
}

export function TripMap({ items, candidates, results, suggestions = [], discoveryContext = null, segments, selectedDate, timezone, selection, proposal, destination, onSelect, onWantToGo, onAddToTimeflow, onUseManualLocation }: { items: TripItem[]; candidates: Candidate[]; results: NormalizedPlace[]; segments: TravelSegment[]; selectedDate: string; timezone: string; selection: PlannerSelection; onSelect: (s: PlannerSelection) => void; proposal: ScheduleProposal | null; suggestions?: PlaceSuggestion[]; discoveryContext?:DiscoveryMapContext|null; destination?: TripDestination | null; onWantToGo: (p: NormalizedPlace) => Promise<boolean>; onAddToTimeflow: (p: NormalizedPlace, candidateId?: string) => void; onUseManualLocation?: (coordinate: { latitude: number; longitude: number }) => void }) {
  const containerRef = useRef<HTMLDivElement>(null), mapRef = useRef<Map | null>(null), markersRef = useRef<Marker[]>([]), flightMarkersRef = useRef<Marker[]>([]), fitted = useRef(false), client = useRef(new HttpMapPlaceClient()), sequence = useRef(0), controller = useRef<AbortController | null>(null);
  const [popup, setPopup] = useState<{ place?: NormalizedPlace; coordinate: { latitude: number; longitude: number }; status: "ready" | "loading" | "unverified" | "error"; error?: string } | null>(null);
  const [nearby, setNearby] = useState<NormalizedPlace[]>([]), [nearbyStatus, setNearbyStatus] = useState<"idle" | "loading" | "loaded" | "error">("idle");
  const [nearbyRadius, setNearbyRadius] = useState(3000);
  const points = useMemo<MapPoint[]>(() => {
    const scheduled = itemsForDate(items, selectedDate, timezone).filter((x) => x.latitude != null && x.longitude != null), canonicalKeys = new Set(scheduled.map((x) => `${x.provider}:${x.placeId}`));
    const saved = candidates.filter((x) => x.latitude != null && x.longitude != null && !canonicalKeys.has(`${x.provider}:${x.placeId}`)); saved.forEach((x) => canonicalKeys.add(`${x.provider}:${x.placeId}`));
    const ephemeral = new Set<string>(), include = (place: NormalizedPlace) => { const key = `${place.provider}:${place.providerPlaceId}`; if (canonicalKeys.has(key) || ephemeral.has(key)) return false; ephemeral.add(key); return true; };
    return [...scheduled.map((item) => ({ id: item.id, type: "tripItem" as const, title: item.title, latitude: item.latitude!, longitude: item.longitude!, place: asPlace(item), item })), ...saved.map((candidate) => ({ id: candidate.id, type: "candidate" as const, title: candidate.title, latitude: candidate.latitude!, longitude: candidate.longitude!, place: asPlace(candidate), candidate })), ...suggestions.filter(({ place }) => include(place)).map(({ id, place }) => ({ id, type: "suggestion" as const, title: place.name, latitude: place.location.latitude, longitude: place.location.longitude, place })), ...results.filter(include).map((place) => ({ id: place.providerPlaceId, type: "searchResult" as const, title: place.name, latitude: place.location.latitude, longitude: place.location.longitude, place })), ...nearby.filter(include).map((place) => ({ id: place.providerPlaceId, type: "mapPlace" as const, title: place.name, latitude: place.location.latitude, longitude: place.location.longitude, place }))];
  }, [items, candidates, results, suggestions, nearby, selectedDate, timezone]);
  const previewIds = useMemo(() => proposalPreviewIds(proposal, itemsForDate(items, selectedDate, timezone)), [proposal, items, selectedDate, timezone]);
  const flightPreview = useMemo(() => selectedFlightRoute(selection, items), [selection, items]);
  const stateFor = (place: NormalizedPlace) => ({ candidate: candidates.find((x) => x.provider === place.provider && x.placeId === place.providerPlaceId), item: items.find((x) => x.provider === place.provider && x.placeId === place.providerPlaceId) });

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = new Map({ container: containerRef.current, style: "https://tiles.openfreemap.org/styles/liberty", center: destination ? [destination.longitude, destination.latitude] : [127.68, 26.3], zoom: destination ? 11 : 8.5 });
    map.addControl(new NavigationControl({ showCompass: false }), "top-right");
    const click = async (event: MapMouseEvent) => {
      const feature = map.queryRenderedFeatures(event.point).find((x) => typeof x.properties?.name === "string" && x.geometry.type === "Point");
      const coordinate = { latitude: event.lngLat.lat, longitude: event.lngLat.lng }; setNearby([]); controller.current?.abort(); controller.current = new AbortController(); const request = ++sequence.current;
      if (!feature) { setPopup({ coordinate, status: "unverified" }); return; }
      const coordinates = feature.geometry.type === "Point" ? feature.geometry.coordinates : [event.lngLat.lng, event.lngLat.lat]; setPopup({ coordinate, status: "loading" });
      try { const place = await client.current.resolve({ name: String(feature.properties?.name), category: typeof feature.properties?.class === "string" ? feature.properties.class : typeof feature.properties?.type === "string" ? feature.properties.type : undefined, latitude: coordinates[1], longitude: coordinates[0] }, controller.current.signal); if (request !== sequence.current) return; setPopup(place ? { place, coordinate: place.location, status: "ready" } : { coordinate, status: "unverified" }); if (place) onSelect({ type: "mapPlace", id: place.providerPlaceId }); }
      catch (error) { if (request === sequence.current && !(error instanceof DOMException && error.name === "AbortError")) setPopup({ coordinate, status: "error", error: error instanceof Error ? error.message : "Map lookup failed" }); }
    };
    map.on("click", click); mapRef.current = map; return () => { controller.current?.abort(); map.off("click", click); map.remove(); mapRef.current = null; };
  }, []);
  useEffect(() => {
    const container = containerRef.current;
    const map = mapRef.current;
    if (!container || !map || typeof ResizeObserver === "undefined") return;
    return installMapResizeRecovery(map, container);
  }, []);

  useEffect(() => {
    const map = mapRef.current; if (!map) return; markersRef.current.forEach((m) => m.remove()); markersRef.current = [];
    for (const point of points) { const el = document.createElement("button"); el.type = "button"; el.title = point.title; el.setAttribute("aria-label", `Select ${point.title}`); const segment = selection?.type === "travelSegment" ? segments.find((s) => s.id === selection.id) : null; const selected = selection?.type === point.type && selection.id === point.id || point.type === "tripItem" && !!segment && [segment.fromTripItemId, segment.toTripItemId].includes(point.id) || previewIds.has(point.id); const appearance = mapMarkerAppearance(point.type); el.className = `trip-map-marker ${selected ? "trip-map-marker--selected" : ""}`; el.style.zIndex = selected ? "2" : "1"; const body = document.createElement("span"); body.className = `trip-map-marker__body ${appearance.className}`; body.setAttribute("aria-hidden", "true"); body.textContent = appearance.symbol; el.appendChild(body); el.addEventListener("click", (event) => { event.stopPropagation(); onSelect(selectionForMapPoint(point)); setPopup({ place: point.place, coordinate: point.place.location, status: "ready" }); }); markersRef.current.push(new Marker({ element: el, anchor: "center" }).setLngLat([point.longitude, point.latitude]).addTo(map)); }
    if (points.length && !fitted.current) { const bounds = new LngLatBounds(); points.forEach((p) => bounds.extend([p.longitude, p.latitude])); map.fitBounds(bounds, { padding: 45, maxZoom: 13, duration: 0 }); fitted.current = true; }
  }, [points, selection, onSelect, segments, previewIds]);
  useEffect(() => { const handler = (e: KeyboardEvent) => { if (e.key === "Escape") { setPopup(null); setNearby([]); } }; window.addEventListener("keydown", handler); return () => window.removeEventListener("keydown", handler); }, []);
  useEffect(() => { const map = mapRef.current, source = "proposal-routes", layer = "proposal-routes-line"; if (!map) return; const clear = () => { if (map.getLayer(layer)) map.removeLayer(layer); if (map.getSource(source)) map.removeSource(source); }; const draw = () => { clear(); const features = proposalRouteFeatures(proposal); if (!features.length) return; map.addSource(source, { type: "geojson", data: { type: "FeatureCollection", features } }); map.addLayer({ id: layer, type: "line", source, paint: { "line-color": "#e7795e", "line-width": 5, "line-dasharray": [2, 2] } }); }; if (map.isStyleLoaded()) draw(); else map.once("load", draw); return clear; }, [proposal]);
  useEffect(() => { const map=mapRef.current,source="discovery-corridor",layer="discovery-corridor-line"; if(!map)return; const clear=()=>{if(map.getLayer(layer))map.removeLayer(layer);if(map.getSource(source))map.removeSource(source);}; const draw=()=>{clear();if(discoveryContext?.routeGeometry){map.addSource(source,{type:"geojson",data:{type:"Feature",properties:{},geometry:discoveryContext.routeGeometry}});map.addLayer({id:layer,type:"line",source,paint:{"line-color":"#2563eb","line-width":4,"line-opacity":0.65}});} const bounds=new LngLatBounds(); if(discoveryContext)bounds.extend([discoveryContext.anchor.longitude,discoveryContext.anchor.latitude]); suggestions.forEach(({place})=>bounds.extend([place.location.longitude,place.location.latitude])); if(discoveryContext||suggestions.length)map.fitBounds(bounds,{padding:55,maxZoom:discoveryContext?.geographicScope==="city_area"?11:13,duration:0});}; if(map.isStyleLoaded())draw();else map.once("load",draw);return clear;},[discoveryContext,suggestions]);
  useEffect(() => { if (!selection || !mapRef.current) return; const point = points.find((x) => x.type === selection.type && x.id === selection.id); if (!point) return; if (shouldCenterMapSelection(selection)) mapRef.current.easeTo({ center: [point.longitude, point.latitude], zoom: Math.max(mapRef.current.getZoom(), 13) }); else if (!mapRef.current.getBounds().contains(new LngLat(point.longitude, point.latitude))) mapRef.current.panTo([point.longitude, point.latitude]); }, [selection, points, discoveryContext]);
  useEffect(() => { const map = mapRef.current, segment = selection?.type === "travelSegment" ? segments.find((x) => x.id === selection.id) : null, source = "selected-travel-route", layer = "selected-travel-route-line"; if (!map) return; const clear = () => { if (map.getLayer(layer)) map.removeLayer(layer); if (map.getSource(source)) map.removeSource(source); }; const draw = () => { clear(); if (!segment?.routeGeometry) return; map.addSource(source, { type: "geojson", data: { type: "Feature", properties: {}, geometry: segment.routeGeometry } }); map.addLayer({ id: layer, type: "line", source, paint: { "line-color": "#2563eb", "line-width": 6 } }); }; if (map.isStyleLoaded()) draw(); else map.once("load", draw); return clear; }, [selection, segments]);
  useEffect(() => {
    const map = mapRef.current, source = "selected-flight-route", layer = "selected-flight-route-line";
    if (!map) return;
    const clear = () => {
      flightMarkersRef.current.forEach((marker) => marker.remove()); flightMarkersRef.current = [];
      if (map.getLayer(layer)) map.removeLayer(layer);
      if (map.getSource(source)) map.removeSource(source);
    };
    const draw = () => {
      clear();
      if (!flightPreview) return;
      map.addSource(source, { type: "geojson", data: { type: "Feature", properties: { approximate: true }, geometry: flightPreview.geometry } });
      map.addLayer({ id: layer, type: "line", source, paint: { "line-color": "#2563eb", "line-width": 4, "line-opacity": 0.85, "line-dasharray": [2, 2] } });
      const endpoints = [flightPreview.origin, flightPreview.destination];
      const endpointCoordinates = [flightPreview.geometry.coordinates[0], flightPreview.geometry.coordinates.at(-1)!];
      endpoints.forEach((airport, index) => {
        const element = document.createElement("div");
        element.setAttribute("aria-label", `${index === 0 ? "Departure" : "Arrival"} airport ${airport.iataCode ?? airport.name}`);
        Object.assign(element.style, { borderRadius: "9999px", background: "#2563eb", color: "white", border: "2px solid white", boxShadow: "0 2px 8px #0005", fontSize: "10px", fontWeight: "700", padding: "3px 6px" });
        element.textContent = airport.iataCode ?? airport.name;
        flightMarkersRef.current.push(new Marker({ element }).setLngLat(endpointCoordinates[index]).addTo(map));
      });
      const bounds = new LngLatBounds();
      flightPreview.geometry.coordinates.forEach((coordinate) => bounds.extend(coordinate));
      map.fitBounds(bounds, { padding: 70, maxZoom: 6, duration: 0 });
    };
    if (map.isStyleLoaded()) draw(); else map.once("load", draw);
    return clear;
  }, [flightPreview]);
  const searchAround = async () => { if (!popup) return; controller.current?.abort(); controller.current = new AbortController(); const request = ++sequence.current; setNearbyStatus("loading"); try { const values = await client.current.nearby(popup.coordinate.latitude, popup.coordinate.longitude, nearbyRadius, controller.current.signal); if (request === sequence.current) { setNearby(values); setNearbyStatus("loaded"); } } catch (error) { if (request === sequence.current && !(error instanceof DOMException && error.name === "AbortError")) setNearbyStatus("error"); } };
  const current: { candidate?: Candidate; item?: TripItem } = popup?.place ? stateFor(popup.place) : {};
  return <section className="relative h-full min-h-[280px] min-w-0 overflow-hidden border-r border-slate-200 bg-[#e8eee7]" aria-label="Trip map"><div ref={containerRef} className="absolute inset-0" />{destination && <div className="pointer-events-none absolute left-3 top-3 rounded-lg bg-white/90 px-2 py-1 text-[10px] font-semibold shadow">Destination · {destination.name}</div>}{flightPreview && <div className="pointer-events-none absolute left-3 top-10 rounded-lg bg-blue-50/95 px-2 py-1 text-[10px] font-semibold text-blue-800 shadow">Approximate great-circle flight route</div>}
    {popup && <div role="dialog" aria-label="Map place" className="absolute bottom-10 left-3 right-3 z-10 max-w-sm rounded-xl border bg-white p-3 shadow-xl"><button aria-label="Close map place" onClick={() => { setPopup(null); setNearby([]); }} className="absolute right-2 top-2">×</button>
      {popup.status === "loading" && <p className="text-xs font-medium">Verifying this place…</p>}{popup.status === "error" && <p className="text-xs text-rose-700">{popup.error}</p>}{popup.status === "unverified" && <><p className="text-xs font-medium">TripFlow couldn't verify this map place.</p><p className="mt-1 text-[10px] text-slate-500">Search provider-backed places near this point instead.</p></>}
      {popup.place && <><h3 className="pr-6 text-sm font-semibold">{popup.place.name}</h3><p className="mt-1 text-[10px] text-slate-500">{popup.place.category ?? "Place"}{popup.place.address ? ` · ${popup.place.address}` : ""}</p><div className="mt-3 grid grid-cols-2 gap-2">{current.item ? <button onClick={() => onSelect({ type: "tripItem", id: current.item!.id })} className="rounded-lg bg-sage-50 px-2 py-2 text-xs font-semibold text-sage-700">Scheduled · View</button> : <button disabled={!!current.candidate} onClick={() => void onWantToGo(popup.place!)} className="rounded-lg border px-2 py-2 text-xs font-semibold disabled:bg-slate-100">{current.candidate ? "In Want to go ✓" : "Want to go"}</button>}{!current.item && <button onClick={() => onAddToTimeflow(popup.place!, current.candidate?.id)} className="rounded-lg bg-sage-600 px-2 py-2 text-xs font-semibold text-white">Add to Timeflow</button>}{onUseManualLocation && <button onClick={() => onUseManualLocation(popup.coordinate)} className="col-span-2 rounded-lg border px-2 py-2 text-xs font-semibold">Use coordinates for manual item</button>}</div></>}
      {!popup.place && <><label className="mt-3 block text-[10px] font-semibold text-slate-500">Nearby radius<select aria-label="Nearby radius" value={nearbyRadius} onChange={(event) => setNearbyRadius(Number(event.target.value))} className="ml-2 rounded border bg-white px-2 py-1"><option value={1000}>1 km</option><option value={3000}>3 km</option><option value={5000}>5 km</option></select></label><div className="mt-2 flex gap-2"><button disabled={nearbyStatus === "loading"} onClick={() => void searchAround()} className="rounded-lg bg-sage-600 px-3 py-2 text-xs font-semibold text-white">{nearbyStatus === "loading" ? "Searching…" : "Search around here"}</button>{onUseManualLocation && <button onClick={() => onUseManualLocation(popup.coordinate)} className="rounded-lg border px-3 py-2 text-xs font-semibold">Use pin for manual item</button>}</div></>}{nearbyStatus === "error" && <p className="mt-2 text-[10px] text-rose-600">Nearby search failed. Try again.</p>}{nearbyStatus === "loaded" && !nearby.length && <p className="mt-2 text-[10px] text-slate-500">No grounded places found within {nearbyRadius / 1000} km.</p>}
      {!!nearby.length && <div className="mt-3 max-h-36 space-y-1 overflow-y-auto">{nearby.map((place) => <button key={place.providerPlaceId} onClick={() => { onSelect({ type: "mapPlace", id: place.providerPlaceId }); setPopup({ place, coordinate: place.location, status: "ready" }); }} className="block w-full rounded-lg bg-slate-50 p-2 text-left text-xs"><b>{place.name}</b><span className="block truncate text-[9px] text-slate-500">{place.address}</span></button>)}</div>}
    </div>}<div className="pointer-events-none absolute bottom-3 left-3 rounded-lg bg-white/90 px-2 py-1 text-[9px] shadow">● Search · <span className="text-blue-600">◆ Suggestion</span> · <span className="text-coral">♥ Want to go</span> · <b>✓ Scheduled</b></div></section>;
}
