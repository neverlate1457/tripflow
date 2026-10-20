import { describe, expect, it } from 'vitest';
import { validateTripInput } from './trips';

describe('trip validation', () => {
  it('accepts a valid Japan trip', () => expect(validateTripInput({ name: 'Kyoto', startDate: '2026-11-01', endDate: '2026-11-04', timezone: 'Asia/Tokyo' }).valid).toBe(true));
  it('rejects blank names, reversed dates, and invalid timezones', () => {
    const result = validateTripInput({ name: ' ', startDate: '2026-11-04', endDate: '2026-11-01', timezone: 'Mars/Olympus' });
    expect(result.errors).toMatchObject({ name: expect.any(String), endDate: expect.any(String), timezone: expect.any(String) });
  });
});
