-- v0.9 (document images): the `maps` bucket had no SELECT policy on
-- storage.objects, so storage.list() silently returned [] (public URLs still
-- worked because the bucket is public). Add a member-scoped select policy and
-- scope the existing write policies to the project in the object's first path
-- segment (every maps upload — map images, covers, document images — uses a
-- `<project_id>/...` path). Reuses plugin_object_project() from the plugins
-- migration, which yields null (→ denied) for a malformed path.

create policy maps_select on storage.objects for select to authenticated
  using (bucket_id = 'maps'
         and is_member(plugin_object_project(name), array['owner','editor','viewer']));

drop policy if exists maps_upload on storage.objects;
create policy maps_upload on storage.objects for insert to authenticated
  with check (bucket_id = 'maps'
              and is_member(plugin_object_project(name), array['owner','editor']));

drop policy if exists maps_update on storage.objects;
create policy maps_update on storage.objects for update to authenticated
  using (bucket_id = 'maps'
         and is_member(plugin_object_project(name), array['owner','editor']))
  with check (bucket_id = 'maps'
              and is_member(plugin_object_project(name), array['owner','editor']));

drop policy if exists maps_delete on storage.objects;
create policy maps_delete on storage.objects for delete to authenticated
  using (bucket_id = 'maps'
         and is_member(plugin_object_project(name), array['owner','editor']));
