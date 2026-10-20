import type { APIRoute } from 'astro';
import { deriveSegmentSpecs, travelModes, type RouteRequest, type TravelMode } from '@/domain/routing';
import { SqliteTripRepository } from '@/services/sqlite-trip-repository';
import { routeWithCache } from '@/services/cached-routing';

const repository = new SqliteTripRepository();
const supported = new Set<TravelMode>(['driving', 'walking', 'cycling']);
export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json() as Record<string, unknown>;
    if (typeof body.tripId !== 'string' || typeof body.segmentId !== 'string' || typeof body.mode !== 'string' || !travelModes.includes(body.mode as TravelMode)) return Response.json({ error: 'Invalid routing request' }, { status: 400 });
    const mode = body.mode as TravelMode; if (!supported.has(mode)) return Response.json({ error: 'Travel mode is not supported by the configured provider' }, { status: 422 });
    const snapshot = await repository.getTrip(body.tripId); if (!snapshot) return Response.json({ error: 'Trip not found' }, { status: 404 });
    const spec = deriveSegmentSpecs(snapshot.items, snapshot.trip.timezone, snapshot.dayContexts ?? []).find((entry) => entry.id === body.segmentId);
    if (!spec) return Response.json({ error: 'Segment is not an eligible chronological route edge' }, { status: 400 });
    const routeRequest: RouteRequest = { origin: spec.origin, destination: spec.destination, mode, departureAt: spec.departureAt };
    return Response.json(await routeWithCache(routeRequest,import.meta.env.GEOAPIFY_API_KEY));
  } catch(error) { if(error instanceof Error&&error.message==='ROUTING_NOT_CONFIGURED')return Response.json({ error: 'Routing is not configured. Add GEOAPIFY_API_KEY to the server environment.' }, { status: 503 });return Response.json({ error: 'Unable to calculate route' }, { status: 502 }); }
};
