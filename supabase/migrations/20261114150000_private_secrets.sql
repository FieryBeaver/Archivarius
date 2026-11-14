-- v0.7: private secrets & notes per creator.
-- Owner sees every secret and every note. An editor can create secrets and
-- notes of their own, visible only to them and the owner. Viewers see none.
-- Supersedes the strict owner-only rule of 20261114130000 for creation.

-- ---------- pages: who created it ----------

alter table pages add column created_by uuid references auth.users(id) on delete set null;
-- Legacy pages belong to the world's owner.
update pages set created_by = p.owner_id from projects p where p.id = pages.project_id;

create function set_page_creator() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if auth.uid() is not null then
      new.created_by := auth.uid();
    end if;
  else
    -- The creator is history, not data: it never changes.
    new.created_by := old.created_by;
  end if;
  return new;
end $$;
create trigger pages_set_creator before insert or update on pages
  for each row execute function set_page_creator();

-- ---------- visibility helpers ----------

-- Owner: everything. Editors: non-secret pages plus their own secret pages.
-- Viewers: non-secret pages only — a demoted member loses their old secrets.
create or replace function can_read_page(p uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from pages pg
    join members m on m.project_id = pg.project_id and m.user_id = auth.uid()
    where pg.id = p
      and (
        m.role = 'owner'
        or not pg.is_secret
        or (pg.created_by = auth.uid() and m.role = 'editor')
      )
  );
$$;

-- Editors can edit their own secret pages; other secret pages stay owner-only.
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
          and (not pg.is_secret or pg.created_by = auth.uid())
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

-- ---------- pages policies ----------

drop policy pages_select on pages;
create policy pages_select on pages for select
  using (
    is_member(project_id, array['owner','editor','viewer'])
    and (
      not is_secret
      or is_member(project_id, array['owner'])
      or (created_by = auth.uid() and is_member(project_id, array['editor']))
    )
  );
drop policy pages_insert on pages;
create policy pages_insert on pages for insert
  with check (
    is_member(project_id, array['owner','editor'])
    -- The creator trigger stamps auth.uid(), so an editor's new secret page is
    -- their own private page by construction. Viewers still can't insert.
  );
drop policy pages_update on pages;
create policy pages_update on pages for update
  using (can_edit_page(id))
  with check (
    is_member(project_id, array['owner','editor'])
    and can_edit_page(id)
    and (
      not is_secret
      or is_member(project_id, array['owner'])
      or (created_by = auth.uid() and is_member(project_id, array['editor']))
    )
  );
drop policy pages_delete on pages;
create policy pages_delete on pages for delete
  using (
    is_member(project_id, array['owner','editor'])
    and (
      not is_secret
      or is_member(project_id, array['owner'])
      or (created_by = auth.uid() and is_member(project_id, array['editor']))
    )
  );

-- ---------- notes: one row per page per author ----------

alter table page_dm_notes add column user_id uuid references auth.users(id) on delete cascade;
-- Legacy notes belong to the world's owner.
update page_dm_notes set user_id = p.owner_id from projects p where p.id = page_dm_notes.project_id;
alter table page_dm_notes alter column user_id set not null;
alter table page_dm_notes drop constraint page_dm_notes_pkey;
alter table page_dm_notes add primary key (page_id, user_id);

create function set_dm_notes_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if auth.uid() is not null then
      new.user_id := auth.uid();
    end if;
  else
    new.user_id := old.user_id;
  end if;
  return new;
end $$;
create trigger dm_notes_set_user before insert or update on page_dm_notes
  for each row execute function set_dm_notes_user();

-- Owner reads/edits every note; owners and editors their own; viewers none.
drop policy dm_notes_select on page_dm_notes;
create policy dm_notes_select on page_dm_notes for select
  using (
    is_member(project_id, array['owner'])
    or (user_id = auth.uid() and is_member(project_id, array['owner','editor']))
  );
drop policy dm_notes_insert on page_dm_notes;
create policy dm_notes_insert on page_dm_notes for insert
  with check (is_member(project_id, array['owner','editor']));
drop policy dm_notes_update on page_dm_notes;
create policy dm_notes_update on page_dm_notes for update
  using (
    is_member(project_id, array['owner'])
    or (user_id = auth.uid() and is_member(project_id, array['owner','editor']))
  );
drop policy dm_notes_delete on page_dm_notes;
create policy dm_notes_delete on page_dm_notes for delete
  using (
    is_member(project_id, array['owner'])
    or (user_id = auth.uid() and is_member(project_id, array['owner','editor']))
  );
