import { describe, expect, it } from 'vitest';
import { vi } from 'vitest';
import { installMapResizeRecovery, mapMarkerAppearance, proposalPreviewIds, proposalRouteFeatures, selectionForMapPoint, shouldCenterMapSelection } from './TripMap';

describe('scheduled map marker selection', () => {
  it('transitions to the shared TripItem selection', () => expect(selectionForMapPoint({ type: 'tripItem', id: 'item-1' })).toEqual({ type: 'tripItem', id: 'item-1' }));
});
it('synchronizes ephemeral suggestion marker selection',()=>expect(selectionForMapPoint({type:'suggestion',id:'geo:p1'})).toEqual({type:'suggestion',id:'geo:p1'}));
it('centers explicit suggestion focus without changing other map selection behavior',()=>{expect(shouldCenterMapSelection({type:'suggestion',id:'geo:p1'})).toBe(true);expect(shouldCenterMapSelection({type:'tripItem',id:'item-1'})).toBe(false);expect(shouldCenterMapSelection(null)).toBe(false)});
it('highlights insertion neighbors and removes geometry when preview clears',()=>{const items=[{id:'a',startAt:'2026-01-01T09:00:00Z',endAt:'2026-01-01T10:00:00Z'},{id:'b',startAt:'2026-01-01T12:00:00Z',endAt:'2026-01-01T13:00:00Z'}] as never;const proposal={kind:'candidate_insertion',changes:[{type:'schedule_candidate',candidateId:'c',startAt:'2026-01-01T10:30:00Z',endAt:'2026-01-01T11:30:00Z'}],routeEstimates:[{fromId:'a',toId:'c',geometry:{type:'LineString',coordinates:[[1,1],[2,2]]}}]} as never;expect([...proposalPreviewIds(proposal,items)]).toEqual(expect.arrayContaining(['a','b','c']));expect(proposalRouteFeatures(proposal)).toHaveLength(1);expect(proposalRouteFeatures(null)).toEqual([])});
it('preserves marker semantics independently from responsive sizing', () => {
  expect(mapMarkerAppearance('tripItem')).toEqual({ symbol: '✓', className: 'trip-map-marker--scheduled' });
  expect(mapMarkerAppearance('candidate')).toEqual({ symbol: '♥', className: 'trip-map-marker--candidate' });
  expect(mapMarkerAppearance('suggestion')).toEqual({ symbol: '◆', className: 'trip-map-marker--suggestion' });
  expect(mapMarkerAppearance('searchResult')).toEqual({ symbol: '●', className: 'trip-map-marker--search' });
});
it('resizes MapLibre after container, orientation and visual viewport changes and removes listeners on cleanup', () => {
  class Target {
    listeners = new Map<string, Set<EventListener>>();
    addEventListener(type:string, listener:EventListener) { const values=this.listeners.get(type)??new Set();values.add(listener);this.listeners.set(type,values); }
    removeEventListener(type:string, listener:EventListener) { this.listeners.get(type)?.delete(listener); }
    fire(type:string) { this.listeners.get(type)?.forEach((listener)=>listener(new Event(type))); }
  }
  const windowTarget=new Target(), viewportTarget=new Target(), resize=vi.fn(), frames:FrameRequestCallback[]=[];
  let observerCallback:ResizeObserverCallback=()=>undefined, disconnected=false;
  const cleanup=installMapResizeRecovery({resize,dragPan:{isEnabled:()=>true},touchZoomRotate:{isEnabled:()=>true}} as never,{getBoundingClientRect:()=>({toJSON:()=>({width:390,height:500})})} as never,{
    windowTarget,viewportTarget,
    createObserver:(callback)=>{observerCallback=callback;return{observe:vi.fn(),disconnect:()=>{disconnected=true;}};},
    requestFrame:(callback)=>{frames.push(callback);return frames.length;},cancelFrame:vi.fn(),
  });
  observerCallback([],{} as ResizeObserver); frames.shift()?.(0); expect(resize).toHaveBeenCalledTimes(1);
  windowTarget.fire('orientationchange'); frames.shift()?.(0); expect(resize).toHaveBeenCalledTimes(2);
  viewportTarget.fire('resize'); frames.shift()?.(0); expect(resize).toHaveBeenCalledTimes(3);
  cleanup(); expect(disconnected).toBe(true);
  windowTarget.fire('resize'); expect(frames).toHaveLength(0);
});
