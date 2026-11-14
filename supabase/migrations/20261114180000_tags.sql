-- v0.7: page tags. Stored on the page row, so visibility and write rules are
-- exactly the page's own (tags of a secret page are as private as the page).

alter table pages add column tags text[] not null default '{}';
