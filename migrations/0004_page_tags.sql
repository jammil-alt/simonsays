-- Tags on each page (JSON array of strings), read off the photo by a small model. NULL = not tagged yet.
ALTER TABLE pages ADD COLUMN tags TEXT;
