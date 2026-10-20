import { useDraggable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import { CalendarSearch, Clock3, GripVertical, MapPin, X } from 'lucide-react';
import type { Candidate } from '@/domain/models';
import { typeStyle } from '@/components/trip/type-style';

export function CandidateCard({ candidate, selected, onSelect, onRemove, onFindTime }: { candidate: Candidate; selected: boolean; onSelect: () => void; onRemove: () => void; onFindTime: () => void }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: `candidate:${candidate.id}`, data: { kind: 'candidate', candidateId: candidate.id } });
  const style = { transform: CSS.Translate.toString(transform) };
  const meta = typeStyle[candidate.type];
  return <article ref={setNodeRef} id={`candidate-${candidate.id}`} style={style} onClick={onSelect} {...attributes} {...listeners} className={`group cursor-grab rounded-xl border bg-white p-3 shadow-sm transition hover:border-sage-300 hover:shadow-md active:cursor-grabbing ${selected ? 'border-sage-500 ring-2 ring-sage-100' : 'border-slate-200'} ${isDragging ? 'z-50 opacity-70 shadow-xl' : ''}`}>
    <div className="flex items-start gap-2">
      <GripVertical size={15} className="mt-0.5 shrink-0 text-slate-300 group-hover:text-sage-500" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2"><h3 className="truncate text-sm font-semibold">{candidate.title}</h3><div className="flex items-center gap-1"><span className={`rounded border px-1.5 py-0.5 text-[9px] font-bold uppercase ${meta.color}`}>{meta.label}</span><button onClick={(event) => { event.stopPropagation(); onRemove(); }} className="rounded p-0.5 text-slate-300 hover:text-rose-500" aria-label={`Remove ${candidate.title}`}><X size={12} /></button></div></div>
        <p className="mt-1 flex items-center gap-1 truncate text-[11px] text-slate-500"><MapPin size={11} />{candidate.address}</p>
        <div className="mt-2 flex items-center justify-between gap-2"><p className="flex items-center gap-1 text-[11px] font-medium text-slate-500"><Clock3 size={11} />{candidate.estimatedDuration ?? 'Duration needed'}{candidate.estimatedDuration ? ' min' : ''}</p><button onPointerDown={(event)=>event.stopPropagation()} onClick={(event)=>{event.stopPropagation();onFindTime();}} className="flex items-center gap-1 rounded-md bg-sage-50 px-2 py-1 text-[10px] font-semibold text-sage-700 hover:bg-sage-100"><CalendarSearch size={11}/>Find time</button></div>
      </div>
    </div>
  </article>;
}
