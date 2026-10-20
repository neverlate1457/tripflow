import type { PlanningAITraceEvent } from "@/services/planning-ai-debug";

const copy = (value: unknown) => void navigator.clipboard.writeText(typeof value === "string" ? value : JSON.stringify(value, null, 2));

export function PlanningAITracePayload({ event }: { event: PlanningAITraceEvent }) {
  if (event.sourceType !== "llm") return null;
  if (!event.payloadCaptured) return <p className="mt-1 text-slate-500">Payload not captured</p>;
  return <div className="mt-2 space-y-1">
    <details className="rounded border bg-white"><summary className="cursor-pointer px-2 py-1 font-semibold">Input</summary><pre className="max-h-72 overflow-auto border-t bg-slate-950 p-2 text-slate-100">{JSON.stringify(event.inputSummary, null, 2)}</pre></details>
    <details className="rounded border bg-white"><summary className="cursor-pointer px-2 py-1 font-semibold">Output</summary><pre className="max-h-72 overflow-auto border-t bg-slate-950 p-2 text-slate-100">{JSON.stringify(event.outputSummary, null, 2)}</pre></details>
    <div className="flex flex-wrap gap-2"><button type="button" className="underline" onClick={() => copy(event.inputSummary)}>Copy Prompt</button><button type="button" className="underline" onClick={() => copy(event.outputSummary)}>Copy Response</button><button type="button" className="underline" onClick={() => copy(event)}>Copy Stage</button></div>
  </div>;
}
