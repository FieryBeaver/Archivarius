import { useCallback, useSyncExternalStore } from 'react'

/** Phone/tablet-portrait layout. Keep in sync with the `max-width: 768px` CSS breakpoint. */
export const MOBILE_QUERY = '(max-width: 768px)'

/** Live boolean for a CSS media query. Only for behavior that CSS alone can't change. */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (notify: () => void) => {
      const mql = window.matchMedia(query)
      mql.addEventListener('change', notify)
      return () => mql.removeEventListener('change', notify)
    },
    [query],
  )
  return useSyncExternalStore(subscribe, () => window.matchMedia(query).matches, () => false)
}

export const useIsMobile = () => useMediaQuery(MOBILE_QUERY)
