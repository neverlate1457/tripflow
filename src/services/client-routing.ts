import type { NormalizedRoute, RouteRequest, SegmentSpec } from "@/domain/routing";
export type RouteEndpointRef = { type: "tripItem" | "candidate"; id: string } | { type: "providerPlace"; id: string; provider: "geoapify" };
export interface RoutingClient {
  route(
    tripId: string,
    segment: SegmentSpec,
    request: RouteRequest,
  ): Promise<NormalizedRoute>;
  estimate?(
    tripId: string,
    from: RouteEndpointRef,
    to: RouteEndpointRef,
    mode: RouteRequest["mode"],
    signal?: AbortSignal,
  ): Promise<NormalizedRoute>;
}
export class HttpRoutingClient implements RoutingClient {
  constructor(
    private readonly fetcher: typeof fetch = globalThis.fetch.bind(globalThis),
  ) {}
  async route(
    tripId: string,
    segment: SegmentSpec,
    request: RouteRequest,
  ) {
    const endpoint =
      typeof window === "undefined"
        ? "/api/routes"
        : new URL("/api/routes", window.location.origin).toString();
    const response = await this.fetcher(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        tripId,
        segmentId: segment.id,
        mode: request.mode,
      }),
    });
    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as {
        error?: string;
      };
      throw new Error(body.error ?? "Route calculation failed");
    }
    return response.json() as Promise<NormalizedRoute>;
  }
  async estimate(
    tripId: string,
    from: RouteEndpointRef,
    to: RouteEndpointRef,
    mode: RouteRequest["mode"],
    signal?: AbortSignal,
  ) {
    const response = await this.fetcher("/api/routes/estimate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tripId, from, to, mode }),
      signal,
    });
    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as {
        error?: string;
      };
      throw new Error(body.error ?? "Route estimate failed");
    }
    return response.json() as Promise<NormalizedRoute>;
  }
}
