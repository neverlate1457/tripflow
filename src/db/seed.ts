import { demoTrip } from '../data/demo-trip';
import { SqliteTripRepository } from '../services/sqlite-trip-repository';
import { seedDemoTrip } from './seed-demo';

if (process.env.NODE_ENV === 'production') throw new Error('Demo seeding is disabled in production.');
const repository = new SqliteTripRepository();
const result = await seedDemoTrip(repository);
console.log(`${result === 'seeded' ? 'Seeded' : 'Preserved existing'} ${demoTrip.name} (${demoTrip.id})`);
