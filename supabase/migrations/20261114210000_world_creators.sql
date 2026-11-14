-- v0.7: instance-level control over who may CREATE worlds.
--
-- Default: NOBODY may create a world unless their (confirmed) account email is
-- listed in world_creators. Joining worlds by invite stays open to everyone,
-- and existing worlds/members are untouched.
--
-- Administering the list (Supabase dashboard → SQL editor, or psql):
--   insert into world_creators (email) values ('someone@example.com');   -- allow
--   delete from world_creators where email = 'someone@example.com';      -- revoke
--   select * from world_creators;                                        -- list
-- Emails match case-insensitively. Revoking never deletes existing worlds.
-- The table has RLS on and no policies, so the app's API can't read or write
-- it; only the database owner (dashboard/SQL) can.

create table world_creators (
  email text primary key check (email = lower(email)),
  added_at timestamptz not null default now()
);
alter table world_creators enable row level security;

insert into world_creators (email) values ('herasym3@gmail.com');

-- Is the signed-in user allowed to create worlds? Requires a CONFIRMED email,
-- so nobody can claim an allowlisted address by signing up unverified.
create function can_create_worlds()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from auth.users u
    join world_creators w on w.email = lower(u.email)
    where u.id = auth.uid() and u.email_confirmed_at is not null
  );
$$;
revoke execute on function can_create_worlds() from public, anon;
grant execute on function can_create_worlds() to authenticated;

drop policy projects_insert on projects;
create policy projects_insert on projects for insert
  with check (owner_id = auth.uid() and can_create_worlds());
