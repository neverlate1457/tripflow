import { useDroppable } from "@dnd-kit/core";
import { AlertTriangle, CalendarX2 } from "lucide-react";
import type { Candidate, DayContext, TripItem } from "@/domain/models";
import {
  DAY_END_MINUTES,
  DAY_START_MINUTES,
  durationMinutes,
  formatClock,
  itemsForDate,
  minutesOfDay,
  minutesToPosition,
  overlappingIds,
} from "@/domain/time";
import { DropPreview } from "./DropPreview";
import { TimeGrid } from "./TimeGrid";
import { TripItemCard } from "./TripItemCard";
import { useEffect, useState } from "react";
import type { TravelMode, TravelSegment } from "@/domain/routing";
import { TravelSegmentCard } from "./TravelSegmentCard";
import { BoundaryTravelCard } from "./BoundaryTravelCard";
import { analyzeDay } from "@/domain/constraints";
import type { ScheduleProposal } from "@/domain/planning";
import { previewProposal } from "@/domain/planning";
import { isBoundTransport } from "@/domain/bound-transport";

export const PIXELS_PER_HOUR = 64;
export interface Preview {
  startMinutes: number;
  duration: number;
}

export function Timeflow({
  items,
  candidates,
  segments,
  dayContext,
  selectedDate,
  timezone,
  selectedItemId,
  selectedSegmentId,
  preview,
  proposal,
  onSelect,
  onSelectSegment,
  onMode,
  onRetryRoute,
  onDurationOverride,
  onDelete,
  onUnschedule,
  onResize,
  onSuggestRepair,
}: {
  items: TripItem[];
  segments: TravelSegment[];
  dayContext: DayContext | null;
  selectedDate: string;
  timezone: string;
  selectedItemId: string | null;
  selectedSegmentId: string | null;
  preview: Preview | null;
  candidates: Candidate[];
  proposal: ScheduleProposal | null;
  onSelect: (id: string | null) => void;
  onSelectSegment: (id: string) => void;
  onMode: (id: string, mode: TravelMode) => void;
  onRetryRoute: (id: string) => void;
  onDurationOverride: (id: string, minutes: number | null) => void;
  onDelete: (id: string) => void;
  onUnschedule: (id: string) => void;
  onResize: (id: string, endMinutes: number) => void;
  onSuggestRepair: () => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: "timeflow-dropzone" });
  const daySegments = segments.filter(
    (segment) => segment.date === selectedDate,
  );
  const activeBoundTransportIds = new Set(daySegments.flatMap((segment) => segment.boundTransportItemId ? [segment.boundTransportItemId] : []));
  const visible = itemsForDate(items, selectedDate, timezone).filter((item) => !isBoundTransport(item) || !activeBoundTransportIds.has(item.id));
  const conflicts = overlappingIds(visible);
  const [issuesOpen, setIssuesOpen] = useState(false);
  const feasibility = analyzeDay(visible, daySegments);
  const proposalCandidateIds = new Set(proposal?.changes.filter((change) => change.type === "schedule_candidate").map((change) => change.candidateId) ?? []);
  const proposalCandidates = candidates.filter((value) => proposalCandidateIds.has(value.id));
  const proposed = proposal
    ? itemsForDate(
        previewProposal(visible, proposalCandidates, proposal),
        selectedDate,
        timezone,
      )
    : [];
  const changedIds = new Set(
    proposal?.changes.flatMap((change) =>
      change.type === "schedule_candidate" ? [] : [change.itemId],
    ) ?? [],
  );
  const height = ((DAY_END_MINUTES - DAY_START_MINUTES) / 60) * PIXELS_PER_HOUR;
  useEffect(() => {
    if (selectedItemId)
      document
        .getElementById(`trip-item-${selectedItemId}`)
        ?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [selectedItemId, selectedDate]);
  return (
    <section className="flex h-full min-h-0 min-w-0 flex-col bg-white">
      <div className="relative flex h-12 shrink-0 items-center justify-between border-b border-slate-200 px-4">
        <div>
          <h2 className="text-sm font-semibold">Timeflow</h2>
          <p className="text-[10px] text-slate-500">
            15-minute snap · drag to reschedule
          </p>
        </div>
        {feasibility.issues.length ? (
          <div className="flex items-center gap-2">
            <button
              onClick={onSuggestRepair}
              className="rounded-lg bg-sage-600 px-2.5 py-1.5 text-[10px] font-semibold text-white"
            >
              Suggest fix
            </button>
            <button
              onClick={() => setIssuesOpen(!issuesOpen)}
              className={`flex items-center gap-1 rounded-full px-2 py-1 text-[10px] font-medium ${feasibility.status === "error" ? "bg-rose-50 text-rose-700" : "bg-amber-50 text-amber-700"}`}
            >
              <AlertTriangle size={11} />
              {feasibility.issues.length} scheduling issues
            </button>
          </div>
        ) : (
          <span className="text-[10px] font-medium text-sage-700">
            ✓ Schedule feasible
          </span>
        )}
        {issuesOpen && feasibility.issues.length > 0 && (
          <div className="absolute right-3 top-10 z-50 w-72 rounded-xl border border-slate-200 bg-white p-2 shadow-xl">
            {feasibility.issues.map((issue, index) => (
              <button
                key={`${issue.code}-${index}`}
                onClick={() => {
                  setIssuesOpen(false);
                  issue.travelSegmentId
                    ? onSelectSegment(issue.travelSegmentId)
                    : onSelect(issue.tripItemIds.at(-1) ?? null);
                }}
                className="block w-full rounded-lg px-3 py-2 text-left text-xs hover:bg-slate-50"
              >
                <span className="font-semibold">
                  {issue.code.replaceAll("_", " ")}
                </span>
                <span className="block text-[10px] text-slate-500">
                  {issue.tripItemIds
                    .map(
                      (id) => items.find((item) => item.id === id)?.title ?? id,
                    )
                    .join(" → ")}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
      <div
        className="min-h-0 flex-1 overflow-y-auto"
        onClick={() => onSelect(null)}
      >
        <div
          ref={setNodeRef}
          className={`relative transition-colors ${isOver ? "bg-sage-50/40" : "bg-white"}`}
          style={{ height }}
        >
          <TimeGrid pixelsPerHour={PIXELS_PER_HOUR} />
          {segments
            .filter((segment) => segment.date === selectedDate)
            .map((segment) => {
              const from = items.find(
                  (item) => item.id === segment.fromTripItemId,
                ),
                to = items.find((item) => item.id === segment.toTripItemId);
              const boundTransport = segment.boundTransportItemId
                ? items.find((item) => item.id === segment.boundTransportItemId) ?? null
                : null;
              const selectMovement = () => {
                if (boundTransport) {
                  onSelect(boundTransport.id);
                  return;
                }
                onSelectSegment(segment.id);
              };
              if (from && to) return (
                <TravelSegmentCard
                  key={segment.id}
                  segment={segment}
                  from={from}
                  to={to}
                  timezone={timezone}
                  pixelsPerHour={PIXELS_PER_HOUR}
                  selected={boundTransport ? boundTransport.id === selectedItemId : segment.id === selectedSegmentId}
                  shortageSeconds={
                    Number(
                      feasibility.issues.find(
                        (issue) => issue.travelSegmentId === segment.id,
                      )?.details.shortBySeconds,
                    ) || undefined
                  }
                  onSelect={selectMovement}
                  onMode={(mode) => onMode(segment.id, mode)}
                  onRetry={() => onRetryRoute(segment.id)}
                  onDurationOverride={(minutes) => onDurationOverride(segment.id, minutes)}
                  boundTransport={boundTransport}
                />
              );
              const startItem = segment.toTripItemId ? items.find((item) => item.id === segment.toTripItemId) : null;
              const endItem = segment.fromTripItemId ? items.find((item) => item.id === segment.fromTripItemId) : null;
              const side = segment.fromEndpoint.kind === "day_start" ? "start" : segment.toEndpoint.kind === "day_end" ? "end" : null;
              const boundaryName = side === "start" ? dayContext?.startLocation?.name : side === "end" ? dayContext?.endLocation?.name : null;
              const item = side === "start" ? startItem : endItem;
              return side && boundaryName && item ? <BoundaryTravelCard key={segment.id} segment={segment} boundaryName={boundaryName} item={item} side={side} timezone={timezone} pixelsPerHour={PIXELS_PER_HOUR} selected={boundTransport ? boundTransport.id === selectedItemId : segment.id === selectedSegmentId} onSelect={selectMovement} onMode={(mode) => onMode(segment.id, mode)} onRetry={() => onRetryRoute(segment.id)} onDurationOverride={(minutes) => onDurationOverride(segment.id, minutes)} boundTransport={boundTransport}/> : null;
            })}
          {visible.map((item) => (
            <div
              key={item.id}
              className={changedIds.has(item.id) ? "opacity-25" : ""}
            >
              <TripItemCard
                item={item}
                timezone={timezone}
                pixelsPerHour={PIXELS_PER_HOUR}
                selected={item.id === selectedItemId}
                conflict={conflicts.has(item.id)}
                constraintWarning={feasibility.issues.some(
                  (issue) =>
                    (issue.tripItemIds.includes(item.id) &&
                      issue.code.includes("earliest")) ||
                    (issue.tripItemIds.includes(item.id) &&
                      issue.code.includes("latest")),
                )}
                onSelect={() => onSelect(item.id)}
                onDelete={() => onDelete(item.id)}
                onUnschedule={() => onUnschedule(item.id)}
                onResize={(end) => onResize(item.id, end)}
                bindingInactive={isBoundTransport(item) && !activeBoundTransportIds.has(item.id)}
              />
            </div>
          ))}
          {proposal &&
            proposed
              .filter(
                (item) =>
                  changedIds.has(item.id) || item.id.startsWith("proposal-"),
              )
              .map((item) => {
                const start = minutesOfDay(item.startAt, timezone),
                  duration = durationMinutes(item);
                return (
                  <div
                    key={`ghost-${item.id}`}
                    className="pointer-events-none absolute left-[70px] right-3 z-30 rounded-lg border-2 border-dashed border-sage-600 bg-sage-100/80 px-2.5 py-1.5 shadow-md"
                    style={{
                      top: minutesToPosition(start, PIXELS_PER_HOUR),
                      height: Math.max((duration / 60) * PIXELS_PER_HOUR, 24),
                    }}
                  >
                    <p className="truncate text-xs font-semibold">
                      Proposed · {item.title}
                    </p>
                    <p className="text-[10px] text-sage-800">
                      {formatClock(start)}–{formatClock(start + duration)}
                    </p>
                  </div>
                );
              })}
          {preview && (
            <DropPreview {...preview} pixelsPerHour={PIXELS_PER_HOUR} />
          )}
          {!visible.length && !preview && (
            <div className="absolute left-[70px] right-4 top-20 flex flex-col items-center rounded-xl border border-dashed border-slate-300 p-8 text-center text-slate-400">
              <CalendarX2 size={22} />
              <p className="mt-2 text-xs font-medium">No plans yet</p>
              <p className="text-[10px]">Drag an idea here to start the day.</p>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
