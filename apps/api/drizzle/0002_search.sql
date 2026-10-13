-- Name search (Phase 5). Drizzle cannot model virtual tables, so this migration is hand-written.
-- files_fts is an external-content FTS5 index over files.name: it stores trigrams only and reads
-- the text back from `files` through its implicit rowid, so names are not duplicated. The trigram
-- tokenizer is case-insensitive (case_sensitive 0) and keeps diacritics ("cafe" does not match
-- "café"). If `files` is ever VACUUMed its rowids can be renumbered: run
-- INSERT INTO files_fts(files_fts) VALUES('rebuild') afterwards (nothing in the API vacuums).
CREATE VIRTUAL TABLE `files_fts` USING fts5(name, content='files', content_rowid='rowid', tokenize='trigram case_sensitive 0');--> statement-breakpoint
CREATE TRIGGER `files_fts_insert` AFTER INSERT ON `files` BEGIN
	INSERT INTO files_fts(rowid, name) VALUES (new.rowid, new.name);
END;--> statement-breakpoint
CREATE TRIGGER `files_fts_delete` AFTER DELETE ON `files` BEGIN
	INSERT INTO files_fts(files_fts, rowid, name) VALUES ('delete', old.rowid, old.name);
END;--> statement-breakpoint
CREATE TRIGGER `files_fts_rename` AFTER UPDATE OF name ON `files` BEGIN
	INSERT INTO files_fts(files_fts, rowid, name) VALUES ('delete', old.rowid, old.name);
	INSERT INTO files_fts(rowid, name) VALUES (new.rowid, new.name);
END;--> statement-breakpoint
INSERT INTO files_fts(files_fts) VALUES ('rebuild');
