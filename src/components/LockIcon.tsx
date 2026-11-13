/** Small padlock glyph in currentColor, used wherever a page is marked secret. */
export default function LockIcon({ open = false, size, className }: { open?: boolean; size?: number; className?: string }) {
  return (
    <svg className={className} width={size ?? '1em'} height={size ?? '1em'} viewBox="0 0 16 16"
      fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"
      aria-hidden="true" style={{ verticalAlign: '-0.125em', flexShrink: 0 }}>
      <rect x="3" y="7" width="10" height="7" rx="1.5" />
      <path d={open ? 'M5.5 7V5a2.5 2.5 0 0 1 4.9-.7' : 'M5.5 7V5a2.5 2.5 0 0 1 5 0v2'} />
    </svg>
  )
}
