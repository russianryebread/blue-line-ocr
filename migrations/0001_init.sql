-- Existing schema retained so remote D1 migration history remains compatible.
CREATE TABLE IF NOT EXISTS games (
  id                TEXT PRIMARY KEY,
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  game_date         TEXT,
  league            TEXT,
  division          TEXT,
  home_team         TEXT,
  visiting_team     TEXT,
  home_score        INTEGER,
  visiting_score    INTEGER,
  extraction_confidence TEXT,
  data              TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_games_created_at ON games (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_games_game_date ON games (game_date DESC);
