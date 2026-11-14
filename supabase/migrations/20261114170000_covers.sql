-- v0.7: world cover image (shown on the "Your worlds" card).
-- The image itself lives in the existing public maps bucket (which already
-- enforces the 10 MB / image-only limits) under <project_id>/cover-*.
-- Only owners can change the row (existing projects_update policy).

alter table projects add column cover_path text;
