-- Add fields used by the rebuilt editor without disturbing existing records.
ALTER TABLE games ADD COLUMN updated_at TEXT;
ALTER TABLE games ADD COLUMN game_time TEXT;
ALTER TABLE games ADD COLUMN venue TEXT;
ALTER TABLE games ADD COLUMN status TEXT NOT NULL DEFAULT 'draft';
ALTER TABLE games ADD COLUMN ocr_json TEXT;
ALTER TABLE games ADD COLUMN archived_at TEXT;
ALTER TABLE games ADD COLUMN visitor_team TEXT;
ALTER TABLE games ADD COLUMN scorecard_json TEXT;

UPDATE games
SET updated_at = COALESCE(updated_at, created_at),
    status = COALESCE(status, 'draft'),
    visitor_team = COALESCE(visitor_team, visiting_team),
    scorecard_json = COALESCE(scorecard_json, data);

CREATE INDEX IF NOT EXISTS idx_games_updated_at ON games (updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_games_teams ON games (home_team, visiting_team);
