import { DAY_END_MINUTES, DAY_START_MINUTES, formatClock, minutesToPosition } from '@/domain/time';

export function TimeGrid({ pixelsPerHour }: { pixelsPerHour: number }) {
  const hours = Array.from({ length: (DAY_END_MINUTES - DAY_START_MINUTES) / 60 + 1 }, (_, index) => DAY_START_MINUTES + index * 60);
  return <>{hours.map((minutes) => <div key={minutes} className="absolute left-0 right-0 border-t border-slate-200" style={{ top: minutesToPosition(minutes, pixelsPerHour) }}><span className="absolute -top-2.5 left-3 w-11 bg-white pr-2 text-right text-[10px] font-medium tabular-nums text-slate-400">{formatClock(minutes)}</span></div>)}</>;
}
