-- v0.4: user profiles (email), invite-by-email lookup, member listing.

create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  created_at timestamptz default now()
);
create unique index profiles_email_lower_idx on profiles (lower(email));

-- create profile on signup
create function handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email) values (new.id, coalesce(new.email, ''))
  on conflict (id) do nothing;
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
for each row execute function handle_new_user();

-- backfill existing users
insert into profiles (id, email)
select id, email from auth.users where email is not null
on conflict do nothing;

alter table profiles enable row level security;
create policy profiles_select_own on profiles for select
  using (id = auth.uid());

-- Invite lookup: returns the user id for an email (exact, case-insensitive) or null.
-- Does not expose emails.
create function find_user_by_email(lookup text) returns uuid
language sql stable security definer set search_path = public as $$
  select p.id from profiles p where lower(p.email) = lower(trim(lookup)) limit 1;
$$;
revoke execute on function find_user_by_email(text) from public, anon;
grant execute on function find_user_by_email(text) to authenticated;

-- Members of a project with their emails; only visible to members of that project.
create function project_members(p uuid)
returns table (user_id uuid, role text, email text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_member(p, array['owner','editor','viewer']) then
    return;
  end if;
  return query
    select m.user_id, m.role, coalesce(pr.email, '')
    from members m left join profiles pr on pr.id = m.user_id
    where m.project_id = p
    order by case m.role when 'owner' then 0 when 'editor' then 1 else 2 end, pr.email;
end $$;
revoke execute on function project_members(uuid) from public, anon;
grant execute on function project_members(uuid) to authenticated;
