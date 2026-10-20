import type { APIRoute } from "astro";
import { isValidMapCoordinate } from "@/domain/map-planning";
import { GeoapifyPlaceProvider } from "@/services/geoapify-place-provider";
import { filterPlacesWithinRadius } from "@/domain/manual-location";

export const GET: APIRoute = async ({ url, request }) => {
  const latitude = Number(url.searchParams.get("lat")), longitude = Number(url.searchParams.get("lng"));
  if (!isValidMapCoordinate(latitude, longitude)) return Response.json({ error: "Invalid map location." }, { status: 400 });
  const radiusMeters = Number(url.searchParams.get("radius") ?? 3000);
  if (!Number.isInteger(radiusMeters) || radiusMeters < 100 || radiusMeters > 20_000) return Response.json({ error: "Invalid nearby radius." }, { status: 400 });
  const key = import.meta.env.GEOAPIFY_API_KEY;
  if (!key) return Response.json({ error: "Place search is not configured." }, { status: 503 });
  try {
    const provider = new GeoapifyPlaceProvider(key);
    const providerResults = await provider.discover!({ categories: [], latitude, longitude, radiusMeters, limit: 10, language: "en", signal: request.signal });
    const withinRadius = filterPlacesWithinRadius(providerResults, { latitude, longitude }, radiusMeters);
    return Response.json({ results: withinRadius.map(({ place }) => place), ...(import.meta.env.DEV ? { diagnostics: { center: { latitude, longitude }, radiusMeters, providerResultCount: providerResults.length, acceptedDistancesMeters: withinRadius.map(({ place, distanceMeters }) => ({ providerPlaceId: place.providerPlaceId, distanceMeters: Math.round(distanceMeters) })) } } : {}) });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") return Response.json({ error: "Nearby search cancelled." }, { status: 408 });
    return Response.json({ error: "Nearby search is temporarily unavailable." }, { status: 502 });
  }
};
