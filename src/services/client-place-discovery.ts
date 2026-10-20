import type { DiscoverPlacesIntent } from "@/domain/discovery";
import type { PlaceDiscoveryResult } from "@/domain/geographic-clarification";
export type { DiscoveryMapContext } from "@/domain/geographic-clarification";
export class HttpPlaceDiscoveryClient {
  constructor(private readonly fetcher: typeof fetch = globalThis.fetch.bind(globalThis)) {}

  async discover(
    tripId: string,
    intent: DiscoverPlacesIntent,
    signal?: AbortSignal,
    requestId?: string | null,
    originalRequest?: string,
  ): Promise<PlaceDiscoveryResult> {
    const response = await this.fetcher("/api/places/discover", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tripId, intent, ...(requestId ? { requestId } : {}), ...(originalRequest ? { originalRequest } : {}) }),
      signal,
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error ?? "Discovery failed");
    return body;
  }

  async resume(
    clarificationToken: string,
    selectedCandidateId: string,
    signal?: AbortSignal,
  ): Promise<PlaceDiscoveryResult> {
    const response = await this.fetcher("/api/places/discover", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ clarificationToken, selectedCandidateId }),
      signal,
    });
    const body = await response.json();
    if (!response.ok) {
      const error = new Error(body.error ?? "Discovery clarification failed") as Error & { code?: string };
      error.code = body.code;
      throw error;
    }
    return body;
  }
}
