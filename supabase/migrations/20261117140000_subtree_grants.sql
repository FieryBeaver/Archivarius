-- v0.10: subtree grants. A page_editors row on a page now grants its member
-- access to that page AND every page under it:
--   * read: secret pages in a granted subtree are visible to the grantee
--     (any member role, viewers included);
--   * edit: editors may edit pages in a granted subtree — including secret
--     ones, restricted ones, and (for edit-own-only roles) other people's;
--   * delete: as edit, for edit-own-only roles.
-- Plain ungranted editors still never see or touch other people's secrets.
-- Pins/regions/events/mentions follow automatically (their policies call
-- can_read_page / can_edit_page).

-- Is the signed-in user listed in page_editors for p or any ancestor of p?
-- Depth-capped walk up parent_id (guards against accidental cycles).
create function has_page_grant(p uuid)
returns boolean language sql stable security definer set search_path = public as $$
  with recursive chain(id, parent_id, depth) as (
    select pg.id, pg.parent_id, 0
    from pages pg
    where pg.id = p
      -- cheap exit for the common case: no grants at all in this project
      and exists (
        select 1 from page_editors pe
        where pe.user_id = auth.uid() and pe.project_id = pg.project_id
      )
    union all
    select pg.id, pg.parent_id, c.depth + 1
    from pages pg
    join chain c on pg.id = c.parent_id
    where c.depth < 50
  )
  select exists (
    select 1 from chain c
    join page_editors pe on pe.page_id = c.id and pe.user_id = auth.uid()
  );
$$;
revoke execute on function has_page_grant(uuid) from public, anon;
grant execute on function has_page_grant(uuid) to authenticated;

-- ---------- read ----------

-- 20261114150000 + granted subtrees.
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
        or has_page_grant(pg.id)
      )
  );
$$;

drop policy pages_select on pages;
create policy pages_select on pages for select
  using (
    is_member(project_id, array['owner','editor','viewer'])
    and (
      not is_secret
      or is_member(project_id, array['owner'])
      or (created_by = auth.uid() and is_member(project_id, array['editor']))
      or has_page_grant(id)
    )
  );

-- ---------- edit ----------

-- 20261117120000 with every direct page_editors check widened to the subtree
-- grant, and the secret condition accepting a grant.
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
          and (not pg.is_secret or pg.created_by = auth.uid() or has_page_grant(pg.id))
          and (pg.edit_access = 'inherit' or has_page_grant(pg.id))
          and (
            not coalesce(r.edit_own_only, false)
            or pg.created_by = auth.uid()
            or has_page_grant(pg.id)
          )
        )
      )
  );
$$;

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
      or has_page_grant(id)
    )
  );

-- A grant lets you edit a secret page, not expose it: only owners and the
-- page's creator may change is_secret (same outcome as before grants existed).
create function guard_page_secret_toggle() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.is_secret is distinct from old.is_secret
     and auth.uid() is not null
     and not is_member(old.project_id, array['owner'])
     and old.created_by is distinct from auth.uid() then
    raise exception 'only owners and the page''s creator can change whether it is secret'
      using errcode = '42501';
  end if;
  return new;
end $$;
create trigger pages_guard_secret_toggle before update on pages
  for each row execute function guard_page_secret_toggle();

-- A non-owner's new page under a secret parent is secret too, so content a
-- grantee adds inside a hidden subtree never leaks to the rest of the world.
-- (It stays visible to its creator and to the subtree's grantees.)
create function inherit_parent_secret() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.parent_id is not null
     and not new.is_secret
     and auth.uid() is not null
     and not is_member(new.project_id, array['owner'])
     and exists (select 1 from pages where id = new.parent_id and is_secret) then
    new.is_secret := true;
  end if;
  return new;
end $$;
create trigger pages_inherit_parent_secret before insert on pages
  for each row execute function inherit_parent_secret();

-- ---------- delete ----------

drop policy pages_delete on pages;
create policy pages_delete on pages for delete
  using (
    is_member(project_id, array['owner','editor'])
    and (
      not is_secret
      or is_member(project_id, array['owner'])
      or (created_by = auth.uid() and is_member(project_id, array['editor']))
      or has_page_grant(id)
    )
    and (
      created_by = auth.uid()
      or not edits_own_pages_only(project_id)
      or has_page_grant(id)
    )
  );

-- Cascade guard, now subtree-aware. Cascaded child rows are deleted after
-- their parent is gone, so an ancestor grant can't be resolved from them;
-- instead the directly deleted row (trigger depth 1) vets its whole subtree
-- while the tree is still intact, and cascaded rows (depth > 1) are skipped.
create or replace function guard_page_delete_own_only() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null
     and pg_trigger_depth() = 1
     and edits_own_pages_only(old.project_id)
     and exists (
       with recursive sub(id, created_by, depth) as (
         select old.id, old.created_by, 0
         union all
         select c.id, c.created_by, s.depth + 1
         from pages c join sub s on c.parent_id = s.id
         where s.depth < 50
       )
       select 1 from sub
       where sub.created_by is distinct from auth.uid()
         and not has_page_grant(sub.id)
     ) then
    raise exception 'you can only delete pages you created (a subpage belongs to someone else)'
      using errcode = '42501';
  end if;
  return old;
end $$;
