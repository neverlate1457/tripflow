import { demoCandidates, demoItems, demoTrip } from '../data/demo-trip';
import type { TripRepository } from '../services/trip-repository';

/** Initialize an empty development database; never reset an existing trip. */
export async function seedDemoTrip(repository: Pick<TripRepository, 'listTrips' | 'saveTrip'>) {
  const existing = await repository.listTrips();
  if (existing.some((trip) => trip.id === demoTrip.id)) return 'preserved';
  if (existing.length) throw new Error('Refusing to seed a database containing existing trips. Use a fresh development database.');
  await repository.saveTrip({ trip: demoTrip, items: demoItems, candidates: demoCandidates, segmentPreferences: [] });
  return 'seeded';
}
