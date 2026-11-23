-- One time, before the code that writes `seq` ships: npx wrangler d1 execute job-search --remote --file db/migrations/2026-11-22-seq.sql
-- then db/schema.sql for the indexes and the meta and deleted tables.
ALTER TABLE companies ADD COLUMN seq INTEGER NOT NULL DEFAULT 0;
ALTER TABLE postings ADD COLUMN seq INTEGER NOT NULL DEFAULT 0;
