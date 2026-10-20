# Map and place provider decision

## Selected implementation

- **Map renderer:** MapLibre GL JS
- **Basemap:** OpenFreeMap Liberty vector tiles
- **Place search:** Geoapify, called only from the Astro server

MapLibre keeps map behavior behind `TripMap` and has web plus native renderers,
which limits lock-in before a future mobile client. OpenFreeMap provides global
OpenStreetMap-based vector tiles without a browser key. Geoapify provides
worldwide geocoding, proximity bias, place categories, optional details, a free
3,000-credit/day tier, and future routing APIs. Its server key is never sent to
the browser.

## Alternatives evaluated

### Google Maps and Places

Google generally provides the strongest POI search in Japan and Taiwan and has
excellent future routing coverage. It requires billing and browser/server key
configuration. Its Places content storage and display policies also create a
tighter coupling for TripFlow's persisted Candidate workflow. Current pricing
uses per-SKU free usage caps followed by pay-as-you-go billing.

### Mapbox

Mapbox offers an excellent browser SDK, maps, search, and routing in one vendor.
However, its Search Box documentation currently lists supported geographies as
the United States, Canada, and Europe, making it a poor primary POI search fit
for this Japan/Taiwan-focused product. Search results are also documented as
temporary unless a permanent-data product is arranged.

### MapLibre plus open location services

This provides the cleanest provider boundary and the lowest map-rendering
lock-in. The public Nominatim service was rejected for typeahead because its
usage policy prohibits client-side autocomplete. Geoapify supplies a supported
commercial API boundary while retaining MapLibre/OpenFreeMap for rendering.

## Configuration

Create `.env` from `.env.example` and set:

```sh
GEOAPIFY_API_KEY=your_server_key
```

Restrict the key to the Geocoding, Place Details, and Routing APIs and to deployment
origins/IPs in the Geoapify dashboard. Search returns a clear configuration
error when the key is absent; the map continues working.

References:

- https://maplibre.org/maplibre-gl-js/docs/
- https://openfreemap.org/quick_start/
- https://apidocs.geoapify.com/docs/geocoding/forward-geocoding/
- https://www.geoapify.com/pricing/
- https://developers.google.com/maps/billing-and-pricing/pricing
- https://developers.google.com/maps/documentation/javascript/policies
- https://docs.mapbox.com/api/search/search-box/
- https://www.mapbox.com/pricing

## Phase 3 routing

Geoapify is also used behind the provider-independent `RoutingProvider`. Its
Routing API returns GeoJSON and supports the initial drive, walk, and bicycle
modes. Transit remains in the domain vocabulary but is deliberately disabled;
TripFlow never silently substitutes another mode.

Routing requests remain server-side and share `GEOAPIFY_API_KEY`. Normalized
results are cached for 30 days in SQLite. Only duration, distance, endpoints,
mode, timestamps, provider, and a GeoJSON LineString are stored—not raw provider
payloads. Since an ordinary route leg normally costs one credit, routing occurs
only after committed edits and identical route requests reuse the cache.

Routing references:

- https://apidocs.geoapify.com/docs/routing/
- https://www.geoapify.com/routing-api/
- https://www.geoapify.com/pricing/

## Phase 6.5 discovery

Natural-language discovery uses the same `PlaceProvider`; there is no AI-specific
place source. Application categories map inside the Geoapify adapter to bounded
Places API categories, with a server-derived proximity circle and a 20-result
limit. Raw Geoapify payloads never reach AI or Zustand. Every displayed discovery
result is a `NormalizedPlace` retaining provider ID and attribution.

Discovery first ranks provider relevance, category/theme fit, proximity, and
duplicates. The route-aware model supports cached detour estimates for a
shortlist, capped at ten lookups. When those estimates are unavailable the UI
reports limited confidence and does not claim a detour or fixed-event reachability.

## Interactive map place resolution

OpenFreeMap vector-tile properties are never persisted as place data. TripFlow
inspects point features only after a click and sends a bounded label/category/
location hint to its server. Geoapify results must pass deterministic name and
proximity matching. Layer IDs are deliberately not hard-coded: point geometry
and bounded public label properties are used so style changes fail closed.

`Search around here` uses a three-kilometer circle and ten-result limit.
Map-triggered hypothetical routes may reference a Geoapify place ID; the server
resolves it before consulting the existing normalized route cache. Credentials
and raw provider payloads never reach MapLibre or Zustand.
