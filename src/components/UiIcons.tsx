/** Tiny UI chrome glyphs (stroke, currentColor). Content icons go through src/lib/icons. */
import type { ReactNode } from 'react'

function Svg({ children }: { children: ReactNode }) {
  return (
    <svg width="1em" height="1em" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  )
}

export const SearchGlyph = () => (
  <Svg><circle cx="7" cy="7" r="4.5" /><path d="M10.5 10.5 14 14" /></Svg>
)

export const GearGlyph = () => (
  <Svg>
    <circle cx="8" cy="8" r="2.2" />
    <path d="M8 1.5v1.8M8 12.7v1.8M1.5 8h1.8M12.7 8h1.8M3.4 3.4l1.3 1.3M11.3 11.3l1.3 1.3M3.4 12.6l1.3-1.3M11.3 4.7l1.3-1.3" />
  </Svg>
)

/** Sidebar panel toggle: a framed pane with its left column marked. */
export const SidebarGlyph = () => (
  <Svg><rect x="2" y="2.5" width="12" height="11" rx="1.8" /><path d="M6 2.5v11" /></Svg>
)

/** Shield: a page restricted to chosen editors. */
export const ShieldGlyph = () => (
  <Svg><path d="M8 1.8 13 3.6v4.1c0 3-2.1 5.4-5 6.5-2.9-1.1-5-3.5-5-6.5V3.6Z" /></Svg>
)

export const CloseGlyph = () => (
  <Svg><path d="M4 4l8 8M12 4l-8 8" /></Svg>
)

/** Eye: preview the world as a lower role ("view as player"). */
export const EyeGlyph = () => (
  <Svg><path d="M1.8 8s2.3-4.2 6.2-4.2S14.2 8 14.2 8s-2.3 4.2-6.2 4.2S1.8 8 1.8 8Z" /><circle cx="8" cy="8" r="1.9" /></Svg>
)
