INSERT INTO `changes` (`owner_id`, `file_id`, `created_at`)
SELECT `owner_id`, `id`, `updated_at` FROM `files` ORDER BY `created_at`, `rowid`;
