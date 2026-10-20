import type { APIRoute } from 'astro';
import { GeoapifyPlaceProvider } from '@/services/geoapify-place-provider';

export const GET: APIRoute = async ({ url, request }) => {
  const query = url.searchParams.get('q')?.trim();
  if (!query) return Response.json({ results: [] });
  const key = import.meta.env.GEOAPIFY_API_KEY;
  if (!key) return Response.json({ error: 'Place search is not configured. Add GEOAPIFY_API_KEY to the server environment.' }, { status: 503 });
  try {
    const provider = new GeoapifyPlaceProvider(key);
    const latitude = Number(url.searchParams.get('lat')); const longitude = Number(url.searchParams.get('lng'));
    const results = await provider.search(query, { latitude: Number.isFinite(latitude) ? latitude : undefined, longitude: Number.isFinite(longitude) ? longitude : undefined, language: 'en', signal: request.signal });
    return Response.json({ results });
  } catch { return Response.json({ error: 'Place search is temporarily unavailable.' }, { status: 502 }); }
};
