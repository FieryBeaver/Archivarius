-- v0.6 (Archivarius): user-uploaded plugins. Each plugin is one self-contained
-- HTML file stored at plugins/<project_id>/<plugin_id>.html and rendered by the
-- editor inside a sandboxed iframe (sandbox="allow-scripts" only).

create table plugins (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  name text not null,
  icon text,
  source_path text not null,
  created_at timestamptz not null default now()
);
create index plugins_project_idx on plugins(project_id);

alter table plugins enable row level security;
create policy plugins_select on plugins for select
  using (is_member(project_id, array['owner','editor','viewer']));
create policy plugins_insert on plugins for insert
  with check (is_member(project_id, array['owner']));
create policy plugins_update on plugins for update
  using (is_member(project_id, array['owner']))
  with check (is_member(project_id, array['owner']));
create policy plugins_delete on plugins for delete
  using (is_member(project_id, array['owner']));

-- Storage. Unlike `maps` (public read), plugin sources are PRIVATE: only
-- members of the project in the first path segment may read them, only its
-- owners may write. 256 KB cap enforced server-side too.
insert into storage.buckets (id, name, public, file_size_limit)
values ('plugins', 'plugins', false, 262144);

-- Project id from the object's first folder segment, null if it isn't a uuid
-- (so a malformed path is simply denied instead of raising a cast error).
create function plugin_object_project(object_name text)
returns uuid language sql immutable set search_path = public as $$
  select case
    when (storage.foldername(object_name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then ((storage.foldername(object_name))[1])::uuid
  end;
$$;

create policy plugins_obj_select on storage.objects for select to authenticated
  using (bucket_id = 'plugins'
         and is_member(plugin_object_project(name), array['owner','editor','viewer']));
create policy plugins_obj_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'plugins'
              and is_member(plugin_object_project(name), array['owner']));
create policy plugins_obj_update on storage.objects for update to authenticated
  using (bucket_id = 'plugins'
         and is_member(plugin_object_project(name), array['owner']))
  with check (bucket_id = 'plugins'
              and is_member(plugin_object_project(name), array['owner']));
create policy plugins_obj_delete on storage.objects for delete to authenticated
  using (bucket_id = 'plugins'
         and is_member(plugin_object_project(name), array['owner']));
