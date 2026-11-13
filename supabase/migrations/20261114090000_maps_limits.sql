-- v0.7: cap map image uploads server-side.
-- The production Supabase project is on the Free Plan (1 GB total storage);
-- the maps bucket previously had no file_size_limit and accepted any mime type.
-- The client enforces the same 10 MB limit with a friendlier error (src/lib/db.ts).
-- Plugin HTML uploads already have their own 256 KB cap on the plugins bucket.

update storage.buckets
set
  file_size_limit = 10485760, -- 10 MB
  allowed_mime_types = array['image/*']
where id = 'maps';
