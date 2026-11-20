-- v0.11: live updates.
--
-- 1. Publish the world tables to Supabase Realtime (postgres_changes). Realtime
--    checks each change against the subscriber's RLS (SELECT policies, run with
--    their JWT), so INSERT/UPDATE events only reach users who can read the row.
--    DELETE events can't be RLS-checked or filtered (the old row only carries the
--    primary key under the default replica identity), so filtered subscriptions
--    simply don't receive them; clients learn about deletes from the broadcast
--    channel below. Default replica identity is kept on purpose (no row data in
--    DELETE payloads).
-- 2. Authorize the private broadcast channel `project:<uuid>`: clients announce
--    their successful writes there ({kind, ids, from}), which also covers rows
--    that just became INVISIBLE to someone (no postgres_changes event reaches
--    them for those). Only members of that project may join, receive or send.

do $$
declare
  t text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
  foreach t in array array['pages', 'pins', 'regions', 'events', 'page_editors', 'plugins', 'members', 'project_roles']
  loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- 'project:<uuid>' -> uuid; null for any other / malformed topic (never raises).
create or replace function public.realtime_topic_project(topic text)
returns uuid
language sql
immutable
set search_path = public
as $$
  select case
    when topic ~* '^project:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then substring(topic from 9)::uuid
  end;
$$;

grant execute on function public.realtime_topic_project(text) to authenticated;

-- Receive (and join): project members only, broadcast messages only.
drop policy if exists "project members receive broadcasts" on realtime.messages;
create policy "project members receive broadcasts"
  on realtime.messages
  for select
  to authenticated
  using (
    realtime.messages.extension = 'broadcast'
    and public.is_member(public.realtime_topic_project(realtime.topic()), array['owner', 'editor', 'viewer'])
  );

-- Send: project members only, broadcast messages only.
drop policy if exists "project members send broadcasts" on realtime.messages;
create policy "project members send broadcasts"
  on realtime.messages
  for insert
  to authenticated
  with check (
    realtime.messages.extension = 'broadcast'
    and public.is_member(public.realtime_topic_project(realtime.topic()), array['owner', 'editor', 'viewer'])
  );
