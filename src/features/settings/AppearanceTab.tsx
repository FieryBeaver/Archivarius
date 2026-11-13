import { useEffect, useId, useMemo, useState, type CSSProperties } from 'react'
import * as db from '../../lib/db'
import type { ThemeOverrides } from '../../lib/types'
import type { SettingsContext } from './SettingsDialog'
import { ROLE_LABEL } from './roles'

type ThemeKey = keyof ThemeOverrides

const THEME_KEYS: ThemeKey[] = ['accent', 'accent2', 'bg', 'panel', 'panel2', 'border', 'text', 'muted']

/** ThemeOverrides key -> CSS custom property in src/index.css. */
const CSS_VAR: Record<ThemeKey, string> = {
  accent: '--accent',
  accent2: '--accent-2',
  bg: '--bg',
  panel: '--panel',
  panel2: '--panel-2',
  border: '--border',
  text: '--text',
  muted: '--muted',
}

/** Mirrors :root in src/index.css; replaced at runtime by the computed values when available. */
const FALLBACK_DEFAULTS: Required<ThemeOverrides> = {
  accent: '#d4a953',
  accent2: '#6fa8dc',
  bg: '#16181d',
  panel: '#1d2026',
  panel2: '#23262e',
  border: '#2e323b',
  text: '#e7e4dc',
  muted: '#9a958a',
}

const FIELD_LABEL: Record<ThemeKey, string> = {
  accent: 'Accent',
  accent2: 'Secondary accent',
  bg: 'Background',
  panel: 'Panel',
  panel2: 'Raised panel',
  border: 'Border',
  text: 'Text',
  muted: 'Muted text',
}

const FIELD_HINT: Record<ThemeKey, string> = {
  accent: 'Buttons, highlights, active items',
  accent2: 'Links and secondary highlights',
  bg: 'Page background',
  panel: 'Cards and panels',
  panel2: 'Hovered and raised surfaces',
  border: 'Dividers and outlines',
  text: 'Body text',
  muted: 'Labels and hints',
}

interface Preset {
  id: string
  name: string
  blurb: string
  /** null = stylesheet defaults. */
  theme: ThemeOverrides | null
}

const PRESETS: Preset[] = [
  { id: 'gold', name: 'Archivist Gold', blurb: 'Gilt on lamplit slate', theme: null },
  { id: 'arcane', name: 'Arcane', blurb: 'Amethyst and rose', theme: { accent: '#b28cf2', accent2: '#e08cc4' } },
  { id: 'verdant', name: 'Verdant', blurb: 'Moss and wheat', theme: { accent: '#7fbf7a', accent2: '#d4b26a' } },
  { id: 'crimson', name: 'Crimson', blurb: 'Ember and brass', theme: { accent: '#e0675d', accent2: '#e8b25a' } },
  { id: 'frost', name: 'Frost', blurb: 'Glacier and twilight', theme: { accent: '#7cc4e8', accent2: '#a7b4f5' } },
  {
    id: 'parchment',
    name: 'Parchment',
    blurb: 'Ink on aged vellum',
    theme: {
      accent: '#8a5410',
      accent2: '#2d5c86',
      bg: '#efe6d2',
      panel: '#f7f0e0',
      panel2: '#e7dbc1',
      border: '#cbb995',
      text: '#2a2117',
      muted: '#6a5a43',
    },
  },
]

// ---------- helpers ----------

/** Drops empty / unknown keys so unset overrides are absent, never ''. */
function normalize(theme: ThemeOverrides | null | undefined): ThemeOverrides {
  const out: ThemeOverrides = {}
  if (!theme) return out
  for (const k of THEME_KEYS) {
    const v = theme[k]
    if (typeof v === 'string' && v.trim()) out[k] = v.trim()
  }
  return out
}

function sameTheme(a: ThemeOverrides | null | undefined, b: ThemeOverrides | null | undefined): boolean {
  const x = normalize(a)
  const y = normalize(b)
  return THEME_KEYS.every((k) => (x[k] ?? '').toLowerCase() === (y[k] ?? '').toLowerCase())
}

function isEmpty(theme: ThemeOverrides): boolean {
  return THEME_KEYS.every((k) => theme[k] === undefined)
}

function isValidColor(v: string): boolean {
  const s = v.trim()
  if (!s) return false
  if (typeof CSS !== 'undefined' && typeof CSS.supports === 'function') return CSS.supports('color', s)
  return /^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(s)
}

/** Best-effort #rrggbb for <input type="color">, which accepts nothing else. */
function toHex6(v: string, fallback: string): string {
  const s = v.trim()
  if (/^#[0-9a-f]{6}$/i.test(s)) return s.toLowerCase()
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(s)
  if (short) return ('#' + short[1] + short[1] + short[2] + short[2] + short[3] + short[3]).toLowerCase()
  const rgb = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/i.exec(s)
  if (rgb) return '#' + rgb.slice(1, 4).map((n) => Math.min(255, +n).toString(16).padStart(2, '0')).join('')
  return fallback === s ? '#000000' : toHex6(fallback, '#000000')
}

function readDefaults(): Required<ThemeOverrides> {
  if (typeof window === 'undefined') return FALLBACK_DEFAULTS
  const cs = window.getComputedStyle(document.documentElement)
  const out = { ...FALLBACK_DEFAULTS }
  for (const k of THEME_KEYS) {
    const v = cs.getPropertyValue(CSS_VAR[k]).trim()
    if (v && /^(#|rgb)/i.test(v)) out[k] = v
  }
  return out
}

function themeVars(theme: ThemeOverrides): CSSProperties {
  const style: Record<string, string> = {}
  for (const k of THEME_KEYS) {
    const v = theme[k]
    if (v) style[CSS_VAR[k]] = v
  }
  return style as CSSProperties
}

// ---------- component ----------

export function AppearanceTab({ ctx }: { ctx: SettingsContext }) {
  const { project, theme, setTheme, role, roleLoading } = ctx
  const isOwner = role === 'owner'
  const defaults = useMemo(readDefaults, [])
  const saved = useMemo(() => normalize(theme), [theme])
  const [draft, setDraft] = useState<ThemeOverrides>(saved)
  const [saving, setSaving] = useState(false)
  const [justSaved, setJustSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [advancedOpen, setAdvancedOpen] = useState(
    () => !!(saved.bg || saved.panel || saved.panel2 || saved.border || saved.text || saved.muted),
  )

  useEffect(() => { setDraft(saved) }, [saved])

  useEffect(() => {
    if (!justSaved) return
    const t = window.setTimeout(() => setJustSaved(false), 1600)
    return () => window.clearTimeout(t)
  }, [justSaved])

  const dirty = !sameTheme(draft, saved)
  const activePreset = PRESETS.find((p) => sameTheme(p.theme, draft))
  const editable = isOwner && !saving

  const setKey = (key: ThemeKey, value: string | undefined) => {
    setError(null)
    setDraft((d) => {
      const next = { ...d }
      if (value === undefined || !value.trim()) delete next[key]
      else next[key] = value.trim()
      return next
    })
  }

  const persist = async (next: ThemeOverrides | null) => {
    if (saving) return
    const payload = next && !isEmpty(normalize(next)) ? normalize(next) : null
    setSaving(true)
    setError(null)
    try {
      const p = await db.updateProjectTheme(project.id, payload)
      setTheme(p.theme ?? null)
      setJustSaved(true)
    } catch (e) {
      setError((e as Error).message || 'Could not save the theme.')
    } finally {
      setSaving(false)
    }
  }

  const resolved: Required<ThemeOverrides> = { ...defaults, ...draft }

  return (
    <div className="wks-stack">
      {!roleLoading && !isOwner && (
        <p className="wks-hint wks-appearance-note">
          {role
            ? `You are ${/^[aeiou]/i.test(role) ? 'an' : 'a'} ${ROLE_LABEL[role].toLowerCase()} of this world. Only owners can change its appearance.`
            : 'Only owners can change this world’s appearance.'}
        </p>
      )}

      {/* ---------- presets ---------- */}
      <div className="wks-field">
        <div className="wks-row-between">
          <span className="wks-label" id="wks-presets-label">Palettes</span>
          <span className="wks-hint">{activePreset ? activePreset.name : 'Custom'}</span>
        </div>
        <div className="wks-swatches" role="radiogroup" aria-labelledby="wks-presets-label">
          {PRESETS.map((p) => {
            const pal: Required<ThemeOverrides> = { ...defaults, ...normalize(p.theme) }
            const selected = activePreset?.id === p.id
            return (
              <button
                key={p.id}
                type="button"
                role="radio"
                aria-checked={selected}
                className={'wks-swatch' + (selected ? ' selected' : '')}
                disabled={!editable}
                onClick={() => { setError(null); setDraft(normalize(p.theme)) }}
              >
                <span
                  className="wks-swatch-scene"
                  aria-hidden="true"
                  style={{ background: pal.bg, borderColor: pal.border }}
                >
                  <span className="wks-swatch-card" style={{ background: pal.panel, borderColor: pal.border }}>
                    <span className="wks-swatch-line" style={{ background: pal.text, width: '70%' }} />
                    <span className="wks-swatch-line" style={{ background: pal.muted, width: '45%' }} />
                    <span className="wks-swatch-dots">
                      <span style={{ background: pal.accent }} />
                      <span style={{ background: pal.accent2 }} />
                    </span>
                  </span>
                  <span className="wks-swatch-bar" style={{ background: pal.accent }} />
                </span>
                <span className="wks-swatch-meta">
                  <span className="wks-swatch-name">
                    {p.name}
                    {p.theme === null && <span className="wks-swatch-tag">Default</span>}
                  </span>
                  <span className="wks-swatch-blurb">{p.blurb}</span>
                </span>
              </button>
            )
          })}
        </div>
      </div>

      {/* ---------- custom ---------- */}
      <div className="wks-field">
        <span className="wks-label">Custom</span>
        <div className="wks-color-list">
          {(['accent', 'accent2'] as ThemeKey[]).map((k) => (
            <ColorRow key={k} k={k} value={draft[k]} fallback={defaults[k]} disabled={!editable} onChange={setKey} />
          ))}
        </div>
        <button
          type="button"
          className="btn-ghost wks-btn wks-disclosure"
          aria-expanded={advancedOpen}
          onClick={() => setAdvancedOpen((o) => !o)}
        >
          <span className={'wks-caret' + (advancedOpen ? ' open' : '')} aria-hidden="true">›</span>
          Advanced surfaces &amp; text
        </button>
        {advancedOpen && (
          <div className="wks-color-list">
            {(['bg', 'panel', 'panel2', 'border', 'text', 'muted'] as ThemeKey[]).map((k) => (
              <ColorRow key={k} k={k} value={draft[k]} fallback={defaults[k]} disabled={!editable} onChange={setKey} />
            ))}
          </div>
        )}
      </div>

      {/* ---------- preview ---------- */}
      <div className="wks-field">
        <span className="wks-label">Preview</span>
        <div className="wks-preview" style={{ ...themeVars(defaults), ...themeVars(draft) }} aria-hidden="true">
          <div className="wks-preview-panel">
            <div className="wks-preview-eyebrow">Chronicle · Third Age</div>
            <div className="wks-preview-title">The Sunken Archive</div>
            <p className="wks-preview-body">
              Beneath the tide-worn cliffs of <span className="wks-preview-link">Vel Amar</span>, the
              archivists kept their ledgers sealed in brass and wax.
            </p>
            <div className="wks-preview-row">
              <span className="wks-preview-btn">Open entry</span>
              <span className="wks-preview-chip">Location</span>
              <span className="wks-preview-muted">Edited 2 days ago</span>
            </div>
          </div>
        </div>
        {(resolved.bg !== defaults.bg || resolved.panel !== defaults.panel) && (
          <span className="wks-hint">Surface colors also apply to the sidebar and pages of this world.</span>
        )}
      </div>

      {/* ---------- actions ---------- */}
      {isOwner && (
        <div className="wks-stack-sm">
          {error && <p className="wks-error" role="alert">{error}</p>}
          <div className="wks-row-between">
            <span className="wks-hint" aria-live="polite">
              {saving ? 'Saving…' : justSaved ? 'Saved' : dirty ? 'Unsaved changes' : 'Applies to everyone in this world.'}
            </span>
            <div className="wks-actions">
              <button
                type="button"
                className="btn-ghost wks-btn"
                disabled={saving || (isEmpty(saved) && isEmpty(draft))}
                onClick={() => { setDraft({}); void persist(null) }}
                title="Save the default Archivist Gold theme"
              >
                Reset to default
              </button>
              <button
                type="button"
                className="btn-primary wks-btn"
                disabled={!dirty || saving}
                onClick={() => { void persist(draft) }}
              >
                {saving ? 'Saving…' : 'Save theme'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function ColorRow(props: {
  k: ThemeKey
  value: string | undefined
  fallback: string
  disabled: boolean
  onChange(key: ThemeKey, value: string | undefined): void
}) {
  const { k, value, fallback, disabled, onChange } = props
  const id = useId()
  const [text, setText] = useState(value ?? '')
  const [invalid, setInvalid] = useState(false)

  // Keep the text field in sync when the value changes from outside (preset, picker, clear).
  useEffect(() => {
    setText(value ?? '')
    setInvalid(false)
  }, [value])

  const effective = value ?? fallback
  const pickerValue = toHex6(effective, fallback)

  const commitText = (raw: string) => {
    const s = raw.trim()
    if (!s) { setInvalid(false); onChange(k, undefined); return }
    const candidate = /^[0-9a-f]{3}([0-9a-f]{3})?$/i.test(s) ? '#' + s : s
    if (isValidColor(candidate)) { setInvalid(false); onChange(k, candidate) }
    else setInvalid(true)
  }

  return (
    <div className={'wks-color-row' + (value ? ' set' : '')}>
      <label className="wks-color-swatch" style={{ background: effective }} title={`Pick ${FIELD_LABEL[k].toLowerCase()}`}>
        <input
          type="color"
          value={pickerValue}
          disabled={disabled}
          aria-label={`${FIELD_LABEL[k]} color picker`}
          onChange={(e) => onChange(k, e.target.value)}
        />
      </label>
      <div className="wks-color-meta">
        <label className="wks-color-name" htmlFor={id}>{FIELD_LABEL[k]}</label>
        <span className="wks-color-hint">{value ? FIELD_HINT[k] : `Default · ${FIELD_HINT[k].toLowerCase()}`}</span>
      </div>
      <input
        id={id}
        className={'wks-input wks-color-text' + (invalid ? ' invalid' : '')}
        value={text}
        placeholder={fallback}
        spellCheck={false}
        autoComplete="off"
        maxLength={64}
        disabled={disabled}
        aria-invalid={invalid}
        onChange={(e) => {
          setText(e.target.value)
          const s = e.target.value.trim()
          // Apply live as soon as it parses as-is; bare hex and empty are resolved on blur.
          if (s && isValidColor(s)) { setInvalid(false); onChange(k, s) }
        }}
        onBlur={(e) => commitText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); commitText(e.currentTarget.value) }
          else if (e.key === 'Escape') { e.preventDefault(); setText(value ?? ''); setInvalid(false) }
        }}
      />
      <button
        type="button"
        className="btn-ghost wks-icon-btn wks-color-clear"
        disabled={disabled || !value}
        aria-label={`Clear ${FIELD_LABEL[k].toLowerCase()} override`}
        title="Use default"
        onClick={() => onChange(k, undefined)}
      >
        ×
      </button>
    </div>
  )
}
