-- v0.9: per-world preferences (JSON, all keys optional), e.g.
--   { "imageWarnBytes": 1048576, "autoCompress": false }
-- Readable by members via projects_select; writable by owners via the
-- existing projects_update policy (is_member(id, array['owner'])) — no policy changes.
alter table projects add column if not exists prefs jsonb;
