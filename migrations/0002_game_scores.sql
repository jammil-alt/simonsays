-- Typing games: one row per finished round.
CREATE TABLE game_scores (
  id TEXT PRIMARY KEY,
  game TEXT NOT NULL,
  level TEXT NOT NULL,
  score INTEGER NOT NULL,
  hits INTEGER NOT NULL DEFAULT 0,
  stars INTEGER NOT NULL DEFAULT 0,
  accuracy REAL,
  created_at INTEGER NOT NULL
);
CREATE INDEX game_scores_by_level ON game_scores(game, level, score DESC);
