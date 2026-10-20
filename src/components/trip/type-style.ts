import type { TripItemType } from '@/domain/models';

export const typeStyle: Record<TripItemType, { icon: string; label: string; color: string }> = {
  place: { icon: '●', label: 'Place', color: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  restaurant: { icon: '◆', label: 'Food', color: 'bg-orange-50 text-orange-700 border-orange-200' },
  hotel: { icon: '■', label: 'Stay', color: 'bg-indigo-50 text-indigo-700 border-indigo-200' },
  transport: { icon: '→', label: 'Transit', color: 'bg-sky-50 text-sky-700 border-sky-200' },
  flight: { icon: '✈', label: 'Flight', color: 'bg-violet-50 text-violet-700 border-violet-200' },
  note: { icon: '✦', label: 'Note', color: 'bg-amber-50 text-amber-700 border-amber-200' },
};
