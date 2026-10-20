import { ArrowLeft, CalendarDays, Pencil, Redo2, Undo2 } from 'lucide-react';
import type { Trip } from '@/domain/models';
import type { SaveStatus } from '@/stores/planner-store';

export function TripHeader({ trip, saveStatus, onRetry, canUndo, canRedo, onUndo, onRedo, onRename }: { trip: Trip; saveStatus: SaveStatus; onRetry: () => void; canUndo: boolean; canRedo: boolean; onUndo: () => void; onRedo: () => void; onRename: () => void }) {
  const range = `${new Date(`${trip.startDate}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${new Date(`${trip.endDate}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
  return <header className="safe-area-top flex min-h-[64px] shrink-0 items-center justify-between gap-2 border-b border-slate-200 bg-white px-2 py-2 sm:h-[72px] sm:px-6 sm:py-0">
    <div className="flex min-w-0 items-center gap-2 sm:gap-4">
      <a href="/" className="flex min-h-11 min-w-11 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100" aria-label="All trips"><ArrowLeft size={17} /></a><div className="hidden h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-sage-600 text-sm font-black text-white sm:flex">TF</div>
      <div className="min-w-0">
        <div className="flex items-center gap-1.5"><h1 className="text-lg font-semibold tracking-tight">{trip.name}</h1><button onClick={onRename} className="text-slate-400 hover:text-sage-600" aria-label="Rename trip"><Pencil size={13} /></button></div>
        {trip.destination && <div className="mt-0.5 max-w-[520px] truncate text-[11px] text-slate-500">{trip.destination.formattedAddress ?? trip.destination.name}</div>}
        <div className="mt-0.5 flex items-center gap-1.5 truncate text-[10px] text-slate-500 sm:text-xs"><CalendarDays size={13} className="shrink-0" />{range} · {trip.timezone}</div>
      </div>
    </div>
    <div className="flex shrink-0 items-center gap-1 sm:gap-2">
      <nav aria-label="Trip view" className="mr-1 hidden rounded-lg bg-slate-100 p-1 text-xs sm:flex"><span aria-current="page" className="rounded-md bg-white px-2.5 py-1.5 font-semibold text-sage-700 shadow-sm">Planner</span><a href={`/trips/${trip.id}/itinerary`} className="rounded-md px-2.5 py-1.5 text-slate-600 hover:bg-white">Itinerary</a></nav>
      <a href={`/trips/${trip.id}/itinerary`} className="flex min-h-11 min-w-11 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 sm:hidden" aria-label="Open itinerary overview"><CalendarDays size={18}/></a>
      <div className="mr-1 flex overflow-hidden rounded-lg border border-slate-200 bg-white"><button disabled={!canUndo} onClick={onUndo} className="p-2 text-slate-500 hover:bg-slate-50 disabled:opacity-30" title="Undo"><Undo2 size={15} /></button><button disabled={!canRedo} onClick={onRedo} className="border-l border-slate-200 p-2 text-slate-500 hover:bg-slate-50 disabled:opacity-30" title="Redo"><Redo2 size={15} /></button></div>
      <button onClick={saveStatus === 'error' ? onRetry : undefined} aria-label={saveStatus === 'error' ? 'Save failed, retry' : saveStatus === 'saving' ? 'Saving trip' : 'Trip saved'} className={`${saveStatus === 'saved' ? 'hidden sm:block' : 'block'} min-h-11 rounded-full px-2 text-[10px] font-medium sm:px-3 sm:text-xs ${saveStatus === 'error' ? 'bg-rose-50 text-rose-700' : 'bg-sage-50 text-sage-700'}`}>{saveStatus === 'saving' ? 'Saving…' : saveStatus === 'error' ? 'Retry' : 'Saved'}</button>
    </div>
  </header>;
}
