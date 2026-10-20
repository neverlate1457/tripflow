import { useDraggable } from "@dnd-kit/core";
import {
  AlertTriangle,
  CalendarMinus,
  GripVertical,
  Lock,
  MoreHorizontal,
  Pencil,
  Trash2,
} from "lucide-react";
import type { TripItem } from "@/domain/models";
import {
  durationMinutes,
  formatClock,
  minutesOfDay,
  minutesToPosition,
} from "@/domain/time";
import { typeStyle } from "@/components/trip/type-style";
import { ResizeHandle } from "./ResizeHandle";
import { useState } from "react";
import { unscheduleEligibility } from "@/domain/scheduling";
import { flightRouteLabel } from "@/domain/flight";

export function TripItemCard({
  item,
  timezone,
  pixelsPerHour,
  selected,
  conflict,
  constraintWarning,
  onSelect,
  onDelete,
  onUnschedule,
  onResize,
  bindingInactive = false,
}: {
  item: TripItem;
  timezone: string;
  pixelsPerHour: number;
  selected: boolean;
  conflict: boolean;
  constraintWarning: boolean;
  onSelect: () => void;
  onDelete: () => void;
  onUnschedule: () => void;
  onResize: (endMinutes: number) => void;
  bindingInactive?: boolean;
}) {
  const startMinutes = minutesOfDay(item.startAt, timezone);
  const duration = durationMinutes(item);
  const displayStartMinutes = item.type === "flight" && item.flightDetails?.originAirport
    ? minutesOfDay(item.startAt, item.flightDetails.originAirport.timezone) : startMinutes;
  const displayEndMinutes = item.type === "flight" && item.flightDetails?.destinationAirport
    ? minutesOfDay(item.endAt, item.flightDetails.destinationAirport.timezone) : startMinutes + duration;
  const [resizeDelta, setResizeDelta] = useState(0),
    [menuOpen, setMenuOpen] = useState(false);
  const fixed = item.flexibility === "fixed";
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `item:${item.id}`,
    disabled: fixed,
    data: { kind: "item", itemId: item.id, startMinutes, duration },
  });
  const meta = typeStyle[item.type];
  const transportIcon =
    item.type === "transport"
      ? (
          {
            train: "🚆",
            metro: "🚇",
            bus: "🚌",
            tram: "🚋",
            ferry: "⛴️",
            flight: "✈️",
            car: "🚗",
            taxi: "🚕",
            shuttle: "🚐",
            motorcycle: "🏍️",
            bicycle: "🚲",
            walking: "🚶",
            other: "↔️",
          } as const
        )[item.transportDetails?.mode ?? "other"]
      : meta.icon;
  const serviceLine =
    item.type === "transport"
      ? [item.transportDetails?.service, item.transportDetails?.serviceNumber]
          .filter(Boolean)
          .join(" ")
      : item.type === "flight"
        ? [item.flightDetails?.airline, item.flightDetails?.flightNumber]
            .filter(Boolean)
            .join(" ")
        : "";
  const top = minutesToPosition(startMinutes, pixelsPerHour);
  const height = Math.max((duration / 60) * pixelsPerHour + resizeDelta, 24);
  const style = { top, height },
    eligibility = unscheduleEligibility(item);
  return (
    <article
      id={`trip-item-${item.id}`}
      ref={setNodeRef}
      style={style}
      title={
        constraintWarning
          ? "Outside scheduling window"
          : fixed
            ? "Fixed activity"
            : undefined
      }
      onClick={(event) => {
        event.stopPropagation();
        onSelect();
      }}
      {...attributes}
      {...listeners}
      className={`absolute left-[70px] right-3 z-10 ${fixed ? "cursor-default" : "cursor-grab"} overflow-visible rounded-lg border px-2.5 py-1.5 shadow-sm transition-shadow ${meta.color} ${selected ? "ring-2 ring-sage-600 ring-offset-1" : ""} ${conflict || constraintWarning ? "border-l-4 border-l-amber-500" : ""} ${isDragging ? "z-40 opacity-30" : "hover:shadow-md"}`}
    >
      <div className="flex h-full items-start gap-1.5">
        {fixed ? (
          <Lock size={12} className="mt-0.5 shrink-0" />
        ) : (
          <GripVertical size={12} className="mt-0.5 shrink-0 opacity-35" />
        )}
        <span className="text-[10px] leading-4">{transportIcon}</span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1">
            <h3 className="truncate text-xs font-semibold leading-4">
              {item.type === "flight" ? flightRouteLabel(item) : item.title}
            </h3>
            {conflict && (
              <AlertTriangle size={11} className="shrink-0 text-amber-600" />
            )}
          </div>
          {serviceLine && height >= 42 && (
            <p className="truncate text-[10px] font-medium opacity-75">
              {serviceLine}
            </p>
          )}
          {bindingInactive && <p className="truncate text-[10px] font-semibold text-amber-700">Binding inactive · select a valid adjacent edge</p>}
          {height >= (serviceLine ? 56 : 42) && (
            <p className="text-[10px] font-medium opacity-70">
              {formatClock(displayStartMinutes)}–{formatClock(displayEndMinutes)}
            </p>
          )}
          {height >= 70 && item.address && (
            <p className="mt-1 truncate text-[10px] opacity-60">
              {item.address}
            </p>
          )}
        </div>
        <button
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            setMenuOpen(!menuOpen);
          }}
          className="rounded p-1 opacity-60 hover:bg-white/70"
          aria-label={`Actions for ${item.title}`}
        >
          <MoreHorizontal size={13} />
        </button>
      </div>
      {menuOpen && (
        <div
          onPointerDown={(event) => event.stopPropagation()}
          className="absolute right-1 top-7 z-50 w-48 rounded-lg border border-slate-200 bg-white p-1 text-slate-700 shadow-xl"
        >
          <button
            onClick={(event) => {
              event.stopPropagation();
              setMenuOpen(false);
              onSelect();
            }}
            className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-xs hover:bg-slate-50"
          >
            <Pencil size={12} />
            Edit
          </button>
          <button
            disabled={!eligibility.eligible}
            title={eligibility.eligible ? undefined : eligibility.reason}
            onClick={(event) => {
              event.stopPropagation();
              setMenuOpen(false);
              onUnschedule();
            }}
            className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-xs hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-300"
          >
            <CalendarMinus size={12} />
            Move to Want to go
          </button>
          <button
            onClick={(event) => {
              event.stopPropagation();
              setMenuOpen(false);
              onDelete();
            }}
            className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-xs text-rose-600 hover:bg-rose-50"
          >
            <Trash2 size={12} />
            Delete from trip
          </button>
        </div>
      )}
      {!fixed && (
        <ResizeHandle
          onPreview={setResizeDelta}
          onCommit={(delta) => {
            setResizeDelta(0);
            onResize(startMinutes + duration + (delta / pixelsPerHour) * 60);
          }}
        />
      )}
    </article>
  );
}
