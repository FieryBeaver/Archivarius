-- v0.7: per-page DM notes, hidden from viewer-role members SERVER-SIDE.
-- Secret blocks inside page content are client-side hiding only (the page row
-- reaches every member). DM notes live in their own table so RLS keeps them
-- from viewers entirely: a viewer's select simply returns no row.

create table page_dm_notes (
  page_id uuid primary key references pages(id) on delete cascade,
  project_id uuid not null references projects(id) on delete cascade,
  content jsonb,
  updated_at timestamptz not null default now()
);
create index page_dm_notes_project_idx on page_dm_notes(project_id);

-- project_id always comes from the page row, never from the client, so the
-- RLS check below can't be bypassed by naming a project the writer controls.
create function set_dm_notes_project() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  select project_id into new.project_id from pages where id = new.page_id;
  return new;
end $$;
create trigger dm_notes_set_project before insert or update on page_dm_notes
  for each row execute function set_dm_notes_project();

create trigger dm_notes_touch before update on page_dm_notes
  for each row execute function touch_updated_at();

alter table page_dm_notes enable row level security;

create policy dm_notes_select on page_dm_notes for select
  using (is_member(project_id, array['owner','editor']));
create policy dm_notes_insert on page_dm_notes for insert
  with check (is_member(project_id, array['owner','editor']));
create policy dm_notes_update on page_dm_notes for update
  using (is_member(project_id, array['owner','editor']));
create policy dm_notes_delete on page_dm_notes for delete
  using (is_member(project_id, array['owner','editor']));
