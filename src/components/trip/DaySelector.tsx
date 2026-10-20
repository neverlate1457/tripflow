import type { Trip } from '@/domain/models';

function dateRange(start: string, end: string) {
  const values: string[] = [];
  const cursor = new Date(`${start}T12:00:00Z`);
  const last = new Date(`${end}T12:00:00Z`);
  while (cursor <= last) { values.push(cursor.toISOString().slice(0, 10)); cursor.setUTCDate(cursor.getUTCDate() + 1); }
  return values;
}

export function DaySelector({ trip, selected, onSelect }: { trip: Trip; selected: string; onSelect: (date: string) => void }) {
  return <nav className="flex h-[58px] shrink-0 items-end gap-2 overflow-x-auto border-b border-slate-200 bg-white px-2 sm:gap-6 sm:px-6" aria-label="Trip days">
    {dateRange(trip.startDate, trip.endDate).map((date, index) => {
      const value = new Date(`${date}T12:00:00Z`);
      const active = date === selected;
      return <button key={date} onClick={() => onSelect(date)} className={`relative flex h-full min-w-16 flex-col items-center justify-center text-sm transition ${active ? 'font-semibold text-sage-700' : 'text-slate-500 hover:text-slate-800'}`}>
        <span className="text-[10px] uppercase tracking-wider">Day {index + 1}</span>
        <span>{value.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
        {active && <span className="absolute bottom-0 h-0.5 w-full rounded bg-sage-600" />}
      </button>;
    })}
  </nav>;
}
