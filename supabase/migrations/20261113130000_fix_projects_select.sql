-- INSERT ... RETURNING evaluates the SELECT policy before the AFTER INSERT
-- trigger has added the owner's membership row, so the owner must be visible
-- by owner_id too, not only via members.
drop policy projects_select on projects;
create policy projects_select on projects for select
  using (owner_id = auth.uid() or is_member(id, array['owner','editor','viewer']));
