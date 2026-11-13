# WorldKeeper

A LegendKeeper-style worldbuilding app: pages in a tree, rich-text wiki with
@mentions and backlinks, image maps with pins and regions, and calendar-free
timelines. Everything is a page — no entity types, no required fields.

## Stack

- React + Vite + TypeScript
- TipTap (editor), Leaflet + Geoman (maps), custom timeline
- Supabase (Postgres + RLS, auth, storage) — local via Docker, cloud for prod

## Run locally

Requires Node 22+ (`nvm use 22`) and Docker.

```bash
npm install
npx supabase start          # local Postgres+auth+storage; prints keys
cp .env.example .env.local  # paste ANON_KEY printed by supabase start
npm run dev
```

- App: http://localhost:5173 — sign up with any email+password.
- Supabase Studio (DB browser): http://127.0.0.1:54323
- Emails (magic links) land in Mailpit: http://127.0.0.1:54324
- Stop the stack: `npx supabase stop`

Schema lives in `supabase/migrations/`; `supabase start` applies it automatically.

## Deploy for free

1. **Database/auth/storage:** create a free project at supabase.com, then
   `npx supabase link --project-ref <ref> && npx supabase db push` to apply
   the migrations. Create nothing by hand.
2. **Frontend:** push this repo to GitHub → Cloudflare Pages → "connect to
   git", build command `npm run build`, output `dist`, env vars
   `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` from the Supabase dashboard.

### Google sign-in setup

"Continue with Google" needs the Google provider enabled in Supabase:

1. In Google Cloud Console → APIs & Services → Credentials, create an OAuth
   client ID (type "Web application") and add the authorized redirect URI
   `https://<project-ref>.supabase.co/auth/v1/callback`.
2. In the Supabase dashboard → Authentication → Providers → Google, enable it
   and paste the client ID and secret.
3. In Authentication → URL Configuration, add your site URL (e.g. the
   Cloudflare Pages domain, plus `http://localhost:5173` for dev) to the
   redirect allow list — the app redirects back to `window.location.origin`.

## Architecture

See `CONTRACT.md` for internal boundaries. Short version:

- `src/lib/db.ts` is the only place that talks to Supabase tables.
- `src/features/editor|map|timeline` render a page by its `kind`.
- Secrets/roles are enforced by Postgres RLS, not client code.
