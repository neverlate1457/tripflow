import { describe, expect, it, vi } from 'vitest';
import { demoTrip } from '../data/demo-trip';
import { seedDemoTrip } from './seed-demo';

describe('safe demo initialization', () => {
  it('seeds only an empty database', async () => {
    const saveTrip = vi.fn().mockResolvedValue(undefined);
    expect(await seedDemoTrip({ listTrips: async () => [], saveTrip })).toBe('seeded');
    expect(saveTrip).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ trip: demoTrip }));
  });

  it('preserves an existing trip even when it shares the demo ID', async () => {
    const saveTrip = vi.fn();
    const existing = { ...demoTrip, name: 'User-edited trip' };
    expect(await seedDemoTrip({ listTrips: async () => [existing], saveTrip })).toBe('preserved');
    expect(saveTrip).not.toHaveBeenCalled();
    expect(existing.name).toBe('User-edited trip');
  });

  it('refuses to seed a database containing other trips', async () => {
    const saveTrip = vi.fn();
    await expect(seedDemoTrip({ listTrips: async () => [{ ...demoTrip, id: 'other-trip' }], saveTrip }))
      .rejects.toThrow('Refusing to seed');
    expect(saveTrip).not.toHaveBeenCalled();
  });
});
