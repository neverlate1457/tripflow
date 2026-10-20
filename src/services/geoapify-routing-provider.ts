import type { LineString, NormalizedRoute, RouteRequest, RoutingProvider, TravelMode } from '@/domain/routing';

const modeMap: Record<TravelMode, string | null> = { driving: 'drive', walking: 'walk', cycling: 'bicycle', transit: null };
export class GeoapifyRoutingProvider implements RoutingProvider {
  capabilities = { driving: true, walking: true, cycling: true, transit: false } as const;
  constructor(private readonly apiKey: string, private readonly fetcher: typeof fetch = fetch) {}
  async route(request: RouteRequest): Promise<NormalizedRoute> {
    const providerMode = modeMap[request.mode]; if (!providerMode) throw new Error('Unsupported travel mode');
    const params = new URLSearchParams({ waypoints: `${request.origin.latitude},${request.origin.longitude}|${request.destination.latitude},${request.destination.longitude}`, mode: providerMode, format: 'geojson', apiKey: this.apiKey });
    const response = await this.fetcher(`https://api.geoapify.com/v1/routing?${params}`); if (!response.ok) throw new Error('Routing provider unavailable');
    const body = await response.json() as { features?: Array<{ geometry?: { type?: string; coordinates?: unknown }; properties?: { time?: number; distance?: number } }> };
    const feature = body.features?.[0], coordinates = feature?.geometry?.coordinates;
    if (!feature || !feature.properties || !Array.isArray(coordinates) || typeof feature.properties.time !== 'number' || typeof feature.properties.distance !== 'number') throw new Error('Malformed routing response');
    const flattened = feature.geometry?.type === 'MultiLineString' ? (coordinates as [number, number][][]).flatMap((line, index) => index ? line.slice(1) : line) : coordinates as [number, number][];
    const geometry: LineString = { type: 'LineString', coordinates: flattened };
    return { provider: 'geoapify', ...request, durationSeconds: Math.round(feature.properties.time), distanceMeters: Math.round(feature.properties.distance), geometry };
  }
}
