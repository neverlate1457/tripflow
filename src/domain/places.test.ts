import { describe, expect, it } from 'vitest';
import type { NormalizedPlace } from './models';
import { categoryToTripItemType, hasCandidateForPlace, placeToCandidate } from './places';

const place: NormalizedPlace = { provider: 'geoapify', providerPlaceId: 'p1', name: 'Soba House', location: { latitude: 26.2, longitude: 127.7 }, address: 'Naha', category: 'catering.restaurant' };
describe('place normalization into TripFlow', () => {
  it('maps provider categories to TripFlow types', () => { expect(categoryToTripItemType('catering.restaurant')).toBe('restaurant'); expect(categoryToTripItemType('accommodation.hotel')).toBe('hotel'); expect(categoryToTripItemType('tourism.attraction')).toBe('place'); });
  it('converts a normalized place into a minimal Candidate', () => expect(placeToCandidate(place, 'trip', 'candidate')).toMatchObject({ id: 'candidate', tripId: 'trip', type: 'restaurant', provider: 'geoapify', placeId: 'p1', title: 'Soba House' }));
  it('detects duplicate provider/place identities', () => expect(hasCandidateForPlace([placeToCandidate(place, 'trip', 'candidate')], place)).toBe(true));
});
