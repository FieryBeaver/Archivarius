-- v0.7: custom roles. A custom role is a project-defined LABEL (e.g. "Co-GM",
-- "Player", "Guest") mapped onto one of the three base capabilities
-- (owner/editor/viewer). members.role keeps holding the BASE role, so every
-- existing policy and helper stays exactly as audited; a trigger keeps the
-- base in sync with the assigned custom role.

create table project_roles (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  name text not null,
  base text not null check (base in ('owner','editor','viewer')),
  created_at timestamptz not null default now()
);
create index project_roles_project_idx on project_roles(project_id);

alter table project_roles enable row level security;
create policy project_roles_select on project_roles for select
  using (is_member(project_id, array['owner','editor','viewer']));
create policy project_roles_write on project_roles for all
  using (is_member(project_id, array['owner']))
  with check (is_member(project_id, array['owner']));

-- Deleting a custom role demotes nobody: members keep their base role.
alter table members add column custom_role_id uuid references project_roles(id) on delete set null;

-- The base role always mirrors the assigned custom role's base, and a custom
-- role can only come from the member's own project.
create function sync_member_custom_role() returns trigger
language plpgsql security definer set search_path = public as $$
declare mapped text;
begin
  if new.custom_role_id is not null then
    select base into mapped from project_roles
    where id = new.custom_role_id and project_id = new.project_id;
    if mapped is null then
      raise exception 'custom role does not belong to this project' using errcode = '23503';
    end if;
    new.role := mapped;
  end if;
  return new;
end $$;
create trigger members_sync_custom_role before insert or update on members
  for each row execute function sync_member_custom_role();

-- Member listing now carries the custom role's name (return type change
-- requires dropping the old function).
drop function project_members(uuid);
create function project_members(p uuid)
returns table (user_id uuid, role text, email text, custom_role_id uuid, custom_role_name text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_member(p, array['owner','editor','viewer']) then
    return;
  end if;
  return query
    select m.user_id, m.role, coalesce(pr.email, ''), m.custom_role_id, r.name
    from members m
    left join profiles pr on pr.id = m.user_id
    left join project_roles r on r.id = m.custom_role_id
    where m.project_id = p
    order by case m.role when 'owner' then 0 when 'editor' then 1 else 2 end, pr.email;
end $$;
revoke execute on function project_members(uuid) from public, anon;
grant execute on function project_members(uuid) to authenticated;
