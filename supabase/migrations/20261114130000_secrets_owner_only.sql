-- v0.7: secrets are OWNER-only (LegendKeeper-style GM/player split).
-- Editors keep editing regular pages (their own PC pages included), but no
-- longer receive GM machinery: secret pages, their pins/regions/events and
-- backlink rows, or DM notes. Worlds with several GMs use several owners.
-- This also closes pre-existing gaps: pins/regions/events and mentions of a
-- secret page were visible to every member, and editors could blind-write
-- secret page rows by id.

-- Editors can no longer edit secret pages at all (they can't read them).
create or replace function can_edit_page(p uuid)
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
          and not pg.is_secret
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

-- Can the signed-in user read this page? Members read non-secret pages;
-- only owners read secret ones. For child rows (pins/regions/events/mentions).
create function can_read_page(p uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from pages pg
    join members m on m.project_id = pg.project_id and m.user_id = auth.uid()
    where pg.id = p and (not pg.is_secret or m.role = 'owner')
  );
$$;
revoke execute on function can_read_page(uuid) from public, anon;
grant execute on function can_read_page(uuid) to authenticated;

-- pages: secret rows exist only for owners, in every command.
drop policy pages_select on pages;
create policy pages_select on pages for select
  using (
    is_member(project_id, array['owner','editor','viewer'])
    and (not is_secret or is_member(project_id, array['owner']))
  );
drop policy pages_insert on pages;
create policy pages_insert on pages for insert
  with check (
    is_member(project_id, array['owner','editor'])
    and (not is_secret or is_member(project_id, array['owner']))
  );
drop policy pages_update on pages;
create policy pages_update on pages for update
  using (can_edit_page(id))
  with check (
    is_member(project_id, array['owner','editor'])
    and can_edit_page(id)
    and (not is_secret or is_member(project_id, array['owner']))
  );
drop policy pages_delete on pages;
create policy pages_delete on pages for delete
  using (
    is_member(project_id, array['owner','editor'])
    and (not is_secret or is_member(project_id, array['owner']))
  );

-- Child rows follow their page's visibility (writes already use can_edit_page,
-- which now refuses editors on secret pages).
drop policy pins_select on pins;
create policy pins_select on pins for select using (can_read_page(map_page_id));
drop policy regions_select on regions;
create policy regions_select on regions for select using (can_read_page(map_page_id));
drop policy events_select on events;
create policy events_select on events for select using (can_read_page(timeline_page_id));
drop policy mentions_select on mentions;
create policy mentions_select on mentions for select using (can_read_page(from_page_id));
drop policy mentions_write on mentions;
create policy mentions_write on mentions for all
  using (can_edit_page(from_page_id))
  with check (can_edit_page(from_page_id));

-- DM notes become owner-only.
drop policy dm_notes_select on page_dm_notes;
create policy dm_notes_select on page_dm_notes for select
  using (is_member(project_id, array['owner']));
drop policy dm_notes_insert on page_dm_notes;
create policy dm_notes_insert on page_dm_notes for insert
  with check (is_member(project_id, array['owner']));
drop policy dm_notes_update on page_dm_notes;
create policy dm_notes_update on page_dm_notes for update
  using (is_member(project_id, array['owner']));
drop policy dm_notes_delete on page_dm_notes;
create policy dm_notes_delete on page_dm_notes for delete
  using (is_member(project_id, array['owner']));
