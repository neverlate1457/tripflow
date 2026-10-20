export function FilterTabs() {
  return <div className="flex gap-1 rounded-lg bg-slate-100 p-1 text-xs font-medium">
    <button className="flex-1 rounded-md bg-white px-2 py-1.5 text-slate-800 shadow-sm">All</button>
    <button className="flex-1 rounded-md px-2 py-1.5 text-slate-500 hover:text-slate-800">Places</button>
    <button className="flex-1 rounded-md px-2 py-1.5 text-slate-500 hover:text-slate-800">Food</button>
  </div>;
}
