CREATE TABLE `file_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`file_id` text NOT NULL,
	`owner_id` text NOT NULL,
	`size` integer NOT NULL,
	`sha256` text NOT NULL,
	`mime` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`file_id`) REFERENCES `files`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `file_versions_file_id_idx` ON `file_versions` (`file_id`);--> statement-breakpoint
CREATE INDEX `file_versions_owner_id_idx` ON `file_versions` (`owner_id`);--> statement-breakpoint
CREATE TABLE `files` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`parent_id` text,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`current_version_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`parent_id`) REFERENCES `files`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `files_one_root_per_owner` ON `files` (`owner_id`) WHERE "files"."parent_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX `files_active_name_per_parent` ON `files` (`parent_id`,`name`) WHERE "files"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX `files_owner_id_idx` ON `files` (`owner_id`);--> statement-breakpoint
CREATE INDEX `files_parent_id_idx` ON `files` (`parent_id`);--> statement-breakpoint
CREATE INDEX `files_deleted_at_idx` ON `files` (`deleted_at`);