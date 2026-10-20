import type { APIRoute } from "astro";
import { isValidMapCoordinate, resolveMapPlace, type MapPlaceHint } from "@/domain/map-planning";
import { GeoapifyPlaceProvider } from "@/services/geoapify-place-provider";

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json() as Partial<MapPlaceHint>;
    const name = typeof body.name === "string" ? body.name.trim().slice(0, 160) : "";
    const latitude = Number(body.latitude), longitude = Number(body.longitude);
    if (!name || !isValidMapCoordinate(latitude, longitude)) return Response.json({ error: "Invalid map place hint." }, { status: 400 });
    const key = import.meta.env.GEOAPIFY_API_KEY;
    if (!key) return Response.json({ error: "Place search is not configured." }, { status: 503 });
    const provider = new GeoapifyPlaceProvider(key);
    const results = await provider.search(name, { latitude, longitude, language: "en", signal: request.signal });
    const place = resolveMapPlace({ name, category: typeof body.category === "string" ? body.category.slice(0, 80) : undefined, latitude, longitude }, results);
    return Response.json(place ? { status: "resolved", place } : { status: "unverified" });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") return Response.json({ error: "Map lookup cancelled." }, { status: 408 });
    return Response.json({ error: "Map place verification is temporarily unavailable." }, { status: 502 });
  }
};
