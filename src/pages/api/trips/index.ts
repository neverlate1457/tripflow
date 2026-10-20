import type { APIRoute } from 'astro';
import { SqliteTripRepository } from '@/services/sqlite-trip-repository';
import { createTrip, validateTripInput, type TripInput } from '@/domain/trips';

const repository = new SqliteTripRepository();
export const GET: APIRoute = async () => {
  try { return Response.json(await repository.listTrips()); }
  catch { return Response.json({ error: 'Unable to load trips' }, { status: 500 }); }
};
export const POST: APIRoute = async ({ request }) => {
  try {
    const input = await request.json() as TripInput; const validation = validateTripInput(input);
    if (!validation.valid) return Response.json({ error: 'Invalid trip', fields: validation.errors }, { status: 400 });
    const trip = createTrip(input); await repository.createTrip(trip); return Response.json(trip, { status: 201 });
  } catch { return Response.json({ error: 'Unable to create trip' }, { status: 500 }); }
};
