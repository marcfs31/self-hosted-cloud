CREATE TABLE `shares` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`file_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`kind` text NOT NULL,
	`allow_upload` integer DEFAULT false NOT NULL,
	`password_hash` text,
	`expires_at` integer,
	`created_at` integer NOT NULL,
	`revoked_at` integer,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`file_id`) REFERENCES `files`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `shares_token_hash_unique` ON `shares` (`token_hash`);--> statement-breakpoint
CREATE INDEX `shares_owner_id_idx` ON `shares` (`owner_id`);--> statement-breakpoint
CREATE INDEX `shares_file_id_idx` ON `shares` (`file_id`);