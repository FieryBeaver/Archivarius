-- v0.10: secrecy is a SUBTREE property. A page is hidden when it OR ANY
-- ANCESTOR is secret. The per-page escape hatches carry over to every secret
-- page in the chain: owners see everything; an editor passes a secret page
-- they created; and a subtree grant (has_page_grant) on the page — i.e. on it
-- or on any ancestor, including the blocking secret one — opens the path.
-- Everything else (edit_access, edit_own_only, grants for editing) is
-- unchanged from 20261117140000_subtree_grants.sql. Pins/regions/events/
-- mentions follow via can_read_page / can_edit_page.

-- Does no secret page on p's ancestor chain (p included) hide p from the
-- signed-in user? Callers check membership separately.
create function passes_secret_chain(p uuid)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare
  proj uuid;
begin
  if p is null then
    return true;
  end if;
  select project_id into proj from pages where id = p;
  if proj is null then
    -- Not visible to this statement (e.g. the row an INSERT … RETURNING is
    -- creating): nothing to walk. Policies keep the row's own secret clause
    -- for that case.
    return true;
  end if;
  if is_member(proj, array['owner']) then
    return true;
  end if;
  -- Cheap exits: a world without secrets, or a grant somewhere on the path.
  if not exists (select 1 from pages where project_id = proj and is_secret) then
    return true;
  end if;
  if has_page_grant(p) then
    return true;
  end if;
  return not exists (
    with recursive chain(id, parent_id, is_secret, created_by, depth) as (
      select pg.id, pg.parent_id, pg.is_secret, pg.created_by, 0
      from pages pg where pg.id = p
      union all
      select pg.id, pg.parent_id, pg.is_secret, pg.created_by, c.depth + 1
      from pages pg
      join chain c on pg.id = c.parent_id
      where c.depth < 50
    )
    select 1 from chain s
    where s.is_secret
      and not (s.created_by = auth.uid() and is_member(proj, array['editor']))
  );
end $$;
revoke execute on function passes_secret_chain(uuid) from public, anon;
grant execute on function passes_secret_chain(uuid) to authenticated;

-- ---------- read ----------

create or replace function can_read_page(p uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from pages pg
    join members m on m.project_id = pg.project_id and m.user_id = auth.uid()
    where pg.id = p
      and passes_secret_chain(pg.id)
  );
$$;

-- The row's own secret clause stays (it is what vets a row this statement is
-- inserting, which the chain walk can't see yet); the chain adds ancestors.
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
    and passes_secret_chain(id)
  );

-- ---------- edit ----------

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
          and passes_secret_chain(pg.id)
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
    and passes_secret_chain(id)
  );

-- ---------- delete ----------

drop policy pages_delete on pages;
create policy pages_delete on pages for delete
  using (
    is_member(project_id, array['owner','editor'])
    and passes_secret_chain(id)
    and (
      created_by = auth.uid()
      or not edits_own_pages_only(project_id)
      or has_page_grant(id)
    )
  );

-- ---------- moves ----------

-- Moving a page under a secret page now hides it, so a move is a secrecy
-- change. For non-owners: the destination must be visible to them, and they
-- may only move someone else's page into a hidden subtree they hold a grant on
-- (same spirit as guard_page_secret_toggle: you can't hide other people's work).
create function guard_page_move_secret() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.parent_id is distinct from old.parent_id
     and new.parent_id is not null
     and auth.uid() is not null
     and not is_member(old.project_id, array['owner']) then
    if not passes_secret_chain(new.parent_id) then
      raise exception 'you can''t move a page there' using errcode = '42501';
    end if;
    if old.created_by is distinct from auth.uid()
       and not has_page_grant(new.parent_id)
       and exists (
         with recursive chain(id, parent_id, is_secret, depth) as (
           select pg.id, pg.parent_id, pg.is_secret, 0 from pages pg where pg.id = new.parent_id
           union all
           select pg.id, pg.parent_id, pg.is_secret, c.depth + 1
           from pages pg join chain c on pg.id = c.parent_id
           where c.depth < 50
         )
         select 1 from chain where is_secret
       ) then
      raise exception 'only owners and the page''s creator can move it into a secret section'
        using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
create trigger pages_guard_move_secret before update on pages
  for each row execute function guard_page_move_secret();
