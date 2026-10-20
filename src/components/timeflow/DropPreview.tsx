import { formatClock, minutesToPosition } from '@/domain/time';

export function DropPreview({ startMinutes, duration, pixelsPerHour }: { startMinutes: number; duration: number; pixelsPerHour: number }) {
  return <div className="pointer-events-none absolute left-[70px] right-3 z-30 rounded-lg border-2 border-dashed border-sage-500 bg-sage-100/70" style={{ top: minutesToPosition(startMinutes, pixelsPerHour), height: Math.max((duration / 60) * pixelsPerHour, 24) }}>
    <span className="absolute -left-16 top-1 rounded bg-sage-700 px-1.5 py-0.5 text-[9px] font-semibold text-white">{formatClock(startMinutes)}</span>
  </div>;
}
