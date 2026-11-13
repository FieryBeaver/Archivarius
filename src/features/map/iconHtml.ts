/**
 * HTML-string rendering of the shared icon system, for Leaflet divIcons (which
 * take raw HTML, not React nodes). Game icons go through renderToStaticMarkup on
 * the curated component from src/lib/icons.tsx; emoji are escaped text.
 */
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { getIconComponent, isGameIcon } from '../../lib/icons'

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '"' ? '&quot;' : '&#39;',
  )
}

/** Only accept values the browser parses as a color (user data goes into inline styles). */
export function safeColor(c: string | null | undefined): string | null {
  if (!c) return null
  return typeof CSS !== 'undefined' && CSS.supports('color', c) ? c : null
}

const cache = new Map<string, string>()

/**
 * Icon string → HTML. `gi:` names render as an inline SVG (fill = currentColor,
 * so it inherits `color`, or the explicit `color` if given); emoji render as an
 * escaped text span; null / unknown gi: names render ''.
 */
export function iconHtml(icon: string | null, size: number, color?: string): string {
  if (!icon) return ''
  const col = color ? safeColor(color) ?? undefined : undefined
  const key = `${icon}|${size}|${col ?? ''}`
  const hit = cache.get(key)
  if (hit !== undefined) return hit
  let html = ''
  if (isGameIcon(icon)) {
    const Icon = getIconComponent(icon)
    if (Icon) {
      html = renderToStaticMarkup(
        createElement(Icon, {
          size,
          color: col ?? 'currentColor',
          'aria-hidden': true,
          focusable: 'false',
          style: { display: 'block', flexShrink: 0 },
        }),
      )
    }
  } else {
    const style = `font-size:${size}px;line-height:1${col ? `;color:${escapeHtml(col)}` : ''}`
    html = `<span class="wk-icon-emoji" style="${style}">${escapeHtml(icon)}</span>`
  }
  if (cache.size > 500) cache.clear()
  cache.set(key, html)
  return html
}

/**
 * Inner HTML of a pin teardrop — shared by the Leaflet divIcon and the live
 * preview in the edit popup so they always match.
 */
export function pinHtml(opts: {
  color: string | null
  icon: string | null
  linked?: boolean
  selected?: boolean
}): string {
  const color = safeColor(opts.color) ?? 'var(--accent)'
  const inner = iconHtml(opts.icon, 15)
  const glyph = inner
    ? `<span class="wk-pin__glyph">${inner}</span>`
    : '<span class="wk-pin__dot"></span>'
  const cls = `wk-pin${opts.selected ? ' is-selected' : ''}${opts.linked ? ' is-linked' : ''}`
  return `<div class="${cls}" style="--pin-color:${escapeHtml(color)}"><div class="wk-pin__head">${glyph}</div></div>`
}
