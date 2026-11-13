/**
 * Minimal inline SVG glyphs for editor blocks (callouts, secret blocks, slash menu).
 * Strings so they can be used both in plain-DOM node views and in React (via SvgGlyph).
 * Stroke in currentColor, sized 1em.
 */

const svg = (inner: string) =>
  `<svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="2" ` +
  `stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${inner}</svg>`

export const BLOCK_ICONS = {
  info: svg('<circle cx="12" cy="12" r="9"/><path d="M12 11v5"/><path d="M12 7.5h.01"/>'),
  success: svg('<circle cx="12" cy="12" r="9"/><path d="m8 12.5 2.5 2.5L16 9.5"/>'),
  warning: svg('<path d="M12 3.5 2.8 19.5h18.4Z"/><path d="M12 10v4"/><path d="M12 16.5h.01"/>'),
  danger: svg('<path d="M8.2 3h7.6L21 8.2v7.6L15.8 21H8.2L3 15.8V8.2Z"/><path d="m9.5 9.5 5 5"/><path d="m14.5 9.5-5 5"/>'),
  lock: svg('<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>'),
  divider: svg('<path d="M4 12h16"/>'),
} as const

export type BlockIconName = keyof typeof BLOCK_ICONS

/** Builds a span holding the glyph, for plain-DOM node views. */
export function glyphElement(name: BlockIconName, className: string): HTMLSpanElement {
  const el = document.createElement('span')
  el.className = className
  el.innerHTML = BLOCK_ICONS[name]
  return el
}
