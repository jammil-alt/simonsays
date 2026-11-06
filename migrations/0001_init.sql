-- Homework Desk: initial schema
CREATE TABLE assignments (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  subject TEXT,
  due TEXT,
  done INTEGER NOT NULL DEFAULT 0,
  size TEXT NOT NULL DEFAULT 'm',
  created_at INTEGER NOT NULL
);

CREATE TABLE pages (
  id TEXT PRIMARY KEY,
  assignment_id TEXT NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  r2_key TEXT NOT NULL,
  w INTEGER,
  h INTEGER
);

-- Tap-to-type boxes on the photo. x, y, w are percentages of the page.
CREATE TABLE answers (
  id TEXT PRIMARY KEY,
  page_id TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  x REAL, y REAL, w REAL,
  text TEXT,
  updated_at INTEGER
);

-- Worksheet JSON from Claude.
CREATE TABLE clean_copies (
  page_id TEXT PRIMARY KEY REFERENCES pages(id) ON DELETE CASCADE,
  data TEXT NOT NULL,
  model TEXT,
  created_at INTEGER
);

-- Answers typed on the clean copy, keyed b0, w1, c2…
CREATE TABLE typed_values (
  page_id TEXT PRIMARY KEY REFERENCES pages(id) ON DELETE CASCADE,
  vals TEXT NOT NULL,
  updated_at INTEGER
);

CREATE INDEX pages_by_assignment ON pages(assignment_id, position);
CREATE INDEX answers_by_page ON answers(page_id);
