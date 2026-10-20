import { lt } from 'drizzle-orm';
import { getDb, type TripDatabase } from '@/db/client';
import { routeCache } from '@/db/schema';
export function cleanupExpiredRouteCache(database: TripDatabase = getDb(), now = new Date()) { return database.delete(routeCache).where(lt(routeCache.expiresAt, now.toISOString())).run().changes; }
