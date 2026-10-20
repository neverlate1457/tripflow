CREATE TABLE `segment_preferences` (
	`trip_id` text NOT NULL,
	`from_trip_item_id` text NOT NULL,
	`to_trip_item_id` text NOT NULL,
	`travel_mode` text NOT NULL,
	FOREIGN KEY (`trip_id`) REFERENCES `trips`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `segment_preferences_relationship_unique` ON `segment_preferences` (`trip_id`,`from_trip_item_id`,`to_trip_item_id`);--> statement-breakpoint
ALTER TABLE `trip_items` ADD `flexibility` text DEFAULT 'flexible' NOT NULL;--> statement-breakpoint
ALTER TABLE `trip_items` ADD `scheduling_constraint` text;--> statement-breakpoint
ALTER TABLE `trip_items` ADD `reservation` text;