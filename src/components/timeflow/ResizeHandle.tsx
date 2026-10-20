import type { PointerEvent as ReactPointerEvent } from 'react';

export function ResizeHandle({ onPreview, onCommit }: { onPreview: (deltaY: number) => void; onCommit: (deltaY: number) => void }) {
  const start = (event: ReactPointerEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    event.preventDefault();
    const origin = event.clientY;
    let lastDelta = 0;
    const move = (moveEvent: PointerEvent) => { lastDelta = moveEvent.clientY - origin; onPreview(lastDelta); };
    const end = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', end); onCommit(lastDelta); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
  };
  return <button onPointerDown={start} onClick={(event) => event.stopPropagation()} className="absolute bottom-0 left-0 right-0 flex h-2 cursor-ns-resize items-end justify-center" aria-label="Resize activity"><span className="mb-0.5 h-0.5 w-8 rounded bg-current opacity-25" /></button>;
}
