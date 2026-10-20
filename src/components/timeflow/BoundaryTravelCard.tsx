import { Bike, Car, Footprints, LoaderCircle, RefreshCw } from "lucide-react";
import type { TripItem } from "@/domain/models";
import type { TravelMode, TravelSegment } from "@/domain/routing";
import { DAY_END_MINUTES, DAY_START_MINUTES, minutesOfDay, minutesToPosition } from "@/domain/time";
import { DurationOverrideEditor } from "./DurationOverrideEditor";

const icons = { driving: Car, walking: Footprints, cycling: Bike, transit: Car };

export function BoundaryTravelCard({ segment, boundaryName, item, side, timezone, pixelsPerHour, selected, onSelect, onMode, onRetry, onDurationOverride, boundTransport }: {
  segment: TravelSegment;
  boundaryName: string;
  item: TripItem;
  side: "start" | "end";
  timezone: string;
  pixelsPerHour: number;
  selected: boolean;
  onSelect: () => void;
  onMode: (mode: TravelMode) => void;
  onRetry: () => void;
  onDurationOverride: (minutes: number | null) => void;
  boundTransport?: TripItem | null;
}) {
  const loading = ["idle", "loading", "stale"].includes(segment.status), failed = segment.status === "error", Icon = icons[segment.mode];
  const anchorMinutes = side === "start" ? minutesOfDay(item.startAt, timezone) - 30 : minutesOfDay(item.endAt, timezone) + 30;
  const top = minutesToPosition(Math.max(DAY_START_MINUTES, Math.min(DAY_END_MINUTES, anchorMinutes)), pixelsPerHour);
  const from = side === "start" ? `Start: ${boundaryName}` : item.title, to = side === "start" ? item.title : `End: ${boundaryName}`;
  return <div id={`travel-segment-${segment.id}`} style={{ top }} onClick={(event) => { event.stopPropagation(); onSelect(); }} className={`absolute left-[78px] right-5 z-20 -translate-y-1/2 rounded-lg border border-dashed px-2.5 py-1.5 text-[10px] shadow-sm ${selected ? "border-sky-400 bg-sky-50 ring-2 ring-sky-100" : failed ? "border-rose-300 bg-rose-50 text-rose-700" : "border-sage-300 bg-sage-50/95 text-slate-700"}`}>
    <div className="flex items-center gap-2">{loading && !boundTransport ? <LoaderCircle size={12} className="animate-spin"/> : <Icon size={12}/>}<span className="truncate font-semibold">{from} → {to}</span>{boundTransport ? <><span className="ml-auto truncate font-semibold">{boundTransport.transportDetails?.service || boundTransport.title}</span><span className="capitalize">{boundTransport.transportDetails?.mode} · {Math.ceil((segment.effectiveDurationSeconds ?? 0)/60)} min · Manual</span></> : <><select aria-label={`Travel mode from ${from} to ${to}`} value={segment.mode} disabled={loading} onClick={(event) => event.stopPropagation()} onChange={(event) => onMode(event.target.value as TravelMode)} className="ml-auto rounded border bg-white px-1 py-0.5"><option value="driving">Drive</option><option value="walking">Walk</option><option value="cycling">Cycle</option><option value="transit">Transit (manual only)</option></select><span className="font-semibold">{loading ? "Calculating…" : segment.effectiveDurationSeconds == null ? failed ? "Unsupported" : "Unavailable" : `${Math.ceil(segment.effectiveDurationSeconds / 60)} min${segment.durationSource === "manual" ? " · Manual" : ""}`}</span>{failed && segment.mode !== "transit" && <button onClick={(event) => { event.stopPropagation(); onRetry(); }}><RefreshCw size={10}/></button>}</>}</div>
    {selected && <><p className="mt-1 truncate text-[9px] opacity-70">{boundTransport ? "Canonical bound Manual Transport" : "Derived day boundary travel · edit location in Day context"}</p>{!boundTransport && <DurationOverrideEditor segment={segment} onSave={onDurationOverride}/>}</>}
  </div>;
}
