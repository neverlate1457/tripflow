import { useEffect, useState } from "react";
import { MAX_DURATION_OVERRIDE_MINUTES, type TravelSegment } from "@/domain/routing";

export function DurationOverrideEditor({ segment, onSave }: { segment: TravelSegment; onSave: (minutes: number | null) => void }) {
  const [value, setValue] = useState(segment.durationOverrideMinutes?.toString() ?? ""), numeric = Number(value), valid = value !== "" && Number.isInteger(numeric) && numeric >= 1 && numeric <= MAX_DURATION_OVERRIDE_MINUTES;
  useEffect(() => setValue(segment.durationOverrideMinutes?.toString() ?? ""), [segment.durationOverrideMinutes]);
  return <div className="mt-1.5 flex flex-wrap items-center gap-1.5 border-t border-slate-200/70 pt-1.5" onClick={(event) => event.stopPropagation()}>
    <span className="text-[9px] text-slate-500">Provider estimate: {segment.durationSeconds == null ? "unavailable" : `${Math.ceil(segment.durationSeconds / 60)} min`}</span>
    <label className="ml-auto flex items-center gap-1 text-[9px] font-semibold">Custom <input aria-label="Custom travel duration in minutes" type="number" min={1} max={MAX_DURATION_OVERRIDE_MINUTES} step={1} value={value} onChange={(event) => setValue(event.target.value)} className="w-16 rounded border bg-white px-1.5 py-1 text-[10px]"/> min</label>
    <button disabled={!valid || numeric === segment.durationOverrideMinutes} onClick={() => onSave(numeric)} className="rounded bg-sage-600 px-2 py-1 text-[9px] font-semibold text-white disabled:bg-slate-300">Save</button>
    {segment.durationOverrideMinutes != null && <button onClick={() => onSave(null)} className="px-1 text-[9px] font-semibold text-sage-700">Reset to estimate</button>}
  </div>;
}
