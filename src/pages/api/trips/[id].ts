import type { APIRoute } from 'astro';
import { SqliteTripRepository } from '@/services/sqlite-trip-repository';
import { MalformedTripResponseError, parseTripSnapshot } from '@/services/client-trip-persistence';
import { validateTripInput } from '@/domain/trips';

const repository = new SqliteTripRepository();

export async function loadTripResponse(id: string, source: Pick<SqliteTripRepository, 'getTrip'> = repository) {
  try {
    const snapshot = await source.getTrip(id);
    return snapshot ? Response.json(snapshot) : Response.json({ error: 'Trip not found' }, { status: 404 });
  } catch (error) {
    if (import.meta.env.DEV) console.error('Trip load failed', { tripId: id, error });
    return Response.json({ error: 'Unable to load trip' }, { status: 500 });
  }
}

export const GET: APIRoute = async ({ params }) => loadTripResponse(params.id ?? '');

export const PUT: APIRoute = async ({ params, request }) => {
  try {
    const snapshot = parseTripSnapshot(await request.json());
    if (!params.id || snapshot.trip.id !== params.id) return Response.json({ error: 'Trip id mismatch' }, { status: 400 });
    await repository.saveTrip(snapshot);
    return new Response(null, { status: 204 });
  } catch (error) {
    if (error instanceof SyntaxError || error instanceof MalformedTripResponseError) return Response.json({ error: 'Invalid trip data' }, { status: 400 });
    return Response.json({ error: 'Unable to save trip' }, { status: 500 });
  }
};

export const PATCH: APIRoute = async ({ params, request }) => {
  try {
    const snapshot = await repository.getTrip(params.id ?? '');
    if (!snapshot) return Response.json({ error: 'Trip not found' }, { status: 404 });
    const update = await request.json();
    const trip = { ...snapshot.trip, ...update, id: snapshot.trip.id, updatedAt: new Date().toISOString() };
    const validation = validateTripInput(trip);
    if (!validation.valid) return Response.json({ error: 'Invalid trip', fields: validation.errors }, { status: 400 });
    await repository.updateTrip(trip); return Response.json(trip);
  } catch { return Response.json({ error: 'Unable to update trip' }, { status: 500 }); }
};

export const DELETE: APIRoute = async ({ params }) => {
  try { return await repository.deleteTrip(params.id ?? '') ? new Response(null, { status: 204 }) : Response.json({ error: 'Trip not found' }, { status: 404 }); }
  catch { return Response.json({ error: 'Unable to delete trip' }, { status: 500 }); }
};
