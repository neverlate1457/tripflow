import { and, eq, gt } from 'drizzle-orm';
import { db } from '@/db/client';
import { routeCache } from '@/db/schema';
import { routeCacheKey, type LineString, type NormalizedRoute, type RouteRequest } from '@/domain/routing';
import { GeoapifyRoutingProvider } from './geoapify-routing-provider';
import { cleanupExpiredRouteCache } from './route-cache';

export interface CachedRoute extends NormalizedRoute { cache: 'hit'|'miss' }
export async function routeWithCache(request:RouteRequest,apiKey:string|undefined,database:typeof db=db,providerName='geoapify'):Promise<CachedRoute>{
 const key=routeCacheKey(providerName,request),now=new Date();cleanupExpiredRouteCache(database,now);
 const cached=database.select().from(routeCache).where(and(eq(routeCache.key,key),gt(routeCache.expiresAt,now.toISOString()))).get();
 if(cached)return{provider:cached.provider,origin:request.origin,destination:request.destination,mode:request.mode,durationSeconds:cached.durationSeconds,distanceMeters:cached.distanceMeters,geometry:cached.geometry?JSON.parse(cached.geometry) as LineString:undefined,cache:'hit'};
 if(!apiKey)throw new Error('ROUTING_NOT_CONFIGURED');
 const route=await new GeoapifyRoutingProvider(apiKey).route(request),expiresAt=new Date(now.getTime()+30*24*60*60*1000);
 database.insert(routeCache).values({key,provider:route.provider,mode:request.mode,originLatitude:request.origin.latitude,originLongitude:request.origin.longitude,destinationLatitude:request.destination.latitude,destinationLongitude:request.destination.longitude,durationSeconds:route.durationSeconds,distanceMeters:route.distanceMeters,geometry:route.geometry?JSON.stringify(route.geometry):null,calculatedAt:now.toISOString(),expiresAt:expiresAt.toISOString()}).onConflictDoUpdate({target:routeCache.key,set:{durationSeconds:route.durationSeconds,distanceMeters:route.distanceMeters,geometry:route.geometry?JSON.stringify(route.geometry):null,calculatedAt:now.toISOString(),expiresAt:expiresAt.toISOString()}}).run();
 return{...route,cache:'miss'};
}
