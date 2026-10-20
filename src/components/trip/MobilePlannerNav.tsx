import { CalendarRange, Heart, Map, Search } from "lucide-react";

export type MobilePlannerSection = "planner" | "explore" | "map" | "candidates";

const items: Array<{ id: MobilePlannerSection; label: string; Icon: typeof CalendarRange }> = [
  { id: "planner", label: "Planner", Icon: CalendarRange },
  { id: "explore", label: "Explore", Icon: Search },
  { id: "map", label: "Map", Icon: Map },
  { id: "candidates", label: "Candidates", Icon: Heart },
];

export function MobilePlannerNav({ active, onChange }: { active: MobilePlannerSection; onChange: (section: MobilePlannerSection) => void }) {
  return <nav aria-label="Mobile planner sections" className="safe-area-bottom fixed inset-x-0 bottom-0 z-[55] grid grid-cols-4 border-t border-slate-200 bg-white/95 px-1 pt-1 shadow-[0_-8px_24px_rgba(29,49,40,0.10)] backdrop-blur xl:hidden">
    {items.map(({ id, label, Icon }) => <button key={id} type="button" aria-current={active === id ? "page" : undefined} onClick={() => onChange(id)} className={`flex min-h-11 min-w-11 flex-col items-center justify-center gap-0.5 rounded-lg px-1 text-[10px] font-semibold ${active === id ? "bg-sage-50 text-sage-700" : "text-slate-500"}`}>
      <Icon aria-hidden="true" size={18}/><span>{label}</span>
    </button>)}
  </nav>;
}
