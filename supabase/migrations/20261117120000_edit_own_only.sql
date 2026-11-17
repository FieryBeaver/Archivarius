-- v0.10: "edit own pages only" custom roles (e.g. a "Player" role).
-- A custom role with base 'editor' may set edit_own_only: its members can
-- still create pages and read everything that isn't secret, but can write
-- only to pages they created — or pages an owner explicitly granted them via
-- page_editors (explicit grants win). Applies to the page row and, through
-- can_edit_page, to its pins/regions/events. Owner/viewer-based roles never
-- carry the flag (check constraint).

alter table project_roles add column edit_own_only boolean not null default false;
alter table project_roles add constraint project_roles_edit_own_only_editor
  check (not edit_own_only or base = 'editor');

-- Is the signed-in user an editor whose custom role is edit-own-only here?
create function edits_own_pages_only(p_project uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from members m
    join project_roles r on r.id = m.custom_role_id
    where m.project_id = p_project and m.user_id = auth.uid()
      and m.role = 'editor' and r.edit_own_only
  );
$$;
revoke execute on function edits_own_pages_only(uuid) from public, anon;
grant execute on function edits_own_pages_only(uuid) to authenticated;

-- Same as 20261114150000, plus: an edit-own-only editor additionally needs to
-- be the page's creator or a listed page editor.
create or replace function can_edit_page(p uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from pages pg
    join members m on m.project_id = pg.project_id and m.user_id = auth.uid()
    left join project_roles r on r.id = m.custom_role_id
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
          and (
            not coalesce(r.edit_own_only, false)
            or pg.created_by = auth.uid()
            or exists (
              select 1 from page_editors pe
              where pe.page_id = pg.id and pe.user_id = auth.uid()
            )
          )
        )
      )
  );
$$;

-- Delete: as before, plus edit-own-only editors delete only their own (or
-- granted) pages.
drop policy pages_delete on pages;
create policy pages_delete on pages for delete
  using (
    is_member(project_id, array['owner','editor'])
    and (
      not is_secret
      or is_member(project_id, array['owner'])
      or (created_by = auth.uid() and is_member(project_id, array['editor']))
    )
    and (
      created_by = auth.uid()
      or not edits_own_pages_only(project_id)
      or exists (
        select 1 from page_editors pe
        where pe.page_id = pages.id and pe.user_id = auth.uid()
      )
    )
  );

-- RLS does not apply to ON DELETE CASCADE, so deleting their own page could
-- still wipe child pages other people created under it. Row triggers do fire
-- on cascaded rows: refuse when any affected page is outside their reach.
create function guard_page_delete_own_only() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null
     and edits_own_pages_only(old.project_id)
     and old.created_by is distinct from auth.uid()
     and not exists (
       select 1 from page_editors pe
       where pe.page_id = old.id and pe.user_id = auth.uid()
     ) then
    raise exception 'you can only delete pages you created (a subpage belongs to someone else)'
      using errcode = '42501';
  end if;
  return old;
end $$;
create trigger pages_guard_delete_own_only before delete on pages
  for each row execute function guard_page_delete_own_only();

-- Member listing also carries the custom role's edit_own_only flag (return
-- type change requires dropping the old function).
drop function project_members(uuid);
create function project_members(p uuid)
returns table (
  user_id uuid, role text, email text,
  custom_role_id uuid, custom_role_name text, custom_role_edit_own_only boolean
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_member(p, array['owner','editor','viewer']) then
    return;
  end if;
  return query
    select m.user_id, m.role, coalesce(pr.email, ''), m.custom_role_id, r.name,
           coalesce(r.edit_own_only, false)
    from members m
    left join profiles pr on pr.id = m.user_id
    left join project_roles r on r.id = m.custom_role_id
    where m.project_id = p
    order by case m.role when 'owner' then 0 when 'editor' then 1 else 2 end, pr.email;
end $$;
revoke execute on function project_members(uuid) from public, anon;
grant execute on function project_members(uuid) to authenticated;
