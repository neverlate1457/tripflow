import { useEffect, useMemo, useState } from "react";
import { supportedTimezones, timezoneOffsetLabel } from "@/lib/timezones";

export function TimezoneCombobox({ value, date, onChange }: { value: string; date: string; onChange: (value: string) => void }) {
  const [open, setOpen] = useState(false), [query, setQuery] = useState(value), [active, setActive] = useState(0);
  useEffect(() => setQuery(value), [value]);
  const options = useMemo(() => supportedTimezones().filter((zone) => zone.toLowerCase().includes(query.toLowerCase())).slice(0, 80), [query]);
  const choose = (zone: string) => { onChange(zone); setQuery(zone); setOpen(false); };
  return <div className="relative">
    <input role="combobox" aria-label="Timezone" aria-expanded={open} aria-controls="timezone-options" value={query} onFocus={() => setOpen(true)} onChange={(event) => { setQuery(event.target.value); setOpen(true); setActive(0); }} onKeyDown={(event) => {
      if (event.key === "ArrowDown") { event.preventDefault(); setActive((active + 1) % Math.max(1, options.length)); }
      if (event.key === "ArrowUp") { event.preventDefault(); setActive((active - 1 + Math.max(1, options.length)) % Math.max(1, options.length)); }
      if (event.key === "Enter" && open && options[active]) { event.preventDefault(); choose(options[active]); }
      if (event.key === "Escape") setOpen(false);
    }} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-sage-500" />
    {open && <ul id="timezone-options" role="listbox" className="absolute z-50 mt-1 max-h-52 w-full overflow-auto rounded-lg border bg-white p-1 shadow-xl">
      {options.map((zone, index) => <li key={zone} role="option" aria-selected={zone === value} onMouseDown={(event) => { event.preventDefault(); choose(zone); }} className={`cursor-pointer rounded px-3 py-2 text-xs ${index === active ? "bg-sage-50" : ""}`}><span className="font-medium">{zone}</span><span className="ml-2 text-slate-400">{timezoneOffsetLabel(zone, date)}</span></li>)}
      {!options.length && <li className="px-3 py-2 text-xs text-slate-400">No valid timezone found.</li>}
    </ul>}
  </div>;
}
