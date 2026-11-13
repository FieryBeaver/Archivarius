-- WorldKeeper initial schema
create extension if not exists pgcrypto;

create table projects (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  owner_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table members (
  project_id uuid not null references projects(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner','editor','viewer')),
  primary key (project_id, user_id)
);

create table pages (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  parent_id uuid references pages(id) on delete cascade,
  position double precision not null default 0,
  title text not null default 'Untitled',
  icon text,
  kind text not null default 'doc' check (kind in ('doc','map','timeline')),
  is_secret boolean not null default false,
  content jsonb,
  map_image_path text,
  map_w integer,
  map_h integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index pages_project_idx on pages(project_id);
create index pages_parent_idx on pages(parent_id);

create table mentions (
  from_page_id uuid not null references pages(id) on delete cascade,
  to_page_id uuid not null references pages(id) on delete cascade,
  primary key (from_page_id, to_page_id)
);
create index mentions_to_idx on mentions(to_page_id);

create table pins (
  id uuid primary key default gen_random_uuid(),
  map_page_id uuid not null references pages(id) on delete cascade,
  x double precision not null,
  y double precision not null,
  target_page_id uuid references pages(id) on delete set null,
  label text,
  color text,
  icon text
);
create index pins_map_idx on pins(map_page_id);

create table regions (
  id uuid primary key default gen_random_uuid(),
  map_page_id uuid not null references pages(id) on delete cascade,
  points jsonb not null,
  target_page_id uuid references pages(id) on delete set null,
  label text,
  color text,
  opacity double precision not null default 0.3
);
create index regions_map_idx on regions(map_page_id);

create table events (
  id uuid primary key default gen_random_uuid(),
  timeline_page_id uuid not null references pages(id) on delete cascade,
  position double precision not null default 0,
  sort_key double precision not null default 0,
  display_date text not null default '',
  era text,
  title text not null default '',
  content jsonb,
  target_page_id uuid references pages(id) on delete set null
);
create index events_timeline_idx on events(timeline_page_id);

-- membership helper (security definer so policies can use it without recursion)
create function is_member(p uuid, roles text[])
returns boolean language sql stable security definer set search_path = public as $$
  select exists(
    select 1 from members m
    where m.project_id = p and m.user_id = auth.uid() and m.role = any(roles)
  );
$$;

-- auto-add owner as member
create function handle_new_project() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into members(project_id, user_id, role) values (new.id, new.owner_id, 'owner');
  return new;
end $$;
create trigger on_project_created after insert on projects
for each row execute function handle_new_project();

-- updated_at maintenance
create function touch_updated_at() returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;
create trigger pages_touch before update on pages
for each row execute function touch_updated_at();

-- RLS
alter table projects enable row level security;
alter table members enable row level security;
alter table pages enable row level security;
alter table mentions enable row level security;
alter table pins enable row level security;
alter table regions enable row level security;
alter table events enable row level security;

create policy projects_select on projects for select
  using (is_member(id, array['owner','editor','viewer']));
create policy projects_insert on projects for insert
  with check (owner_id = auth.uid());
create policy projects_update on projects for update
  using (is_member(id, array['owner']));
create policy projects_delete on projects for delete
  using (is_member(id, array['owner']));

create policy members_select on members for select
  using (is_member(project_id, array['owner','editor','viewer']));
create policy members_write on members for all
  using (is_member(project_id, array['owner']))
  with check (is_member(project_id, array['owner']));

create policy pages_select on pages for select
  using (
    is_member(project_id, array['owner','editor','viewer'])
    and (not is_secret or is_member(project_id, array['owner','editor']))
  );
create policy pages_write on pages for all
  using (is_member(project_id, array['owner','editor']))
  with check (is_member(project_id, array['owner','editor']));

-- children follow their page's project
create policy mentions_select on mentions for select using (
  exists(select 1 from pages pg where pg.id = from_page_id
         and is_member(pg.project_id, array['owner','editor','viewer'])));
create policy mentions_write on mentions for all using (
  exists(select 1 from pages pg where pg.id = from_page_id
         and is_member(pg.project_id, array['owner','editor'])))
  with check (
  exists(select 1 from pages pg where pg.id = from_page_id
         and is_member(pg.project_id, array['owner','editor'])));

create policy pins_select on pins for select using (
  exists(select 1 from pages pg where pg.id = map_page_id
         and is_member(pg.project_id, array['owner','editor','viewer'])));
create policy pins_write on pins for all using (
  exists(select 1 from pages pg where pg.id = map_page_id
         and is_member(pg.project_id, array['owner','editor'])))
  with check (
  exists(select 1 from pages pg where pg.id = map_page_id
         and is_member(pg.project_id, array['owner','editor'])));

create policy regions_select on regions for select using (
  exists(select 1 from pages pg where pg.id = map_page_id
         and is_member(pg.project_id, array['owner','editor','viewer'])));
create policy regions_write on regions for all using (
  exists(select 1 from pages pg where pg.id = map_page_id
         and is_member(pg.project_id, array['owner','editor'])))
  with check (
  exists(select 1 from pages pg where pg.id = map_page_id
         and is_member(pg.project_id, array['owner','editor'])));

create policy events_select on events for select using (
  exists(select 1 from pages pg where pg.id = timeline_page_id
         and is_member(pg.project_id, array['owner','editor','viewer'])));
create policy events_write on events for all using (
  exists(select 1 from pages pg where pg.id = timeline_page_id
         and is_member(pg.project_id, array['owner','editor'])))
  with check (
  exists(select 1 from pages pg where pg.id = timeline_page_id
         and is_member(pg.project_id, array['owner','editor'])));

-- storage bucket for map images (public read, authenticated write)
insert into storage.buckets (id, name, public) values ('maps', 'maps', true);
create policy maps_upload on storage.objects for insert to authenticated
  with check (bucket_id = 'maps');
create policy maps_update on storage.objects for update to authenticated
  using (bucket_id = 'maps');
create policy maps_delete on storage.objects for delete to authenticated
  using (bucket_id = 'maps');
