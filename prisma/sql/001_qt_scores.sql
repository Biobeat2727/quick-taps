-- qt_scores: one row per leaderboard entry (a bowling game total, or a win).
--
-- ⚠️ The Neon database is SHARED with sister products (What's on Tap: Room,
-- Game, Vote, …). Never run `prisma db push` / `prisma migrate` against it —
-- Prisma would offer to drop tables it doesn't know. Apply changes with
-- additive SQL like this file:  node scripts/apply-sql.mjs prisma/sql/001_qt_scores.sql

CREATE TABLE IF NOT EXISTS qt_scores (
  id           TEXT PRIMARY KEY,
  venue_id     TEXT        NOT NULL,             -- which bar ('dev' for local development)
  night        TEXT        NOT NULL,             -- venue-local night, 'YYYY-MM-DD'; a night runs 4 AM → 4 AM
  game         TEXT        NOT NULL,             -- 'bowling' | 'pool' | 'marble_race'
  kind         TEXT        NOT NULL,             -- 'game' (bowling total) | 'win'
  player_name  TEXT        NOT NULL,
  player_key   TEXT        NOT NULL,             -- normalized name: rows group by this
  value        INTEGER     NOT NULL,
  vs_humans    BOOLEAN     NOT NULL,
  session_id   TEXT        NOT NULL,
  dedupe_key   TEXT        NOT NULL UNIQUE,      -- one row per player per game, however often it's reported
  counts_at    TIMESTAMPTZ NOT NULL DEFAULT now(), -- hidden until then (a marble race is decided before it plays out)
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS qt_scores_board ON qt_scores (venue_id, night, game);
