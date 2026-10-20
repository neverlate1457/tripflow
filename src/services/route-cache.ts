import { lt } from 'drizzle-orm';
import { db } from '@/db/client';
import { routeCache } from '@/db/schema';
export function cleanupExpiredRouteCache(database: typeof db = db, now = new Date()) { return database.delete(routeCache).where(lt(routeCache.expiresAt, now.toISOString())).run().changes; }
