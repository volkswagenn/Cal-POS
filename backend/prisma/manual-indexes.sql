-- Run once in Supabase → SQL Editor.
-- Idempotent: safe to run multiple times. Speeds up the sync delete-feed
-- query and the daily TTL prune so they don't degrade into full scans.

CREATE INDEX IF NOT EXISTS "SyncLog_shopId_action_syncedAt_idx"
  ON "SyncLog" ("shopId", "action", "syncedAt");

CREATE INDEX IF NOT EXISTS "SyncLog_syncedAt_idx"
  ON "SyncLog" ("syncedAt");

CREATE INDEX IF NOT EXISTS "ActivityLog_createdAt_idx"
  ON "ActivityLog" ("createdAt");
