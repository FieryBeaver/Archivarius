-- Allow a member to remove themselves ("Leave world"), except a sole owner,
-- which would orphan the project. Uses a security definer helper to avoid
-- RLS recursion on the members table.

create function has_other_owner(p uuid, u uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from members m
    where m.project_id = p and m.role = 'owner' and m.user_id <> u
  );
$$;
revoke execute on function has_other_owner(uuid, uuid) from public, anon;
grant execute on function has_other_owner(uuid, uuid) to authenticated;

create policy members_leave on members for delete
  using (
    user_id = auth.uid()
    and (role <> 'owner' or has_other_owner(project_id, auth.uid()))
  );
