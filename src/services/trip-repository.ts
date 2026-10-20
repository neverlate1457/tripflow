import type { Candidate, DayContext, SegmentPreference, Trip, TripItem } from '@/domain/models';

export interface TripSnapshot { trip: Trip; items: TripItem[]; candidates: Candidate[]; segmentPreferences: SegmentPreference[]; dayContexts?: DayContext[] }

export interface TripRepository {
  listTrips(): Promise<Trip[]>;
  createTrip(trip: Trip): Promise<void>;
  updateTrip(trip: Trip): Promise<void>;
  deleteTrip(id: string): Promise<boolean>;
  getTrip(id: string): Promise<TripSnapshot | null>;
  saveTrip(snapshot: TripSnapshot): Promise<void>;
  listDayContexts(tripId: string): Promise<DayContext[]>;
  upsertDayContext(context: DayContext): Promise<void>;
  deleteDayContext(tripId: string, date: string): Promise<boolean>;
}
