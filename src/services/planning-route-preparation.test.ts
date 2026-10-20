import { describe,expect,it,vi } from 'vitest';
import { prepareCandidateRoutes } from './planning-route-preparation';
import type { PlanningSnapshot } from '@/domain/planning';
import type { Candidate,TripItem } from '@/domain/models';
import type { RoutingClient } from './client-routing';
const base={tripId:'t',type:'place' as const,description:null,latitude:1,longitude:1,address:null,placeId:null,notes:null,sortOrder:0,createdAt:'',updatedAt:'',flexibility:'flexible' as const,schedulingConstraint:null,reservation:null};
const item=(id:string,hour:string):TripItem=>({...base,id,title:id,startAt:`2026-01-01T${hour}:00:00Z`,endAt:`2026-01-01T${hour}:30:00Z`});
const candidate:Candidate={id:'c',tripId:'t',type:'place',title:'c',latitude:2,longitude:2,address:null,placeId:null,provider:null,estimatedDuration:60,notes:null};
const snapshot:PlanningSnapshot={tripId:'t',date:'2026-01-01',items:[item('a','09'),item('b','12')],segments:[],candidates:[candidate]};
describe('planning route preparation',()=>{
 it('deduplicates requests and preserves cache metadata',async()=>{const estimate=vi.fn(async()=>({provider:'mock',origin:{latitude:1,longitude:1},destination:{latitude:2,longitude:2},mode:'driving' as const,durationSeconds:60,distanceMeters:10,cache:'hit' as const}));const routing:RoutingClient={route:vi.fn(),estimate};const result=await prepareCandidateRoutes(snapshot,'c','driving',routing);expect(result.status).toBe('ready');if(result.status==='ready'){expect(result.cacheHits).toBe(result.lookups);expect(new Set(result.estimates.map(x=>`${x.fromId}>${x.toId}`)).size).toBe(result.estimates.length)}});
 it('supports cancellation and provider failure without canonical mutation',async()=>{const before=structuredClone(snapshot),controller=new AbortController();controller.abort();const routing:RoutingClient={route:vi.fn(),estimate:vi.fn()};await expect(prepareCandidateRoutes(snapshot,'c','driving',routing,controller.signal)).rejects.toMatchObject({name:'AbortError'});expect(snapshot).toEqual(before);const failing:RoutingClient={route:vi.fn(),estimate:async()=>{throw new Error('offline')}};await expect(prepareCandidateRoutes(snapshot,'c','driving',failing)).rejects.toThrow('offline');expect(snapshot).toEqual(before)});
});
