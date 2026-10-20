import type { APIRoute } from "astro";
import { AirportSearchProvider } from "@/services/airport-search-provider";
import { GeoapifyPlaceProvider } from "@/services/geoapify-place-provider";

export const GET: APIRoute = async ({ url, request }) => {
  const query = url.searchParams.get("q")?.trim();
  if (!query) return Response.json({ results: [] });
  if (query.length > 160) return Response.json({ error: "Airport query is too long." }, { status: 400 });
  const key = import.meta.env.GEOAPIFY_API_KEY;
  if (!key) return Response.json({ error: "Airport search is not configured." }, { status: 503 });
  try {
    const results = await new AirportSearchProvider({ places: new GeoapifyPlaceProvider(key) }).search(query, request.signal);
    return Response.json({ results: results.slice(0, 8) });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") return Response.json({ error: "Airport search cancelled." }, { status: 408 });
    if (import.meta.env.DEV) console.error("Airport search failed", error);
    return Response.json({ error: "Airport search is temporarily unavailable." }, { status: 502 });
  }
};
