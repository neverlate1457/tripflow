import type { NormalizedPlace } from '@/domain/models';
import type { PlaceSearchContext } from './place-provider';

export interface PlaceSearchClient { search(query: string, context?: PlaceSearchContext): Promise<NormalizedPlace[]> }
export class HttpPlaceSearchClient implements PlaceSearchClient {
  async search(query: string, context: PlaceSearchContext = {}) {
    const params = new URLSearchParams({ q: query });
    if (context.latitude != null) params.set('lat', String(context.latitude));
    if (context.longitude != null) params.set('lng', String(context.longitude));
    const response = await fetch(`/api/places/search?${params}`, { signal: context.signal });
    const body = await response.json(); if (!response.ok) throw new Error(body.error ?? 'Search failed');
    return body.results as NormalizedPlace[];
  }
}
