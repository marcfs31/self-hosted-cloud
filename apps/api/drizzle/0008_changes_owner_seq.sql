CREATE TABLE `__new_changes` (
	`seq` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`owner_id` text NOT NULL,
	`owner_seq` integer NOT NULL,
	`file_id` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_changes` (`seq`, `owner_id`, `owner_seq`, `file_id`, `created_at`)
SELECT `seq`, `owner_id`, row_number() OVER (PARTITION BY `owner_id` ORDER BY `seq`), `file_id`, `created_at`
FROM `changes`;
--> statement-breakpoint
DROP TABLE `changes`;
--> statement-breakpoint
ALTER TABLE `__new_changes` RENAME TO `changes`;
--> statement-breakpoint
CREATE UNIQUE INDEX `changes_owner_owner_seq_idx` ON `changes` (`owner_id`,`owner_seq`);
