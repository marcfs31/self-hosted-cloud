CREATE TABLE `dav_properties` (
	`file_id` text NOT NULL,
	`ns` text NOT NULL,
	`name` text NOT NULL,
	`xml` text NOT NULL,
	PRIMARY KEY(`file_id`, `ns`, `name`),
	FOREIGN KEY (`file_id`) REFERENCES `files`(`id`) ON UPDATE no action ON DELETE cascade
);
