-- v0.7: page templates. A snapshot of a doc page's icon/content/tabs that new
-- pages can be created from (copied, never linked). Members read them;
-- owners and editors manage them.

create table page_templates (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  name text not null,
  icon text,
  kind text not null default 'doc' check (kind in ('doc','map','timeline')),
  content jsonb,
  tabs jsonb,
  created_at timestamptz not null default now()
);
create index page_templates_project_idx on page_templates(project_id);

alter table page_templates enable row level security;
create policy page_templates_select on page_templates for select
  using (is_member(project_id, array['owner','editor','viewer']));
create policy page_templates_insert on page_templates for insert
  with check (is_member(project_id, array['owner','editor']));
create policy page_templates_update on page_templates for update
  using (is_member(project_id, array['owner','editor']));
create policy page_templates_delete on page_templates for delete
  using (is_member(project_id, array['owner','editor']));
