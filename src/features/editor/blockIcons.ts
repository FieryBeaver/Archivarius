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
  plugin: svg('<path d="M10 4h4v3a1.5 1.5 0 0 0 3 0V4h3v6h-3a1.5 1.5 0 0 0 0 3h3v7h-7v-3a1.5 1.5 0 0 0-3 0v3H4v-7h3a1.5 1.5 0 0 0 0-3H4V4h6Z"/>'),
  sliders: svg('<path d="M4 7h10"/><circle cx="17" cy="7" r="2.5"/><path d="M20 17H10"/><circle cx="7" cy="17" r="2.5"/>'),
  grip: svg('<circle cx="9" cy="5.5" r="1.3" fill="currentColor" stroke="none"/><circle cx="15" cy="5.5" r="1.3" fill="currentColor" stroke="none"/><circle cx="9" cy="12" r="1.3" fill="currentColor" stroke="none"/><circle cx="15" cy="12" r="1.3" fill="currentColor" stroke="none"/><circle cx="9" cy="18.5" r="1.3" fill="currentColor" stroke="none"/><circle cx="15" cy="18.5" r="1.3" fill="currentColor" stroke="none"/>'),
  eye: svg('<path d="M2.5 12S6 5.8 12 5.8 21.5 12 21.5 12 18 18.2 12 18.2 2.5 12 2.5 12Z"/><circle cx="12" cy="12" r="2.8"/>'),
  image: svg('<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><circle cx="9" cy="10" r="1.8"/><path d="m20.5 16-5-5-9 8.5"/>'),
  alignLeft: svg('<path d="M4 6h16"/><path d="M4 10h10"/><path d="M4 14h16"/><path d="M4 18h10"/>'),
  alignCenter: svg('<path d="M4 6h16"/><path d="M7 10h10"/><path d="M4 14h16"/><path d="M7 18h10"/>'),
  alignRight: svg('<path d="M4 6h16"/><path d="M10 10h10"/><path d="M4 14h16"/><path d="M10 18h10"/>'),
  expand: svg('<path d="M14 4h6v6"/><path d="M20 4l-7 7"/><path d="M10 20H4v-6"/><path d="M4 20l7-7"/>'),
  pagePlus: svg('<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z"/><path d="M14 3v5h5"/><path d="M12 11v6"/><path d="M9 14h6"/>'),
  link: svg('<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>'),
  upload: svg('<path d="M12 15V4"/><path d="m7.5 8.5 4.5-4.5 4.5 4.5"/><path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"/>'),
  eyeOff: svg('<path d="M2.5 12S6 5.8 12 5.8 21.5 12 21.5 12 18 18.2 12 18.2 2.5 12 2.5 12Z"/><circle cx="12" cy="12" r="2.8"/><path d="M4 20 20 4"/>'),
} as const

export type BlockIconName = keyof typeof BLOCK_ICONS

/** Builds a span holding the glyph, for plain-DOM node views. */
export function glyphElement(name: BlockIconName, className: string): HTMLSpanElement {
  const el = document.createElement('span')
  el.className = className
  el.innerHTML = BLOCK_ICONS[name]
  return el
}
