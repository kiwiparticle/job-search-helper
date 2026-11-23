-- `seq` is the write counter (meta.seq) of the batch that last wrote the row, so the page fetches only rows newer than it has.
-- Existing databases got the column from db/migrations/2026-11-22-seq.sql.
CREATE TABLE IF NOT EXISTS companies (key TEXT PRIMARY KEY, version INTEGER NOT NULL, data TEXT NOT NULL, seq INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS postings (id TEXT PRIMARY KEY, version INTEGER NOT NULL, data TEXT NOT NULL, seq INTEGER NOT NULL DEFAULT 0);
CREATE INDEX IF NOT EXISTS companies_seq ON companies (seq);
CREATE INDEX IF NOT EXISTS postings_seq ON postings (seq);
-- One row: bumped once by every writeRows batch.
CREATE TABLE IF NOT EXISTS meta (id INTEGER PRIMARY KEY CHECK (id = 1), seq INTEGER NOT NULL);
INSERT OR IGNORE INTO meta (id, seq) VALUES (1, 0);
-- Companies and postings rows deleted, at the seq of the deleting batch, so a page's delta fetch drops them too.
CREATE TABLE IF NOT EXISTS deleted (tbl TEXT NOT NULL, id TEXT NOT NULL, seq INTEGER NOT NULL, PRIMARY KEY (tbl, id));
CREATE INDEX IF NOT EXISTS deleted_seq ON deleted (tbl, seq);
CREATE TABLE IF NOT EXISTS history (company_key TEXT NOT NULL, n INTEGER NOT NULL, data TEXT NOT NULL, PRIMARY KEY (company_key, n));
CREATE TABLE IF NOT EXISTS supplement (id TEXT PRIMARY KEY, version INTEGER NOT NULL, data TEXT NOT NULL);
-- Rule changes the weekly tune run proposes (lib/tune.js); the owner applies or dismisses each.
CREATE TABLE IF NOT EXISTS tune (id TEXT PRIMARY KEY, version INTEGER NOT NULL, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS finished_runs (run TEXT PRIMARY KEY, at TEXT NOT NULL, result TEXT NOT NULL);
-- Stale-write guard: a versioned UPDATE/DELETE is followed by
-- INSERT INTO guard (ok) SELECT 0 WHERE changes() = 0
-- which fails this CHECK when the row had a different version, and so aborts the whole batch.
CREATE TABLE IF NOT EXISTS guard (ok INTEGER NOT NULL CHECK (ok = 1));
