# WorldKeeper — infrastructure & operations

Everything an agent or developer needs to build, run, and deploy this app.
Code-level contracts (file ownership, icon format, component props) live in
`CONTRACT.md`; product plan and history in `../PLAN.md`.

## The stack at a glance

| Piece | What | Where |
|---|---|---|
| Frontend | React 19 + Vite + TypeScript SPA | this repo, `src/` |
| Backend | Supabase (Postgres + RLS, Auth, Storage) | cloud project + local Docker |
| Hosting | Cloudflare Pages, git-connected, auto-deploys `main` | https://archivarius.pages.dev |
| Repo | GitHub `FieryBeaver/Archivarius` (SSH remote) | git@github.com:FieryBeaver/Archivarius.git |

There is **no custom server**. The SPA talks straight to Supabase with the
publishable (anon) key; all authorization is Postgres RLS. All data access
goes through `src/lib/db.ts` — never call supabase-js directly in features.

## Local development

**Node 22 is required** (system node is v18 and breaks Vite 7). Prefix every
npm/npx command with:

```sh
export PATH="$HOME/.nvm/versions/node/v22.21.0/bin:$PATH"
```

```sh
npx supabase start        # local Supabase stack in Docker (API on :54321)
npm install
npx vite --port 5173      # dev server
npx tsc -b --force && npx vite build   # the CI-equivalent check; run before pushing
```

- `.env.local` (gitignored) points at the local stack: `VITE_SUPABASE_URL=http://127.0.0.1:54321` plus the standard local demo anon key. `.env.example` documents both local and cloud setups.
- Local test login: see the comment in `.env.example` (local stack only).
- Migrations live in `supabase/migrations/`. Apply locally with `npx supabase db reset` (or `migration up`); apply to **cloud** by pasting the SQL into the Supabase dashboard SQL editor (we never stored the cloud DB password). **Every migration must be applied to BOTH databases.**

## Supabase (cloud)

- Project ref: `ywodjlgrgegsqtlnzqzb` — https://ywodjlgrgegsqtlnzqzb.supabase.co (West EU / Paris), dashboard account: herasym3@gmail.com.
- Publishable key `sb_publishable_6FbKCM4AJLbAllB4e130Rw_0QPjjjfn` (public by design; also in Cloudflare env vars).
- Auth: email+password and magic link enabled. Site URL `https://archivarius.pages.dev`; redirect allow-list also has `http://localhost:5173`. **Google provider not yet configured** — the app's "Continue with Google" button exists but errors until the OAuth client is created in Google Cloud Console and enabled in Supabase (redirect URI: `https://ywodjlgrgegsqtlnzqzb.supabase.co/auth/v1/callback`).
- Storage: single public-read bucket `maps` (map images); uploads via `db.ts`.
- Free tier pauses the project after ~1 week of inactivity — if the live site errors on fetch, un-pause it in the dashboard.

### Database model (summary)

`projects` → `members` (user_id, role owner/editor/viewer) → `pages` (tree;
kind `doc|map|timeline`; `is_secret` = DM-only; `content` jsonb TipTap doc;
map fields) → `pins`, `regions`, `events`, `mentions`. `profiles` mirrors
auth.users emails for invite-by-email.

RLS patterns to respect when writing migrations:
- `is_member(project_id, roles[])` — security-definer helper used by most policies. Avoid referencing `members` directly inside a `members` policy (infinite recursion) — use a security-definer function (see `has_other_owner`).
- A SELECT policy must cover rows you `INSERT .. RETURNING` (the owner-membership trigger runs AFTER insert, so `projects_select` also allows `owner_id = auth.uid()`).
- RPCs that cross RLS (`find_user_by_email`, `project_members`, `has_other_owner`) are `security definer` with `revoke from public, anon; grant to authenticated`.
- Secret pages are filtered **in RLS** (hard boundary). Secret *blocks* inside docs are client-side only (soft).

### Admin model

No global admin. Per-world roles in `members`; creator becomes owner via
trigger. Instance admin = whoever holds the Supabase dashboard login.

## Cloudflare Pages

- Account `5dd34201b86b67ddeb651d6c3d19a02a` (herasym3@gmail.com), project **archivarius**, production domain **https://archivarius.pages.dev**.
- Git-connected: every push to `main` builds `npm clean-install` → `npm run build`, output `dist/`.
- Env vars: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `NODE_VERSION=22`.
- SPA routing: `public/_redirects` serves `index.html` for all paths.

### ⚠ The recurring lockfile trap

Cloudflare installs with **npm 10.9.9** running `npm ci`, which validates the
whole dependency tree including optional platform packages. Local npm 11
writes lockfiles that **omit** some optional-dependency entries (e.g.
`@emnapi/core@2.0.0-beta.2`, needed by `@rolldown/binding-wasm32-wasi`), so
the deploy fails with `npm ci can only install packages when your package.json
and package-lock.json are in sync`. This has broken deploys three times.

**Rule: whenever `package.json` or `package-lock.json` changes, regenerate and
verify the lockfile with Cloudflare's npm before pushing:**

```sh
rm -rf node_modules package-lock.json
npx -y npm@10.9.9 install
npx -y npm@10.9.9 ci --dry-run   # must exit 0
```

(If Cloudflare ever bumps its npm, match whatever version its build log
prints on the "Installing project dependencies" line.)

### Checking a deploy

Deployments tab in the Cloudflare dashboard, or compare the bundle hash:
`curl -s https://archivarius.pages.dev/ | grep -o 'assets/index-[^"]*.js'` —
if it doesn't change a few minutes after a push, the build failed; read the
build log in the dashboard and fix, a new push retriggers automatically.

## Accounts & secrets policy

- Infra accounts (GitHub FieryBeaver, Cloudflare, Supabase, Google Cloud) are under **herasym3@gmail.com**; the user signs in themselves — agents never type passwords, 2FA codes, or client secrets.
- No secrets in the repo: only the publishable Supabase key is public. `.env.local` is gitignored. Cloud DB password was generated inside Supabase and never recorded.
- `kanka-reference/` (outside this repo) is AGPL+Commons-Clause — read-only inspiration, **never copy code from it**.

## Git conventions

- Remote is SSH (`~/.ssh/id_rsa` authenticates as FieryBeaver); `gh` CLI is not installed.
- Plain commit messages, no AI attribution lines (user's global rule).
- Single branch `main`; a push = a production deploy, so always run the build check first.
