CREATE TABLE `candidates` (
	`id` text PRIMARY KEY NOT NULL,
	`trip_id` text NOT NULL,
	`type` text NOT NULL,
	`title` text NOT NULL,
	`latitude` real,
	`longitude` real,
	`address` text,
	`place_id` text,
	`estimated_duration` integer NOT NULL,
	`notes` text,
	FOREIGN KEY (`trip_id`) REFERENCES `trips`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `trip_items` (
	`id` text PRIMARY KEY NOT NULL,
	`trip_id` text NOT NULL,
	`type` text NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`start_at` text NOT NULL,
	`end_at` text NOT NULL,
	`latitude` real,
	`longitude` real,
	`address` text,
	`place_id` text,
	`notes` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`trip_id`) REFERENCES `trips`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `trips` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`start_date` text NOT NULL,
	`end_date` text NOT NULL,
	`timezone` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
