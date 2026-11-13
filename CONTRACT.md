# WorldKeeper — internal contracts (for all contributors/agents)

Philosophy: LegendKeeper-minimal. Everything is a page in a tree. No entity
types, no required fields. Three-pane UI: tree | content | context panel.

## Fixed files — do not modify, code against them
- `src/lib/types.ts` — row types (Page, Pin, Region, WorldEvent, …)
- `src/lib/db.ts` — all data access. Never call supabase directly in features.
- `src/lib/supabase.ts` — client singleton.
- `src/index.css` — theme tokens. Use `var(--bg|--panel|--panel-2|--border|--text|--muted|--accent|--accent-2|--danger|--radius)`. Never hardcode colors.
- `supabase/migrations/*` — schema. Do not edit.
- `package.json` — do not add dependencies. Available: react, react-dom,
  react-router-dom, zustand, @supabase/supabase-js, @tiptap/react,
  @tiptap/starter-kit, @tiptap/extension-mention, @tiptap/suggestion,
  leaflet, react-leaflet, @geoman-io/leaflet-geoman-free,
  @dnd-kit/core, @dnd-kit/sortable.

## Ownership boundaries
- **Core** owns: `src/main.tsx`, `src/App.tsx`, `src/components/**`,
  `src/features/editor/**`, `src/state/**`, `src/App.css`.
- **Maps** owns: `src/features/map/**` only.
- **Timeline** owns: `src/features/timeline/**` only.

## Feature component contracts
Core renders the center pane by `page.kind`:

```tsx
// src/features/map/MapView.tsx
export default function MapView(props: { page: Page; canEdit: boolean }): JSX.Element

// src/features/timeline/TimelineView.tsx
export default function TimelineView(props: { page: Page; canEdit: boolean }): JSX.Element
```

- Navigate to another page with `useNavigate()` → `/project/${page.project_id}/page/${pageId}`.
- Features fetch their own data (pins/regions/events) via `db.ts` using `props.page.id`.
- Coordinates: pins/regions store map **image pixel** coords (x right, y down,
  origin top-left). Leaflet CRS.Simple: lat = -y, lng = x (or use bounds mapping);
  conversion is internal to the map feature, DB stores pixels.
- TipTap mention nodes must serialize as `{ type: 'mention', attrs: { id: <pageId>, label: <title> } }`
  so mention extraction works uniformly.

## Routes (owned by core)
- `/` — project list / create
- `/project/:projectId` — project home (tree, no page selected)
- `/project/:projectId/page/:pageId` — page view
- Auth gate wraps everything; unauthenticated → login screen (magic link + password fallback for local dev).
