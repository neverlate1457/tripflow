import {
  rankPlaceSuggestions,
  discoveryDiagnostics,
  type DiscoverPlacesIntent,
  type DiscoveryContext,
} from "../src/domain/discovery";
import { GeoapifyPlaceProvider } from "../src/services/geoapify-place-provider";

const key = process.env.GEOAPIFY_API_KEY;
if (!key) throw new Error("GEOAPIFY_API_KEY is required");
const provider = new GeoapifyPlaceProvider(key);
const cities = [
  ["Jiaoxi/Yilan", 24.827, 121.78],
  ["Fukuoka", 33.5902, 130.4017],
  ["Okinawa", 26.2124, 127.6809],
  ["Taipei", 25.033, 121.565],
] as const;
for (const [city, latitude, longitude] of cities) {
  for (const kind of city === "Taipei" ? ["cafe"] : ["seaside", "cafe"]) {
    const intent: DiscoverPlacesIntent =
      kind === "seaside"
        ? {
            type: "discover_places",
            date: "2026-11-14",
            categories: ["beach", "viewpoint"],
            preferences: { themes: ["seaside", "scenic"] },
          }
        : { type: "discover_places", date: "2026-11-14", categories: ["cafe"] };
    const places = await provider.discover!({
        categories: kind === "seaside" ? ["beach"] : (intent.categories ?? []),
        latitude,
        longitude,
        limit: 20,
        language: "en",
      }),
      context: DiscoveryContext = {
        geometry: "point",
        scope: "nearby_point",
        anchor: { latitude, longitude },
        anchorSource: "day_item",
        availableWindowMinutes: 360,
      },
      suggestions = rankPlaceSuggestions(places, intent, context, [], []),
      diagnostics = discoveryDiagnostics(places, intent, context);
    console.log(
      JSON.stringify({
        city,
        kind,
        providerResults: places.length,
        accepted: suggestions.length,
        rejected: diagnostics.filter(
          (value) => value.semanticEligibility === "rejected",
        ).length,
        top: suggestions
          .slice(0, 5)
          .map((value) => ({
            name: value.place.name,
            evidence: value.context.semanticEvidence,
            categories: value.place.categories,
            distanceMeters: value.context.distanceMeters,
            confidence: value.context.schedulingConfidence,
          })),
      }),
    );
  }
}
