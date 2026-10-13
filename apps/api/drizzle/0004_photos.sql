CREATE TABLE `album_items` (
	`album_id` text NOT NULL,
	`file_id` text NOT NULL,
	`added_at` integer NOT NULL,
	PRIMARY KEY(`album_id`, `file_id`),
	FOREIGN KEY (`album_id`) REFERENCES `albums`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`file_id`) REFERENCES `files`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `album_items_file_id_idx` ON `album_items` (`file_id`);--> statement-breakpoint
CREATE TABLE `albums` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`name` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `albums_owner_id_idx` ON `albums` (`owner_id`);--> statement-breakpoint
CREATE TABLE `media_info` (
	`version_id` text PRIMARY KEY NOT NULL,
	`taken_at` integer,
	`width` integer,
	`height` integer,
	`extracted_at` integer NOT NULL,
	`error` text,
	FOREIGN KEY (`version_id`) REFERENCES `file_versions`(`id`) ON UPDATE no action ON DELETE cascade
);
