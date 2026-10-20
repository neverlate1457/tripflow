import type { NormalizedPlace } from "@/domain/models";
import type { MapPlaceHint } from "@/domain/map-planning";

export class HttpMapPlaceClient {
  private resolutionCache = new Map<string, NormalizedPlace | null>();
  private nearbyCache = new Map<string, NormalizedPlace[]>();
  async resolve(hint: MapPlaceHint, signal?: AbortSignal): Promise<NormalizedPlace | null> {
    const key = `${hint.name.trim().toLocaleLowerCase()}|${hint.latitude.toFixed(4)}|${hint.longitude.toFixed(4)}`;
    if (this.resolutionCache.has(key)) return this.resolutionCache.get(key)!;
    const response = await fetch("/api/places/resolve-map", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(hint), signal });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error ?? "Map lookup failed");
    const place = body.status === "resolved" ? body.place as NormalizedPlace : null;
    this.resolutionCache.set(key, place);
    return place;
  }
  async nearby(latitude: number, longitude: number, radiusMeters = 3000, signal?: AbortSignal): Promise<NormalizedPlace[]> {
    const key = `${latitude.toFixed(4)}|${longitude.toFixed(4)}|${radiusMeters}`;
    if (this.nearbyCache.has(key)) return this.nearbyCache.get(key)!;
    const response = await fetch(`/api/places/nearby?lat=${encodeURIComponent(latitude)}&lng=${encodeURIComponent(longitude)}&radius=${encodeURIComponent(radiusMeters)}`, { signal });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error ?? "Nearby search failed");
    const results = body.results as NormalizedPlace[];
    this.nearbyCache.set(key, results);
    return results;
  }
}
