import type { NormalizedPlace, TripDestination } from '@/domain/models';

export interface PlaceSearchContext { latitude?: number; longitude?: number; language?: string; signal?: AbortSignal }
export interface PlaceDiscoverySearch {query?:string;categories:string[];latitude:number;longitude:number;radiusMeters?:number;providerAreaPlaceId?:string;limit?:number;language?:string;signal?:AbortSignal}
export interface PlaceDiscoveryResponse { places: NormalizedPlace[]; rawCount: number; normalizedCount: number; }
export interface GeographicCandidate extends TripDestination { resultType?:string; categories:string[]; city?:string; region?:string; country?:string; confidence?:number; providerRank?:number; }
export interface PlaceProvider {
  search(query: string, context?: PlaceSearchContext): Promise<NormalizedPlace[]>;
  discover?(request:PlaceDiscoverySearch):Promise<NormalizedPlace[]>;
  discoverWithDiagnostics?(request:PlaceDiscoverySearch):Promise<PlaceDiscoveryResponse>;
  getDetails(id: string, signal?: AbortSignal): Promise<NormalizedPlace>;
}
export interface GeocodingProvider {
  searchDestination(query: string, signal?: AbortSignal): Promise<TripDestination[]>;
  searchGeographicCandidates?(query:string,signal?:AbortSignal):Promise<GeographicCandidate[]>;
}
