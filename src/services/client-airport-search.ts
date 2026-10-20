import type { NormalizedPlace } from "@/domain/models";

export interface AirportSearchClient { search(query: string, options?: { signal?: AbortSignal }): Promise<NormalizedPlace[]>; }
export class HttpAirportSearchClient implements AirportSearchClient {
  async search(query: string, options: { signal?: AbortSignal } = {}) {
    const response = await fetch(`/api/airports/search?q=${encodeURIComponent(query.trim())}`, { signal: options.signal });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error ?? "Airport search failed");
    return body.results as NormalizedPlace[];
  }
}
