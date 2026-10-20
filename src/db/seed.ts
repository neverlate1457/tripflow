import { demoCandidates, demoItems, demoTrip } from '../data/demo-trip';
import { SqliteTripRepository } from '../services/sqlite-trip-repository';

const repository = new SqliteTripRepository();
await repository.saveTrip({ trip: demoTrip, items: demoItems, candidates: demoCandidates, segmentPreferences: [] });
console.log(`Seeded ${demoTrip.name} (${demoTrip.id})`);
