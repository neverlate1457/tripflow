import { and, eq, gt, lt, or } from 'drizzle-orm';
import { getDb, type TripDatabase } from '@/db/client';
import { candidates, segmentPreferences, tripDayContexts, tripItems, trips } from '@/db/schema';
import type { TripRepository, TripSnapshot } from './trip-repository';
import type { DayContext, GroundedPlaceRef } from '@/domain/models';
import { isEmptyDayContext } from '@/domain/day-context';

type DayContextRow = typeof tripDayContexts.$inferSelect;
const placeFromRow = (row: DayContextRow, prefix: 'start'|'base'|'end'): GroundedPlaceRef | null => {
  const name = row[`${prefix}Name`], latitude = row[`${prefix}Latitude`], longitude = row[`${prefix}Longitude`], provider = row[`${prefix}Provider`], providerPlaceId = row[`${prefix}ProviderPlaceId`];
  return name != null && latitude != null && longitude != null && provider != null && providerPlaceId != null ? { name, formattedAddress: row[`${prefix}FormattedAddress`], latitude, longitude, provider, providerPlaceId, timezone: row[`${prefix}Timezone`] } : null;
};
const contextFromRow = (row: DayContextRow): DayContext => ({ tripId: row.tripId, date: row.date, startLocation: placeFromRow(row, 'start'), baseLocation: placeFromRow(row, 'base'), endLocation: placeFromRow(row, 'end'), createdAt: row.createdAt, updatedAt: row.updatedAt });
const locationValues = (prefix: 'start'|'base'|'end', place: GroundedPlaceRef | null) => ({
  [`${prefix}Name`]: place?.name ?? null, [`${prefix}FormattedAddress`]: place?.formattedAddress ?? null, [`${prefix}Latitude`]: place?.latitude ?? null, [`${prefix}Longitude`]: place?.longitude ?? null, [`${prefix}Provider`]: place?.provider ?? null, [`${prefix}ProviderPlaceId`]: place?.providerPlaceId ?? null, [`${prefix}Timezone`]: place?.timezone ?? null,
});
const rowFromContext = (context: DayContext) => ({ tripId: context.tripId, date: context.date, ...locationValues('start', context.startLocation), ...locationValues('base', context.baseLocation), ...locationValues('end', context.endLocation), createdAt: context.createdAt, updatedAt: context.updatedAt });

export class SqliteTripRepository implements TripRepository {
  constructor(private readonly injectedDatabase?: TripDatabase) {}
  private get database() { return this.injectedDatabase ?? getDb(); }
  async listTrips() { return this.database.select().from(trips).orderBy(trips.startDate).all(); }
  async createTrip(trip: TripSnapshot['trip']) { this.database.insert(trips).values(trip).run(); }
  async updateTrip(trip: TripSnapshot['trip']) { this.database.transaction((tx) => { tx.update(trips).set(trip).where(eq(trips.id, trip.id)).run(); tx.delete(tripDayContexts).where(and(eq(tripDayContexts.tripId, trip.id), or(lt(tripDayContexts.date, trip.startDate), gt(tripDayContexts.date, trip.endDate)))).run(); }); }
  async deleteTrip(id: string) { return this.database.delete(trips).where(eq(trips.id, id)).run().changes > 0; }
  async getTrip(id: string): Promise<TripSnapshot | null> {
    const trip = await this.database.query.trips.findFirst({ where: eq(trips.id, id) });
    if (!trip) return null;
    const [items, candidateRows, preferences, contextRows] = await Promise.all([
      this.database.select().from(tripItems).where(eq(tripItems.tripId, id)),
      this.database.select().from(candidates).where(eq(candidates.tripId, id)),
      this.database.select().from(segmentPreferences).where(eq(segmentPreferences.tripId, id)),
      this.database.select().from(tripDayContexts).where(eq(tripDayContexts.tripId, id)).orderBy(tripDayContexts.date),
    ]);
    return { trip, items, candidates: candidateRows, segmentPreferences: preferences, dayContexts: contextRows.map(contextFromRow) };
  }

  async saveTrip(snapshot: TripSnapshot): Promise<void> {
    this.database.transaction((tx) => {
      tx.insert(trips).values(snapshot.trip).onConflictDoUpdate({ target: trips.id, set: snapshot.trip }).run();
      tx.delete(tripItems).where(eq(tripItems.tripId, snapshot.trip.id)).run();
      tx.delete(candidates).where(eq(candidates.tripId, snapshot.trip.id)).run();
      tx.delete(segmentPreferences).where(eq(segmentPreferences.tripId, snapshot.trip.id)).run();
      tx.delete(tripDayContexts).where(eq(tripDayContexts.tripId, snapshot.trip.id)).run();
      if (snapshot.items.length) tx.insert(tripItems).values(snapshot.items).run();
      if (snapshot.candidates.length) tx.insert(candidates).values(snapshot.candidates).run();
      if (snapshot.segmentPreferences.length) tx.insert(segmentPreferences).values(snapshot.segmentPreferences).run();
      if (snapshot.dayContexts?.length) tx.insert(tripDayContexts).values(snapshot.dayContexts.map(rowFromContext)).run();
    });
  }
  async listDayContexts(tripId: string) { return this.database.select().from(tripDayContexts).where(eq(tripDayContexts.tripId, tripId)).orderBy(tripDayContexts.date).all().map(contextFromRow); }
  async upsertDayContext(context: DayContext) {
    if (isEmptyDayContext(context)) { await this.deleteDayContext(context.tripId, context.date); return; }
    const row = rowFromContext(context);
    this.database.insert(tripDayContexts).values(row).onConflictDoUpdate({ target: [tripDayContexts.tripId, tripDayContexts.date], set: { ...row, createdAt: undefined } }).run();
  }
  async deleteDayContext(tripId: string, date: string) { return this.database.delete(tripDayContexts).where(and(eq(tripDayContexts.tripId, tripId), eq(tripDayContexts.date, date))).run().changes > 0; }
}
