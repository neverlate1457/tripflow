import {
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const trips = sqliteTable("trips", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  startDate: text("start_date").notNull(),
  endDate: text("end_date").notNull(),
  timezone: text("timezone").notNull(),
  destination: text("destination", { mode: "json" }).$type<
    import("@/domain/models").TripDestination | null
  >(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const tripDayContexts = sqliteTable("trip_day_contexts", {
  tripId: text("trip_id").notNull().references(() => trips.id, { onDelete: "cascade" }),
  date: text("date").notNull(),
  startName: text("start_name"), startFormattedAddress: text("start_formatted_address"), startLatitude: real("start_latitude"), startLongitude: real("start_longitude"), startProvider: text("start_provider"), startProviderPlaceId: text("start_provider_place_id"), startTimezone: text("start_timezone"),
  baseName: text("base_name"), baseFormattedAddress: text("base_formatted_address"), baseLatitude: real("base_latitude"), baseLongitude: real("base_longitude"), baseProvider: text("base_provider"), baseProviderPlaceId: text("base_provider_place_id"), baseTimezone: text("base_timezone"),
  endName: text("end_name"), endFormattedAddress: text("end_formatted_address"), endLatitude: real("end_latitude"), endLongitude: real("end_longitude"), endProvider: text("end_provider"), endProviderPlaceId: text("end_provider_place_id"), endTimezone: text("end_timezone"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [uniqueIndex("trip_day_contexts_trip_date_unique").on(table.tripId, table.date)]);

export const tripItems = sqliteTable("trip_items", {
  id: text("id").primaryKey(),
  tripId: text("trip_id")
    .notNull()
    .references(() => trips.id, { onDelete: "cascade" }),
  type: text("type", {
    enum: ["place", "restaurant", "hotel", "transport", "flight", "note"],
  }).notNull(),
  title: text("title").notNull(),
  description: text("description"),
  startAt: text("start_at").notNull(),
  endAt: text("end_at").notNull(),
  latitude: real("latitude"),
  longitude: real("longitude"),
  address: text("address"),
  placeId: text("place_id"),
  provider: text("provider"),
  locationSource: text("location_source", { enum: ["manual"] }),
  originalLocationInput: text("original_location_input"),
  sourceCandidateId: text("source_candidate_id"),
  transportDetails: text("transport_details", { mode: "json" }).$type<
    import("@/domain/models").ExplicitTransportDetails | null
  >(),
  flightDetails: text("flight_details", { mode: "json" }).$type<
    import("@/domain/models").FlightDetails | null
  >(),
  notes: text("notes"),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  flexibility: text("flexibility", { enum: ["fixed", "flexible"] })
    .notNull()
    .default("flexible"),
  schedulingConstraint: text("scheduling_constraint", { mode: "json" }).$type<
    import("@/domain/models").SchedulingConstraint | null
  >(),
  reservation: text("reservation", { mode: "json" }).$type<
    import("@/domain/models").Reservation | null
  >(),
});

export const candidates = sqliteTable(
  "candidates",
  {
    id: text("id").primaryKey(),
    tripId: text("trip_id")
      .notNull()
      .references(() => trips.id, { onDelete: "cascade" }),
    type: text("type", {
      enum: ["place", "restaurant", "hotel", "transport", "flight", "note"],
    }).notNull(),
    title: text("title").notNull(),
    latitude: real("latitude"),
    longitude: real("longitude"),
    address: text("address"),
    placeId: text("place_id"),
    provider: text("provider"),
    estimatedDuration: integer("estimated_duration").notNull(),
    notes: text("notes"),
  },
  (table) => [
    uniqueIndex("candidates_trip_provider_place_unique").on(
      table.tripId,
      table.provider,
      table.placeId,
    ),
  ],
);

export const routeCache = sqliteTable("route_cache", {
  key: text("key").primaryKey(),
  provider: text("provider").notNull(),
  mode: text("mode").notNull(),
  originLatitude: real("origin_latitude").notNull(),
  originLongitude: real("origin_longitude").notNull(),
  destinationLatitude: real("destination_latitude").notNull(),
  destinationLongitude: real("destination_longitude").notNull(),
  durationSeconds: integer("duration_seconds").notNull(),
  distanceMeters: integer("distance_meters").notNull(),
  geometry: text("geometry"),
  calculatedAt: text("calculated_at").notNull(),
  expiresAt: text("expires_at").notNull(),
});

export const segmentPreferences = sqliteTable(
  "segment_preferences",
  {
    tripId: text("trip_id")
      .notNull()
      .references(() => trips.id, { onDelete: "cascade" }),
    // Physical names remain compatible with existing databases; values are now
    // explicit endpoint keys, not assumed TripItem IDs.
    fromEndpointKey: text("from_trip_item_id").notNull(),
    toEndpointKey: text("to_trip_item_id").notNull(),
    travelMode: text("travel_mode", {
      enum: ["driving", "walking", "cycling", "transit"],
    }).notNull(),
    durationOverrideMinutes: integer("duration_override_minutes"),
  },
  (table) => [
    uniqueIndex("segment_preferences_relationship_unique").on(
      table.tripId,
      table.fromEndpointKey,
      table.toEndpointKey,
    ),
  ],
);
