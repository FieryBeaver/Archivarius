-- v0.5 (Archivarius): per-project theme, per-page edit restrictions, page tabs.

alter table projects add column theme jsonb;

alter table pages add column edit_access text not null default 'inherit'
  check (edit_access in ('inherit','restricted'));
alter table pages add column tabs jsonb;

-- Explicit editors of a restricted page. Carries its own project_id so the
-- policies below never have to join through pages (no RLS recursion).
create table page_editors (
  page_id uuid not null references pages(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid not null references projects(id) on delete cascade,
  primary key (page_id, user_id)
);
create index page_editors_page_idx on page_editors(page_id);

alter table page_editors enable row level security;
create policy page_editors_select on page_editors for select
  using (is_member(project_id, array['owner','editor','viewer']));
create policy page_editors_insert on page_editors for insert
  with check (is_member(project_id, array['owner']));
create policy page_editors_delete on page_editors for delete
  using (is_member(project_id, array['owner']));

-- Can the signed-in user write to this page (and its pins/regions/events)?
-- owner => always; editor => page is 'inherit' or user is a listed page editor.
create function can_edit_page(p uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from pages pg
    join members m on m.project_id = pg.project_id and m.user_id = auth.uid()
    where pg.id = p
      and (
        m.role = 'owner'
        or (
          m.role = 'editor'
          and (
            pg.edit_access = 'inherit'
            or exists (
              select 1 from page_editors pe
              where pe.page_id = pg.id and pe.user_id = auth.uid()
            )
          )
        )
      )
  );
$$;
revoke execute on function can_edit_page(uuid) from public, anon;
grant execute on function can_edit_page(uuid) to authenticated;

-- pages: split the old catch-all write policy. SELECT stays pages_select;
-- INSERT/DELETE keep the previous owner/editor rule; UPDATE is edit-gated.
drop policy pages_write on pages;
create policy pages_insert on pages for insert
  with check (is_member(project_id, array['owner','editor']));
create policy pages_update on pages for update
  using (can_edit_page(id))
  with check (is_member(project_id, array['owner','editor']) and can_edit_page(id));
create policy pages_delete on pages for delete
  using (is_member(project_id, array['owner','editor']));

-- Only owners may change a page's edit_access (an editor must not be able to
-- lock others out). Skipped when there is no end-user session (service role).
create function guard_page_edit_access() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.edit_access is distinct from old.edit_access
     and auth.uid() is not null
     and not is_member(old.project_id, array['owner']) then
    raise exception 'only project owners can change page edit access'
      using errcode = '42501';
  end if;
  return new;
end $$;
create trigger pages_guard_edit_access before update on pages
for each row execute function guard_page_edit_access();

-- pins
drop policy pins_write on pins;
create policy pins_insert on pins for insert
  with check (can_edit_page(map_page_id));
create policy pins_update on pins for update
  using (can_edit_page(map_page_id))
  with check (can_edit_page(map_page_id));
create policy pins_delete on pins for delete
  using (can_edit_page(map_page_id));

-- regions
drop policy regions_write on regions;
create policy regions_insert on regions for insert
  with check (can_edit_page(map_page_id));
create policy regions_update on regions for update
  using (can_edit_page(map_page_id))
  with check (can_edit_page(map_page_id));
create policy regions_delete on regions for delete
  using (can_edit_page(map_page_id));

-- events
drop policy events_write on events;
create policy events_insert on events for insert
  with check (can_edit_page(timeline_page_id));
create policy events_update on events for update
  using (can_edit_page(timeline_page_id))
  with check (can_edit_page(timeline_page_id));
create policy events_delete on events for delete
  using (can_edit_page(timeline_page_id));
