import type { APIRoute } from "astro";
import { GeoapifyPlaceProvider } from "@/services/geoapify-place-provider";

export const GET: APIRoute = async ({ url, request }) => {
  const query = url.searchParams.get("q")?.trim() ?? "";
  if (query.length < 2) return Response.json({ results: [] });
  const key = import.meta.env.GEOAPIFY_API_KEY;
  if (!key)
    return Response.json(
      { error: "Destination search is not configured." },
      { status: 503 },
    );
  try {
    const provider = new GeoapifyPlaceProvider(key);
    let results = await provider.searchDestination(
      query,
      request.signal,
    );
    if (!results.length && /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(query) && !query.endsWith("市"))
      results = await provider.searchDestination(`${query}市`, request.signal);
    return Response.json({ results });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError")
      return Response.json({ error: "Destination search cancelled." }, { status: 408 });
    return Response.json(
      { error: "Destination search is temporarily unavailable." },
      { status: 502 },
    );
  }
};
