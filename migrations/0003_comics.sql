-- Comic Maker: one row per comic, plus the images drawn for it.
CREATE TABLE comics (
  id TEXT PRIMARY KEY,
  story TEXT NOT NULL,          -- exactly what he typed (kept for parents)
  title TEXT,
  script TEXT,                  -- comic script JSON from Claude
  status TEXT NOT NULL,         -- scripting | drawing | done | failed
  flags TEXT,                   -- JSON: blocklist hits and Claude's change notes, for parents
  error TEXT,
  day TEXT NOT NULL,            -- local date (YYYY-MM-DD) the comic was made, for the daily cap
  created_at INTEGER NOT NULL
);
CREATE INDEX comics_by_day ON comics(day);

CREATE TABLE comic_images (
  comic_id TEXT NOT NULL REFERENCES comics(id) ON DELETE CASCADE,
  slot TEXT NOT NULL,           -- char-0, char-1 … (character sheets) or panel-0, panel-1 …
  r2_key TEXT NOT NULL,
  prompt TEXT,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (comic_id, slot)
);
