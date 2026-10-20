CREATE TABLE `route_cache` (
	`key` text PRIMARY KEY NOT NULL,
	`provider` text NOT NULL,
	`mode` text NOT NULL,
	`origin_latitude` real NOT NULL,
	`origin_longitude` real NOT NULL,
	`destination_latitude` real NOT NULL,
	`destination_longitude` real NOT NULL,
	`duration_seconds` integer NOT NULL,
	`distance_meters` integer NOT NULL,
	`geometry` text,
	`calculated_at` text NOT NULL,
	`expires_at` text NOT NULL
);
