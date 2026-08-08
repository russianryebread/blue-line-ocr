-- The legacy schema used visiting_score; the rebuilt API uses visitor_score.
ALTER TABLE games ADD COLUMN visitor_score INTEGER;

UPDATE games
SET visitor_score = COALESCE(visitor_score, visiting_score);

CREATE INDEX IF NOT EXISTS idx_games_score_lookup ON games (home_score, visitor_score);
