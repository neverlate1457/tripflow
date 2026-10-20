import type { Candidate, DayContext, NormalizedPlace, Trip, TripItem } from "./models";
import { itemsForDate } from "./time";
import type { LineString } from "./routing";

export const discoveryCategories = [
  "attraction",
  "museum",
  "park",
  "beach",
  "viewpoint",
  "shopping",
  "restaurant",
  "cafe",
  "nightlife",
  "parking",
] as const;
export type PlaceDiscoveryCategory = (typeof discoveryCategories)[number];
export const discoveryThemes = [
  "seaside",
  "scenic",
  "local_food",
  "relaxing",
  "rainy_day",
  "shopping",
  "culture",
  "history",
] as const;
export type DiscoveryTheme = (typeof discoveryThemes)[number];
export interface DiscoverPlacesIntent {
  type: "discover_places";
  date: string;
  timeWindow?: { start?: string; end?: string };
  query?: string;
  categories?: PlaceDiscoveryCategory[];
  preferences?: {
    themes?: DiscoveryTheme[];
    indoorOutdoor?: "indoor" | "outdoor" | "either";
  };
  durationMinutes?: number;
  travelMode?: "driving" | "walking" | "cycling";
  geographicReference?: { text: string };
  corridorReference?: { originText: string; destinationText: string };
  maxDetourMinutes?: number;
  geographicScope?: "city_area" | "nearby_point" | "corridor" | "trip_context";
}
export type SuggestionReasonCode =
  | "MATCHES_SEASIDE_THEME"
  | "MATCHES_CATEGORY"
  | "NEAR_CURRENT_ROUTE"
  | "LOW_DETOUR"
  | "FITS_AVAILABLE_WINDOW"
  | "NEAR_NEXT_ACTIVITY"
  | "REACHABLE_BEFORE_FIXED_EVENT"
  | "ALREADY_IN_TRIP"
  | "INCOMPATIBLE_FIXED_EVENT"
  | "ROUTING_DATA_LIMITED";
export interface SuggestionReason {
  code: SuggestionReasonCode;
  value?: number;
}
export interface PlaceSuggestion {
  id: string;
  place: NormalizedPlace;
  score: number;
  reasons: SuggestionReason[];
  context: {
    distanceMeters?: number;
    detourMinutes?: number;
    detourStatus: "available" | "unavailable" | "not_applicable";
    distanceMeaning: "anchor_distance" | "area_relevance" | "corridor_distance";
    estimatedTravelMinutes?: number;
    availableWindowMinutes?: number;
    schedulingConfidence: "full" | "limited";
    previousItemId?: string;
    nextItemId?: string;
    nextFixed?: boolean;
    alreadyInTrip?: boolean;
    semanticEvidence: string[];
    semanticEligibility: "eligible" | "generic";
    scoreComponents: DiscoveryScoreComponents;
  };
}
export interface DiscoveryScoreComponents {
  providerOrder: number;
  semantic: number;
  distance: number;
  detour: number;
  routing: number;
  duplicate: number;
  fixedWindow: number;
  quality: number;
}
export interface DiscoveryDiagnostic {
  provider: string;
  providerPlaceId: string;
  name: string;
  title: string;
  distanceMeters: number;
  providerCategories: string[];
  semanticEvidence: string[];
  semanticEligibility: "eligible" | "generic" | "rejected";
  rejectionReason?: DiscoveryRejectionReason;
  categoryThemeScore: number;
  distanceScore: number;
  detourScore?: number;
  finalScore?: number;
  qualityScore: number;
  accepted: boolean;
}
export type DiscoveryRejectionReason =
  | "MISSING_SEASIDE_EVIDENCE"
  | "MISSING_CAFE_EVIDENCE"
  | "MISSING_RESTAURANT_EVIDENCE"
  | "MISSING_ATTRACTION_EVIDENCE"
  | "MISSING_MUSEUM_EVIDENCE"
  | "MISSING_SCENIC_EVIDENCE"
  | "MISSING_PARK_EVIDENCE"
  | "MISSING_PARKING_EVIDENCE"
  | "INFRASTRUCTURE_NOT_RELEVANT"
  | "DUPLICATE_PLACE";
export interface DiscoveryContext {
  anchor: { latitude: number; longitude: number };
  geometry: "point" | "corridor";
  scope: "city_area" | "nearby_point" | "corridor";
  areaProviderPlaceId?: string;
  routeGeometry?: LineString;
  anchorName?: string;
  sourceWasAlreadyGrounded?: boolean;
  sourceProvider?: string;
  sourceProviderPlaceId?: string;
  corridor?: {
    origin: { id: string; name: string; latitude: number; longitude: number };
    destination: { id: string; name: string; latitude: number; longitude: number };
  };
  anchorSource:
    | "neighbor_midpoint"
    | "previous_item"
    | "next_item"
    | "day_item"
    | "day_context_base"
    | "trip_destination"
    | "explicit_geographic_reference";
  previous?: TripItem;
  next?: TripItem;
  availableWindowMinutes?: number;
}
export interface DiscoveryRouteEstimate {
  fromId: string;
  toId: string;
  durationMinutes: number;
}
export const DISCOVERY_LIMITS = {
  providerResults: 20,
  suggestions: 10,
  routeLookups: 10,
  routeShortlist: 5,
  corridorWindows: 5,
  providerRequests: 10,
} as const;

/**
 * Route-dependent constraints belong to final ranking. Keeping them out of
 * preliminary ranking ensures unknown candidates survive long enough for the
 * application layer to prepare the route facts needed to evaluate them.
 */
export function discoveryPreparationIntent(
  intent: DiscoverPlacesIntent,
): DiscoverPlacesIntent {
  return intent.maxDetourMinutes == null
    ? intent
    : { ...intent, maxDetourMinutes: undefined };
}
export const DISCOVERY_WEIGHTS = {
  providerOrder: 6,
  distanceKm: 4,
  categoryMismatch: 40,
  themeMismatch: 30,
  detourMinute: 2,
  duplicate: 1000,
  limitedRouting: 8,
  namedQuality: -6,
  addressQuality: -3,
  specificCategoryQuality: -4,
} as const;

export interface DiscoverySearchStage {
  categories: PlaceDiscoveryCategory[];
  query?: string;
  reason: "requested" | "seaside" | "complementary" | "query_broadened" | "diversity";
}

/** Provider-grounded retrieval stages. Broadening only changes provider filters. */
export function buildDiscoverySearchStages(
  intent: DiscoverPlacesIntent,
): DiscoverySearchStage[] {
  const requested = intent.categories ?? [],
    seaside = intent.preferences?.themes?.includes("seaside") ?? false,
    stages: DiscoverySearchStage[] = [];
  if (seaside)
    stages.push({ categories: ["beach"], query: intent.query, reason: "seaside" });
  const complementary = requested.filter(
    (category) => category !== "beach" && category !== "viewpoint",
  );
  if (complementary.length)
    stages.push({
      categories: complementary,
      query: intent.query,
      reason: seaside ? "complementary" : "requested",
    });
  if (!stages.length)
    stages.push({ categories: requested, query: intent.query, reason: "requested" });
  const generalSightseeing = requested.includes("attraction") &&
    !intent.query &&
    !(intent.preferences?.themes?.some((theme) => ["history", "culture"].includes(theme)));
  if (generalSightseeing)
    for (const category of ["museum", "park", "viewpoint"] as const)
      stages.push({ categories: [category], reason: "diversity" });
  if (intent.query)
    for (const stage of [...stages])
      stages.push({ ...stage, query: undefined, reason: "query_broadened" });
  return stages.filter(
    (stage, index, all) =>
      all.findIndex(
        (other) =>
          other.query === stage.query &&
          other.categories.join("|") === stage.categories.join("|"),
      ) === index,
  );
}

const categoriesOf = (place: NormalizedPlace) => [
  ...new Set([
    ...(place.categories ?? []),
    ...(place.category ? [place.category] : []),
  ]),
];
const evidenceText = (place: NormalizedPlace) =>
  `${place.name} ${categoriesOf(place).join(" ")}`.toLowerCase();
export function semanticEvidence(place: NormalizedPlace) {
  const text = evidenceText(place),
    evidence: string[] = [];
  const rules: Array<[string, RegExp]> = [
    ["beach", /\bbeach\b/],
    ["coast", /\bcoast(?:al|line)?\b/],
    ["waterfront", /\bwaterfront\b/],
    ["seaside", /\bseaside\b/],
    ["sea", /\b(?:sea|ocean)\b/],
    ["pier", /\bpier\b/],
    ["harbor", /\bharbou?r\b/],
    ["marina", /\bmarina\b/],
    ["promenade", /\bpromenade\b/],
    ["coastal", /natural\.coastal|\bcoastal\b/],
    ["lighthouse", /(?:tourism\.sights|man_made)\.lighthouse|\blighthouse\b|灯台|燈塔/],
    ["viewpoint", /\b(?:viewpoint|view_point|tourism\.attraction\.viewpoint)\b/],
    ["cafe", /(?:^|[.\s])cafe(?:$|[.\s])/],
    ["restaurant", /(?:^|[.\s])restaurant(?:$|[.\s])|catering\.restaurant/],
    ["coffee", /coffee(?:_shop)?|coffee_and_tea/],
    ["bubble_tea", /bubble[_\s-]?tea/],
    ["tea_only", /cafe\.tea\b|tea[_\s-]?shop/],
    ["juice_drink", /juice|beverage|drink[_\s-]?shop/],
    ["fast_food", /fast[_\s-]?food/],
    ["tourism", /tourism\.(?:attraction|sights)|\battraction\b/],
    ["museum", /museum|gallery|arts_centre|cultural/],
    ["park", /leisure\.park|natural\.|garden|nature_reserve/],
    ["historic", /historic|heritage|monument|castle|temple|shrine/],
    ["memorial", /memorial|monument|記念碑|紀念碑|水害碑/],
    ["parking", /(?:^|[.\s])parking(?:$|[.\s])|parking\.cars/],
    ["infrastructure", /parking|toilet|public_transport|transport\.platform|administrative|power|telecom|waste|service\.vehicle|technical|rental.{0,8}(?:bike|bicycle|cycle)|rent.?a.?cycle|レンタサイクル/],
  ];
  for (const [code, pattern] of rules)
    if (pattern.test(text)) evidence.push(code);
  return evidence;
}
function semanticGate(place: NormalizedPlace, intent: DiscoverPlacesIntent) {
  const evidence = semanticEvidence(place),
    seaside = intent.preferences?.themes?.includes("seaside") ?? false,
    cafe = intent.categories?.includes("cafe") ?? false,
    categories = intent.categories ?? [],
    generic = categories.length === 0 && !(intent.preferences?.themes?.length),
    tourismEvidence = evidence.some((value) => ["tourism", "museum", "park", "historic", "viewpoint"].includes(value)),
    strongTourismEvidence = evidence.some((value) => ["museum", "park", "historic", "viewpoint"].includes(value)),
    infrastructure = evidence.includes("infrastructure"),
    reject = (reason: DiscoveryRejectionReason) => ({ eligible: false as const, evidence, reason });
  if (seaside) {
    const waterFacing = evidence.some((value) =>
      [
        "beach",
        "coast",
        "waterfront",
        "seaside",
        "sea",
        "pier",
        "harbor",
        "marina",
        "promenade",
        "coastal",
        "lighthouse",
      ].includes(value),
    );
    const hasComplementaryConcept =
      (intent.categories ?? []).some(
        (category) => category !== "beach" && category !== "viewpoint",
      ) ||
      (intent.preferences?.themes ?? []).some(
        (theme) => theme !== "seaside" && theme !== "scenic",
      );
    if (!waterFacing && !hasComplementaryConcept)
      return reject("MISSING_SEASIDE_EVIDENCE");
  }
  if (cafe) {
    const coffeeSpecific = evidence.includes("coffee"),
      cafeEvidence = evidence.includes("cafe"),
      negative = evidence.some((value) =>
        ["bubble_tea", "tea_only", "juice_drink", "fast_food"].includes(value),
      );
    if (!coffeeSpecific && (!cafeEvidence || negative))
      return reject("MISSING_CAFE_EVIDENCE");
  }
  if (categories.includes("restaurant") && !evidence.includes("restaurant"))
    return reject("MISSING_RESTAURANT_EVIDENCE");
  if (categories.includes("parking") && !evidence.includes("parking"))
    return reject("MISSING_PARKING_EVIDENCE");
  if (categories.includes("museum") && !evidence.includes("museum"))
    return reject("MISSING_MUSEUM_EVIDENCE");
  if (categories.includes("park") && !evidence.includes("park"))
    return reject("MISSING_PARK_EVIDENCE");
  if ((categories.includes("viewpoint") || intent.preferences?.themes?.includes("scenic")) &&
      (!evidence.some((value) => ["viewpoint", "park"].includes(value)) ||
        (evidence.includes("memorial") && !evidence.includes("viewpoint"))))
    return reject("MISSING_SCENIC_EVIDENCE");
  if ((categories.includes("attraction") || generic) && infrastructure && !strongTourismEvidence)
    return reject("INFRASTRUCTURE_NOT_RELEVANT");
  if (categories.includes("attraction") && !tourismEvidence)
    return reject("MISSING_ATTRACTION_EVIDENCE");
  return {
    eligible: true as const,
    evidence,
    generic: !seaside && !cafe && !categories.length,
  };
}

function qualityScore(place: NormalizedPlace) {
  let score = 0;
  if (typeof place.name === "string" && place.name.trim())
    score += DISCOVERY_WEIGHTS.namedQuality;
  if (place.address?.trim()) score += DISCOVERY_WEIGHTS.addressQuality;
  if (categoriesOf(place).some((value) => value.includes(".")))
    score += DISCOVERY_WEIGHTS.specificCategoryQuality;
  return score;
}

function discoverySubtype(place: NormalizedPlace) {
  const evidence = semanticEvidence(place);
  for (const subtype of ["museum", "park", "viewpoint", "beach", "historic", "memorial", "restaurant", "cafe", "tourism"])
    if (evidence.includes(subtype)) return subtype;
  const specific = [...categoriesOf(place)].sort((a, b) => b.split(".").length - a.split(".").length || a.localeCompare(b))[0];
  return specific ?? "other";
}

function generalSightseeingQuality(place: NormalizedPlace, intent: DiscoverPlacesIntent) {
  const general = intent.categories?.includes("attraction") && !intent.query &&
    !(intent.preferences?.themes?.some((theme) => ["history", "culture"].includes(theme)));
  if (!general) return 0;
  const evidence = semanticEvidence(place);
  return evidence.some((value) => ["museum", "park", "viewpoint", "beach"].includes(value)) ? -24 : 0;
}

/** Keeps the provider pool bounded without letting its first subtype consume every slot. */
export function selectDiverseDiscoveryPool(places: NormalizedPlace[], limit = DISCOVERY_LIMITS.providerResults) {
  const buckets = new Map<string, NormalizedPlace[]>();
  for (const place of places) {
    const key = discoverySubtype(place);
    const bucket = buckets.get(key) ?? [];
    bucket.push(place);
    buckets.set(key, bucket);
  }
  const selected: NormalizedPlace[] = [];
  while (selected.length < limit && [...buckets.values()].some((bucket) => bucket.length))
    for (const bucket of buckets.values()) {
      const place = bucket.shift();
      if (place) selected.push(place);
      if (selected.length === limit) break;
    }
  return selected;
}

function diversifyGeneralSightseeing(suggestions: PlaceSuggestion[], intent: DiscoverPlacesIntent) {
  const general = intent.categories?.includes("attraction") && !intent.query &&
    !(intent.preferences?.themes?.some((theme) => ["history", "culture"].includes(theme)));
  if (!general) return suggestions.slice(0, DISCOVERY_LIMITS.suggestions);
  const counts = new Map<string, number>();
  return suggestions.filter((suggestion) => {
    const key = discoverySubtype(suggestion.place), count = counts.get(key) ?? 0;
    if (count >= 2) return false;
    counts.set(key, count + 1);
    return true;
  }).slice(0, DISCOVERY_LIMITS.suggestions);
}

const normalizedName = (value: string) => value.normalize("NFKC").toLocaleLowerCase()
  .replace(/\bmt\.?\b/g, "mount").replace(/[^\p{L}\p{N}]+/gu, "");
const categoryFamilies = (place: NormalizedPlace) => new Set(categoriesOf(place).map((value) => value.split(".")[0]));
/** Exact provider identities merge first. Different identities merge only with strong spatial, name and category evidence. */
export function deduplicateDiscoveryPlaces(places: NormalizedPlace[]) {
  const exact = new Map<string, NormalizedPlace>();
  for (const place of places) exact.set(`${place.provider}:${place.providerPlaceId}`, place);
  const kept: NormalizedPlace[] = [], duplicates: Array<{ place: NormalizedPlace; reason: DiscoveryRejectionReason }> = [];
  for (const place of exact.values()) {
    const name = normalizedName(place.name), families = categoryFamilies(place);
    const duplicate = kept.find((other) => {
      if (distanceMeters(place.location, other.location) > 75) return false;
      const otherName = normalizedName(other.name);
      if (!name || name !== otherName) return false;
      const otherFamilies = categoryFamilies(other);
      return [...families].some((family) => otherFamilies.has(family));
    });
    if (duplicate) duplicates.push({ place, reason: "DUPLICATE_PLACE" });
    else kept.push(place);
  }
  return { places: kept, duplicates };
}

const coord = (x: TripItem) =>
  x.latitude != null && x.longitude != null
    ? { latitude: x.latitude, longitude: x.longitude }
    : null;
function clockMinutes(value?: string) {
  if (!value) return undefined;
  const match = value.match(/^(\d{1,2}):(\d{2})$/);
  return match ? Number(match[1]) * 60 + Number(match[2]) : undefined;
}
export function resolveDiscoveryGeographicContext(
  trip: Trip,
  items: TripItem[],
  intent: DiscoverPlacesIntent,
  explicitAnchor?: { latitude: number; longitude: number },
  explicitAnchorName?: string,
  corridor?: DiscoveryContext["corridor"],
  dayContexts: DayContext[] = [],
  explicitAreaProviderPlaceId?: string,
): DiscoveryContext | null {
  if (corridor) return {
    anchor: {
      latitude: (corridor.origin.latitude + corridor.destination.latitude) / 2,
      longitude: (corridor.origin.longitude + corridor.destination.longitude) / 2,
    },
    geometry: "corridor",
    scope: "corridor",
    corridor,
    anchorSource: "explicit_geographic_reference",
    sourceWasAlreadyGrounded: true,
    availableWindowMinutes: (clockMinutes(intent.timeWindow?.end) ?? 18 * 60) - (clockMinutes(intent.timeWindow?.start) ?? 12 * 60),
  };
  if (explicitAnchor) return { anchor: explicitAnchor, geometry: "point", scope: intent.geographicScope === "city_area" ? "city_area" : "nearby_point", areaProviderPlaceId: intent.geographicScope === "city_area" ? explicitAreaProviderPlaceId : undefined, anchorName: explicitAnchorName, anchorSource: "explicit_geographic_reference", sourceWasAlreadyGrounded: true, sourceProviderPlaceId: explicitAreaProviderPlaceId, availableWindowMinutes: (clockMinutes(intent.timeWindow?.end) ?? 18 * 60) - (clockMinutes(intent.timeWindow?.start) ?? 12 * 60) };
  const day = itemsForDate(items, intent.date, trip.timezone)
    .filter((x) => coord(x))
    .sort((a, b) => a.startAt.localeCompare(b.startAt));
  if (!day.length) {
    const base = dayContexts.find((value) => value.tripId === trip.id && value.date === intent.date)?.baseLocation;
    if (base) return {
      anchor: { latitude: base.latitude, longitude: base.longitude },
      anchorSource: "day_context_base",
      sourceWasAlreadyGrounded: true,
      sourceProvider: base.provider,
      sourceProviderPlaceId: base.providerPlaceId,
      geometry: "point",
      scope: "nearby_point",
      anchorName: base.name,
      availableWindowMinutes: (clockMinutes(intent.timeWindow?.end) ?? 18 * 60) - (clockMinutes(intent.timeWindow?.start) ?? 12 * 60),
    };
    if (!trip.destination || !Number.isFinite(trip.destination.latitude) || !Number.isFinite(trip.destination.longitude) || !trip.destination.providerPlaceId?.trim() || !trip.destination.provider?.trim()) return null;
    return {
      anchor: {
        latitude: trip.destination.latitude,
        longitude: trip.destination.longitude,
      },
      anchorSource: "trip_destination",
      geometry: "point",
      scope: intent.geographicScope === "nearby_point" ? "nearby_point" : "city_area",
      areaProviderPlaceId: intent.geographicScope === "nearby_point" ? undefined : trip.destination.providerPlaceId,
      anchorName: trip.destination.name,
      sourceWasAlreadyGrounded: true,
      sourceProvider: trip.destination.provider,
      sourceProviderPlaceId: trip.destination.providerPlaceId,
      availableWindowMinutes:
        (clockMinutes(intent.timeWindow?.end) ?? 18 * 60) -
        (clockMinutes(intent.timeWindow?.start) ?? 12 * 60),
    };
  }
  const start = clockMinutes(intent.timeWindow?.start) ?? 12 * 60,
    end = clockMinutes(intent.timeWindow?.end) ?? 18 * 60;
  const minute = (iso: string) => {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: trip.timezone,
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(new Date(iso));
    return (
      Number(parts.find((x) => x.type === "hour")?.value) * 60 +
      Number(parts.find((x) => x.type === "minute")?.value)
    );
  };
  const previous = [...day].reverse().find((x) => minute(x.endAt) <= start),
    next = day.find((x) => minute(x.startAt) >= end);
  let anchor, anchorSource: DiscoveryContext["anchorSource"];
  if (previous && next)
    (anchor = {
      latitude: (previous.latitude! + next.latitude!) / 2,
      longitude: (previous.longitude! + next.longitude!) / 2,
    }),
      (anchorSource = "neighbor_midpoint");
  else {
    anchor = coord(previous ?? next ?? day[0])!;
    anchorSource = previous
      ? "previous_item"
      : next
        ? "next_item"
        : "day_item";
  }
  return {
    anchor,
    geometry: "point",
    scope: "nearby_point",
    anchorSource,
    sourceWasAlreadyGrounded: true,
    sourceProvider: (previous ?? next ?? day[0]).provider ?? undefined,
    sourceProviderPlaceId: (previous ?? next ?? day[0]).placeId ?? undefined,
    previous,
    next,
    availableWindowMinutes:
      next && previous
        ? Math.max(
            0,
            Math.round(
              (new Date(next.startAt).getTime() -
                new Date(previous.endAt).getTime()) /
                60000,
            ),
          )
        : Math.max(0, end - start),
  };
}
export const prepareDiscoveryContext = resolveDiscoveryGeographicContext;
function distanceToCorridorMeters(place: NormalizedPlace, context: DiscoveryContext) {
  if (!context.corridor) return distanceMeters(context.anchor, place.location);
  if (context.routeGeometry?.coordinates.length) {
    let best = Number.POSITIVE_INFINITY;
    for (let index = 1; index < context.routeGeometry.coordinates.length; index++) {
      const [fromLongitude, fromLatitude] = context.routeGeometry.coordinates[index - 1], [toLongitude, toLatitude] = context.routeGeometry.coordinates[index], scale = Math.cos(((fromLatitude + toLatitude) / 2) * Math.PI / 180), x = (place.location.longitude - fromLongitude) * scale, y = place.location.latitude - fromLatitude, dx = (toLongitude - fromLongitude) * scale, dy = toLatitude - fromLatitude, t = Math.max(0, Math.min(1, (x * dx + y * dy) / (dx * dx + dy * dy || 1))), projected = { latitude: fromLatitude + t * (toLatitude - fromLatitude), longitude: fromLongitude + t * (toLongitude - fromLongitude) };
      best = Math.min(best, distanceMeters(place.location, projected));
    }
    return best;
  }
  const origin = context.corridor.origin,
    destination = context.corridor.destination,
    scale = Math.cos(((origin.latitude + destination.latitude) / 2) * Math.PI / 180),
    x = (place.location.longitude - origin.longitude) * scale,
    y = place.location.latitude - origin.latitude,
    dx = (destination.longitude - origin.longitude) * scale,
    dy = destination.latitude - origin.latitude,
    t = Math.max(0, Math.min(1, (x * dx + y * dy) / (dx * dx + dy * dy || 1))),
    projected = { latitude: origin.latitude + t * (destination.latitude - origin.latitude), longitude: origin.longitude + t * (destination.longitude - origin.longitude) };
  return distanceMeters(place.location, projected);
}

export function sampleCorridorSearchAnchors(geometry: LineString | undefined, maximum = DISCOVERY_LIMITS.corridorWindows) {
  const coordinates = geometry?.coordinates ?? [];
  if (coordinates.length < 2 || maximum < 1) return [];
  const segments = coordinates.slice(1).map((coordinate, index) => distanceMeters({ latitude: coordinates[index][1], longitude: coordinates[index][0] }, { latitude: coordinate[1], longitude: coordinate[0] })), total = segments.reduce((sum, value) => sum + value, 0);
  const count = Math.max(1, Math.min(maximum, Math.ceil(total / 40_000)));
  return Array.from({ length: count }, (_, sampleIndex) => {
    const target = total * ((sampleIndex + 0.5) / count);
    let traversed = 0;
    for (let index = 0; index < segments.length; index++) {
      if (traversed + segments[index] >= target) {
        const ratio = segments[index] ? (target - traversed) / segments[index] : 0, from = coordinates[index], to = coordinates[index + 1];
        return { id: `route-window:${sampleIndex + 1}/${count}`, latitude: from[1] + ratio * (to[1] - from[1]), longitude: from[0] + ratio * (to[0] - from[0]) };
      }
      traversed += segments[index];
    }
    const last = coordinates[coordinates.length - 1];
    return { id: `route-window:${sampleIndex + 1}/${count}`, latitude: last[1], longitude: last[0] };
  });
}
export function distanceMeters(
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number },
) {
  const r = 6371000,
    p = Math.PI / 180,
    dLat = (b.latitude - a.latitude) * p,
    dLon = (b.longitude - a.longitude) * p,
    x =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(a.latitude * p) *
        Math.cos(b.latitude * p) *
        Math.sin(dLon / 2) ** 2;
  return 2 * r * Math.asin(Math.sqrt(x));
}
const categoryMatch = (
  place: NormalizedPlace,
  categories: PlaceDiscoveryCategory[],
) =>
  categories.some((c) =>
    new RegExp(
      c === "attraction"
        ? "tourism|attraction|sight"
        : c === "beach"
          ? "beach|coast"
          : c === "restaurant"
            ? "restaurant|catering"
            : c,
      "i",
    ).test(categoriesOf(place).join(" ")),
  );
const themeMatch = (place: NormalizedPlace, themes: DiscoveryTheme[]) =>
  themes.some((t) =>
    new RegExp(
      t === "seaside"
        ? "beach|coast|sea|ocean"
        : t === "local_food"
          ? "restaurant|food|catering"
          : t === "rainy_day"
            ? "museum|shopping"
            : t === "history"
              ? "historic|heritage|archaeological"
              : t === "culture"
                ? "museum|cultural|arts"
            : t,
      "i",
    ).test(`${place.name} ${categoriesOf(place).join(" ")}`),
  );

function routeFacts(
  place: NormalizedPlace,
  context: DiscoveryContext,
  routes: DiscoveryRouteEstimate[],
) {
  if (context.geometry === "point")
    return { before: undefined, after: undefined, detour: undefined };
  const fromId = context.corridor?.origin.id ?? context.previous?.id,
    toId = context.corridor?.destination.id ?? context.next?.id,
    before =
      fromId &&
      routes.find(
        (x) =>
          x.fromId === fromId && x.toId === place.providerPlaceId,
      ),
    after =
      toId &&
      routes.find(
        (x) =>
          x.fromId === place.providerPlaceId && x.toId === toId,
      ),
    baseline =
      fromId && toId &&
      routes.find(
        (x) => x.fromId === fromId && x.toId === toId,
      ),
    detour =
      before && after && baseline
        ? Math.max(
            0,
            before.durationMinutes +
              after.durationMinutes -
              baseline.durationMinutes,
          )
        : undefined;
  return { before, after, detour };
}

export function discoveryDiagnostics(
  places: NormalizedPlace[],
  intent: DiscoverPlacesIntent,
  context: DiscoveryContext,
  routes: DiscoveryRouteEstimate[] = [],
): DiscoveryDiagnostic[] {
  return selectDiverseDiscoveryPool(places)
    .map((place, index) => {
      const gate = semanticGate(place, intent),
        distance = distanceToCorridorMeters(place, context),
        distanceScore = (distance / 1000) * DISCOVERY_WEIGHTS.distanceKm * (context.scope === "city_area" ? 0.05 : 1),
        semantic = gate.eligible ? -50 : 0,
        quality = qualityScore(place) + generalSightseeingQuality(place, intent),
        detour = routeFacts(place, context, routes).detour,
        detourScore =
          detour === undefined
            ? undefined
            : detour * DISCOVERY_WEIGHTS.detourMinute;
      return {
        provider: place.provider,
        providerPlaceId: place.providerPlaceId,
        name: place.name,
        title: place.name,
        distanceMeters: Math.round(distance),
        providerCategories: categoriesOf(place),
        semanticEvidence: gate.evidence,
        semanticEligibility: gate.eligible
          ? gate.generic
            ? "generic"
            : "eligible"
          : "rejected",
        rejectionReason: gate.eligible ? undefined : gate.reason,
        categoryThemeScore: semantic,
        distanceScore,
        detourScore,
        finalScore: gate.eligible
          ? index * DISCOVERY_WEIGHTS.providerOrder +
            semantic +
            quality +
            distanceScore +
            (detourScore ?? DISCOVERY_WEIGHTS.limitedRouting)
          : undefined,
        qualityScore: quality,
        accepted: gate.eligible,
      };
    });
}
export function rankPlaceSuggestions(
  places: NormalizedPlace[],
  intent: DiscoverPlacesIntent,
  context: DiscoveryContext,
  candidates: Candidate[],
  items: TripItem[],
  routes: DiscoveryRouteEstimate[] = [],
): PlaceSuggestion[] {
  const categories = intent.categories ?? [],
    themes = intent.preferences?.themes ?? [];
  const ranked = selectDiverseDiscoveryPool(places)
    .filter((place) => semanticGate(place, intent).eligible)
    .map<PlaceSuggestion>((place, index) => {
      const distance = distanceToCorridorMeters(place, context),
        gate = semanticGate(place, intent),
        duplicate =
          candidates.some(
            (x) =>
              x.provider === place.provider &&
              x.placeId === place.providerPlaceId,
          ) || items.some((x) => x.placeId === place.providerPlaceId);
      const reasons: SuggestionReason[] = [];
      const scoreComponents: DiscoveryScoreComponents = {
        providerOrder: index * DISCOVERY_WEIGHTS.providerOrder,
        semantic: "generic" in gate && gate.generic ? 0 : -50,
        distance: (distance / 1000) * DISCOVERY_WEIGHTS.distanceKm * (context.scope === "city_area" ? 0.05 : 1),
        detour: 0,
        routing: 0,
        duplicate: 0,
        fixedWindow: 0,
        quality: qualityScore(place) + generalSightseeingQuality(place, intent),
      };
      let score = Object.values(scoreComponents).reduce(
        (sum, value) => sum + value,
        0,
      );
      if (categories.length) {
        if (categoryMatch(place, categories))
          reasons.push({ code: "MATCHES_CATEGORY" });
        else {
          score += DISCOVERY_WEIGHTS.categoryMismatch;
          scoreComponents.semantic += DISCOVERY_WEIGHTS.categoryMismatch;
        }
      }
      if (themes.length) {
        if (themeMatch(place, themes)) {
          reasons.push({
            code: themes.includes("seaside")
              ? "MATCHES_SEASIDE_THEME"
              : "MATCHES_CATEGORY",
          });
        } else {
          score += DISCOVERY_WEIGHTS.themeMismatch;
          scoreComponents.semantic += DISCOVERY_WEIGHTS.themeMismatch;
        }
      }
      if (distance < 5000) reasons.push({ code: "NEAR_CURRENT_ROUTE" });
      if (
        context.availableWindowMinutes &&
        (intent.durationMinutes ?? 90) <= context.availableWindowMinutes
      )
        reasons.push({ code: "FITS_AVAILABLE_WINDOW" });
      if (context.next) reasons.push({ code: "NEAR_NEXT_ACTIVITY" });
      const { before, after, detour } = routeFacts(place, context, routes);
      if (detour !== undefined) {
        scoreComponents.detour = detour * DISCOVERY_WEIGHTS.detourMinute;
        score += scoreComponents.detour;
        if (detour <= 15) reasons.push({ code: "LOW_DETOUR", value: detour });
      } else {
        scoreComponents.routing = DISCOVERY_WEIGHTS.limitedRouting;
        score += scoreComponents.routing;
        reasons.push({ code: "ROUTING_DATA_LIMITED" });
      }
      if (intent.maxDetourMinutes != null && detour != null && detour > intent.maxDetourMinutes) {
        scoreComponents.detour += 50_000;
        score += 50_000;
      }
      if (
        context.next?.flexibility === "fixed" &&
        context.availableWindowMinutes != null &&
        before &&
        after
      ) {
        const required =
          (intent.durationMinutes ?? 90) +
          before.durationMinutes +
          after.durationMinutes;
        if (required > context.availableWindowMinutes) {
          scoreComponents.fixedWindow = 50_000;
          score += scoreComponents.fixedWindow;
          reasons.push({ code: "INCOMPATIBLE_FIXED_EVENT" });
        } else reasons.push({ code: "REACHABLE_BEFORE_FIXED_EVENT" });
      }
      if (duplicate) {
        scoreComponents.duplicate = DISCOVERY_WEIGHTS.duplicate;
        score += scoreComponents.duplicate;
        reasons.push({ code: "ALREADY_IN_TRIP" });
      }
      return {
        id: `${place.provider}:${place.providerPlaceId}`,
        place,
        score,
        reasons,
        context: {
          distanceMeters: Math.round(distance),
          detourMinutes: detour,
          detourStatus:
            context.geometry === "point"
              ? "not_applicable"
              : detour === undefined
                ? "unavailable"
                : "available",
          distanceMeaning:
            context.geometry === "point"
              ? context.scope === "city_area" ? "area_relevance" : "anchor_distance"
              : "corridor_distance",
          availableWindowMinutes: context.availableWindowMinutes,
          schedulingConfidence: detour === undefined ? "limited" : "full",
          previousItemId: context.previous?.id,
          nextItemId: context.next?.id,
          nextFixed: context.next?.flexibility === "fixed",
          alreadyInTrip: duplicate,
          semanticEvidence: gate.evidence,
          semanticEligibility:
            "generic" in gate && gate.generic ? "generic" : "eligible",
          scoreComponents,
        },
      };
    })
    .filter(
      (suggestion) =>
        intent.maxDetourMinutes == null ||
        (suggestion.context.detourMinutes != null &&
          suggestion.context.detourMinutes <= intent.maxDetourMinutes),
    )
    .sort((a, b) => a.score - b.score || a.id.localeCompare(b.id));
  return diversifyGeneralSightseeing(ranked, intent);
}
export function formatSuggestionReason(s: PlaceSuggestion) {
  if (s.context.alreadyInTrip) return "Already in trip";
  const distance = s.context.distanceMeters == null ? null : s.context.distanceMeters < 1000 ? `${s.context.distanceMeters} m` : `${(s.context.distanceMeters / 1000).toFixed(1)} km`;
  if (s.context.distanceMeaning === "anchor_distance")
    return distance ? `${distance} away` : "Distance unavailable";
  if (s.context.distanceMeaning === "area_relevance")
    return "In the requested area";
  const detour = s.context.detourStatus === "available" ? `+${s.context.detourMinutes} min detour` : "detour unavailable";
  return distance ? `${distance} from route · ${detour}` : detour;
}

export function formatDiscoveryCategory(place: NormalizedPlace) {
  const evidence = semanticEvidence(place);
  if (evidence.includes("viewpoint")) return "Viewpoint";
  if (evidence.includes("cafe") || evidence.includes("coffee")) return "Cafe";
  if (evidence.includes("museum")) return "Museum";
  if (categoriesOf(place).some((value) => /restaurant/.test(value))) return "Restaurant";
  if (evidence.includes("park")) return "Park";
  if (evidence.includes("tourism")) return "Attraction";
  if (evidence.includes("parking")) return "Parking";
  return place.category ?? "Place";
}

/** Keeps ephemeral discovery UI aligned after the canonical Candidate commit. */
export function markSuggestionAdded(
  suggestions: PlaceSuggestion[],
  suggestionId: string,
) {
  return suggestions.map((entry) =>
    entry.id === suggestionId
      ? {
          ...entry,
          context: { ...entry.context, alreadyInTrip: true },
          reasons: [
            ...entry.reasons.filter(
              (reason) => reason.code !== "ALREADY_IN_TRIP",
            ),
            { code: "ALREADY_IN_TRIP" as const },
          ],
        }
      : entry,
  );
}
