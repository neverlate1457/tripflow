import {
  AlertTriangle,
  Bike,
  Car,
  Footprints,
  LoaderCircle,
  RefreshCw,
} from "lucide-react";
import type { TravelMode, TravelSegment } from "@/domain/routing";
import type { TripItem } from "@/domain/models";
import { minutesOfDay, minutesToPosition } from "@/domain/time";
import { DurationOverrideEditor } from "./DurationOverrideEditor";

const icons = {
  driving: Car,
  walking: Footprints,
  cycling: Bike,
  transit: Car,
};
const mins = (seconds: number) => `${Math.ceil(seconds / 60)} min`;
export function segmentConnectorTop(
  from: TripItem,
  to: TripItem,
  timezone: string,
  pixelsPerHour: number,
) {
  const end = minutesOfDay(from.endAt, timezone),
    start = minutesOfDay(to.startAt, timezone);
  return minutesToPosition((end + start) / 2, pixelsPerHour);
}

export function TravelSegmentCard({
  segment,
  from,
  to,
  timezone,
  pixelsPerHour,
  selected,
  shortageSeconds,
  onSelect,
  onMode,
  onRetry,
  onDurationOverride,
  boundTransport,
}: {
  segment: TravelSegment;
  from: TripItem;
  to: TripItem;
  timezone: string;
  pixelsPerHour: number;
  selected: boolean;
  shortageSeconds?: number;
  onSelect: () => void;
  onMode: (mode: TravelMode) => void;
  onRetry: () => void;
  onDurationOverride: (minutes: number | null) => void;
  boundTransport?: TripItem | null;
}) {
  const Icon = icons[segment.mode],
    top = segmentConnectorTop(from, to, timezone, pixelsPerHour),
    loading =
      segment.status === "loading" ||
      segment.status === "idle" ||
      segment.status === "stale",
    failed = segment.status === "error";
  return (
    <div
      id={`travel-segment-${segment.id}`}
      role="button"
      tabIndex={0}
      aria-label={`Select travel from ${from.title} to ${to.title}`}
      title={failed ? (segment.error ?? "Route unavailable") : undefined}
      onClick={(event) => {
        event.stopPropagation();
        onSelect();
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault(); event.stopPropagation(); onSelect();
        }
      }}
      style={{ top }}
      className={`absolute left-[78px] right-5 z-20 -translate-y-1/2 rounded-lg border px-2.5 py-1.5 text-[10px] shadow-sm ${shortageSeconds != null ? "border-rose-300 bg-rose-50 text-rose-700" : selected ? "border-sky-400 bg-sky-50 ring-2 ring-sky-100" : "border-slate-200 bg-white/95 text-slate-600"}`}
    >
      <div className="flex items-center gap-2">
        {loading ? (
          <LoaderCircle size={12} className="animate-spin" />
        ) : shortageSeconds != null ? (
          <AlertTriangle size={12} />
        ) : (
          <Icon size={12} />
        )}
        {boundTransport ? <>
          <span className="truncate font-semibold">{boundTransport.transportDetails?.service || boundTransport.title}</span>
          <span className="capitalize">{boundTransport.transportDetails?.mode} · {Math.ceil((segment.effectiveDurationSeconds ?? 0) / 60)} min · Manual</span>
          <span className="ml-auto whitespace-nowrap">{new Intl.DateTimeFormat("en", { timeZone: timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(boundTransport.startAt))} → {new Intl.DateTimeFormat("en", { timeZone: timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(boundTransport.endAt))}</span>
        </> : <><select
          aria-label={`Travel mode from ${from.title} to ${to.title}`}
          value={segment.mode}
          disabled={loading}
          onClick={(event) => event.stopPropagation()}
          onChange={(event) => onMode(event.target.value as TravelMode)}
          className="rounded border border-slate-200 bg-white px-1.5 py-0.5 font-semibold text-slate-700"
        >
          <option value="driving">Driving</option>
          <option value="walking">Walking</option>
          <option value="cycling">Cycling</option>
          <option value="transit">
            Transit (manual only)
          </option>
        </select>
        <span className="font-semibold">
          {loading
            ? "Calculating route…"
            : failed
              ? "Route unavailable"
              : segment.effectiveDurationSeconds == null
                ? "Route unavailable"
                : `${mins(segment.effectiveDurationSeconds)}${segment.durationSource === "manual" ? " · Manual" : ""}${segment.distanceMeters != null ? ` · ${(segment.distanceMeters / 1000).toFixed(1)} km` : ""}`}
        </span>
        {shortageSeconds != null && (
          <span className="ml-auto font-semibold">
            ⚠ {mins(shortageSeconds)} short
          </span>
        )}
        {failed && (
          <button
            onClick={(event) => {
              event.stopPropagation();
              onRetry();
            }}
            className="ml-auto flex items-center gap-1 font-semibold text-rose-700"
          >
            <RefreshCw size={10} />
            Retry
          </button>
        )}
        </>}
      </div>
      {selected && !boundTransport && (
        <><p className="mt-1 truncate text-[9px] opacity-70">{from.title} → {to.title} · derived travel</p><DurationOverrideEditor segment={segment} onSave={onDurationOverride}/></>
      )}
    </div>
  );
}
