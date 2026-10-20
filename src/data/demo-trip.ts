import type { Candidate, Trip, TripItem } from '@/domain/models';

/** Synthetic development/test data, not a booking or a real person's itinerary.
 * Public landmark names are retained for existing entity-resolution tests.
 * Coordinates and mock place IDs are illustrative, never provider evidence.
 */
const timestamp = '2026-01-01T00:00:00.000Z';
export const demoTrip: Trip = {
  id: 'okinawa-2026',
  name: 'Okinawa demo (synthetic)',
  startDate: '2026-10-24',
  endDate: '2026-10-27',
  timezone: 'Asia/Tokyo',
  destination: null,
  createdAt: timestamp,
  updatedAt: timestamp,
};

function item(id: string, type: TripItem['type'], title: string, day: number,
  start: string, end: string, details: Partial<TripItem> = {}): TripItem {
  return {
    id, tripId: demoTrip.id, type, title,
    description: 'Synthetic demo only',
    startAt: new Date(`2026-10-${day}T${start}:00+09:00`).toISOString(),
    endAt: new Date(`2026-10-${day}T${end}:00+09:00`).toISOString(),
    latitude: null, longitude: null, address: null, placeId: null,
    provider: null, notes: null, sortOrder: 0,
    createdAt: timestamp, updatedAt: timestamp,
    flexibility: 'flexible', schedulingConstraint: null, reservation: null,
    ...details,
  };
}

const location = (id: string) => ({
  latitude: 26.2, longitude: 127.7, provider: 'mock', placeId: `demo:${id}`,
});

export const demoItems: TripItem[] = [
  item('flight-1', 'flight', 'Demo flight', 24, '06:00', '07:00', {
    flexibility: 'fixed', flightDetails: { origin: 'Demo origin', destination: 'Demo destination' },
  }),
  item('hotel-1', 'hotel', 'Demo hotel', 24, '08:00', '09:00', location('hotel')),
  item('transport-1', 'transport', 'Demo transfer', 24, '09:00', '10:00', {
    transportDetails: { mode: 'bus', from: 'Demo airport', to: 'Demo hotel' },
  }),
  item('note-1', 'note', 'Demo reminder', 24, '15:00', '15:30'),
  // Legacy coordinate-only activity: cannot be unscheduled into a grounded Candidate.
  item('place-1', 'place', 'Shuri Castle', 25, '09:00', '12:00', {
    latitude: 26.2, longitude: 127.7,
  }),
  item('restaurant-1', 'restaurant', 'Demo lunch', 25, '11:30', '12:30', location('lunch')),
  item('place-2', 'place', 'Demo garden', 25, '12:45', '14:00', location('garden')),
  item('place-3', 'place', 'Demo fixed activity', 26, '15:00', '16:00', {
    ...location('fixed'), flexibility: 'fixed',
  }),
];

export const demoCandidates: Candidate[] = [{
  id: 'candidate-1', tripId: demoTrip.id, type: 'place', title: 'Cape Manzamo',
  ...location('manzamo'), address: null, estimatedDuration: 90, notes: null,
}];
