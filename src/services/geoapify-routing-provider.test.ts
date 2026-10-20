import { describe, expect, it, vi } from 'vitest';
import { GeoapifyRoutingProvider } from './geoapify-routing-provider';
describe('GeoapifyRoutingProvider', () => {
  it('normalizes a MultiLineString route and joins legs', async () => { const fetcher=vi.fn(async()=>new Response(JSON.stringify({features:[{geometry:{type:'MultiLineString',coordinates:[[[127,26],[127.1,26.1]],[[127.1,26.1],[127.2,26.2]]]},properties:{time:601.4,distance:4321.2}}]}),{status:200})); const provider=new GeoapifyRoutingProvider('key',fetcher as typeof fetch); const route=await provider.route({origin:{latitude:26,longitude:127},destination:{latitude:26.2,longitude:127.2},mode:'driving'}); expect(route).toMatchObject({provider:'geoapify',durationSeconds:601,distanceMeters:4321,geometry:{type:'LineString'}}); expect(route.geometry?.coordinates).toHaveLength(3); });
  it('rejects unsupported transit without calling provider', async () => { const fetcher=vi.fn(); await expect(new GeoapifyRoutingProvider('key',fetcher as typeof fetch).route({origin:{latitude:1,longitude:2},destination:{latitude:3,longitude:4},mode:'transit'})).rejects.toThrow('Unsupported'); expect(fetcher).not.toHaveBeenCalled(); });
});
