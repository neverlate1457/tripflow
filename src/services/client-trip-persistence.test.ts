import { describe, expect, it } from 'vitest';
import { demoCandidates, demoItems, demoTrip } from '@/data/demo-trip';
import { HttpTripPersistence, MalformedTripResponseError, parseTripSnapshot } from './client-trip-persistence';

describe('trip API client validation', () => {
  it('accepts a complete snapshot', () => expect(parseTripSnapshot({ trip: demoTrip, items: demoItems, candidates: demoCandidates }).trip.id).toBe(demoTrip.id));
  it('keeps old snapshots backward compatible with zero DayContexts', () => expect(parseTripSnapshot({ trip: demoTrip, items: demoItems, candidates: demoCandidates }).dayContexts).toEqual([]));
  it('restores confirmed manual location metadata and rejects invalid coordinates', () => {
    const item = { ...demoItems[0], latitude: 25.0478, longitude: 121.517, address: 'Taipei Main Station', provider: 'geoapify', placeId: 'taipei-main', locationSource: 'manual' as const, originalLocationInput: '台北車站' };
    expect(parseTripSnapshot({ trip: demoTrip, items: [item], candidates: [] }).items[0]).toMatchObject({ locationSource: 'manual', originalLocationInput: '台北車站', latitude: 25.0478 });
    expect(() => parseTripSnapshot({ trip: demoTrip, items: [{ ...item, latitude: 999 }], candidates: [] })).toThrow(MalformedTripResponseError);
  });
  it('normalizes legacy Transport behavior to standalone and rejects raw physical-place payloads', () => {
    const legacy = { ...demoItems.find((item) => item.type === 'transport')!, transportDetails: { mode: 'train' as const, from: 'A', to: 'B' } };
    expect(parseTripSnapshot({ trip: demoTrip, items: [legacy], candidates: [] }).items[0].transportDetails?.behavior).toBe('standalone');
    const malformed = { ...legacy, transportDetails: { ...legacy.transportDetails, behavior: 'replace_segment', boundFromEndpoint: { kind: 'trip_item', tripItemId: 'a' }, boundToEndpoint: { kind: 'trip_item', tripItemId: 'b' }, boardingPlace: { name: 'Station', formattedAddress: null, latitude: 25, longitude: 121, provider: 'geoapify', providerPlaceId: 'station', timezone: null, raw: {} } } };
    expect(() => parseTripSnapshot({ trip: demoTrip, items: [malformed], candidates: [] })).toThrow(MalformedTripResponseError);
  });
  it('rejects malformed or raw-provider DayContext data', () => expect(() => parseTripSnapshot({ trip: demoTrip, items: demoItems, candidates: demoCandidates, dayContexts: [{ tripId: demoTrip.id, date: demoTrip.startDate, startLocation: { name: 'Oita', formattedAddress: null, latitude: 33, longitude: 131, provider: 'geoapify', providerPlaceId: 'oita', timezone: null, raw: {} }, baseLocation: null, endLocation: null, createdAt: 'now', updatedAt: 'now' }] })).toThrow(MalformedTripResponseError));
  it('rejects malformed API data', () => expect(() => parseTripSnapshot({ trip: demoTrip, items: [{ id: 'bad' }], candidates: [] })).toThrow(MalformedTripResponseError));
  it('handles a malformed JSON response', async () => {
    const client = new HttpTripPersistence(async () => new Response('not json', { status: 200 }));
    await expect(client.loadTrip('trip')).rejects.toBeInstanceOf(MalformedTripResponseError);
  });
  it('loads a trip by dynamic id', async () => {
    let requested = ''; const client = new HttpTripPersistence(async (input) => { requested = String(input); return Response.json({ trip: demoTrip, items: demoItems, candidates: demoCandidates }); });
    await client.loadTrip('dynamic-trip'); expect(requested).toContain('/api/trips/dynamic-trip');
  });
  it('keeps legacy text Flights and validates grounded Flight snapshots', () => {
    const legacy = demoItems.find((item) => item.type === 'flight')!;
    expect(parseTripSnapshot({ trip: demoTrip, items: [legacy], candidates: [] }).items[0].flightDetails?.originAirport).toBeUndefined();
    const grounded = { ...legacy, startAt: '2026-10-24T01:00:00.000Z', endAt: '2026-10-24T03:20:00.000Z', flightDetails: { origin: 'TPE', destination: 'FUK', originAirport: { name: 'TPE', formattedAddress: null, latitude: 25.08, longitude: 121.23, provider: 'geoapify', providerPlaceId: 'tpe', timezone: 'Asia/Taipei' }, destinationAirport: { name: 'FUK', formattedAddress: null, latitude: 33.58, longitude: 130.45, provider: 'geoapify', providerPlaceId: 'fuk', timezone: 'Asia/Tokyo' } } };
    const loaded = parseTripSnapshot({ trip: demoTrip, items: [grounded], candidates: [] }).items[0];
    expect(loaded.flightDetails?.destinationAirport?.timezone).toBe('Asia/Tokyo');
  });
  it('rejects Flight chronology, malformed timestamps/details, and raw airport payloads', () => {
    const flight = demoItems.find((item) => item.type === 'flight')!;
    for (const malformed of [
      { ...flight, flightDetails: null },
      { ...flight, startAt: 'not-an-instant' },
      { ...flight, endAt: flight.startAt },
      { ...flight, flightDetails: { ...flight.flightDetails, unknown: true } },
      { ...flight, flightDetails: { origin: 'TPE', destination: 'FUK', originAirport: { name: 'TPE', formattedAddress: null, latitude: 25, longitude: 121, provider: 'geoapify', providerPlaceId: 'tpe', timezone: 'Asia/Taipei', raw: {} }, destinationAirport: { name: 'FUK', formattedAddress: null, latitude: 33, longitude: 130, provider: 'geoapify', providerPlaceId: 'fuk', timezone: 'Asia/Tokyo' } } },
    ]) expect(() => parseTripSnapshot({ trip: demoTrip, items: [malformed], candidates: [] })).toThrow(MalformedTripResponseError);
  });
});
