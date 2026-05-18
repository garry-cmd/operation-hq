/**
 * useIsMobile — viewport breakpoint hook for the desktop-first → mobile-fallback
 * patches added May 17, 2026. Returns true when window width is below `breakpoint`
 * (default 900px). Listens for resize and re-renders consumers.
 *
 * Design philosophy: Operation HQ is desktop-first. This hook exists to switch
 * surfaces into degraded mobile fallbacks (drawer NavRail, single-pane Tasks/
 * Notes, etc.) — not to drive sophisticated responsive design. If you find
 * yourself writing complex per-breakpoint logic, consider a CSS media query
 * instead and reserve the hook for "show the whole layout, or hide it" forks.
 *
 * Initial value is `false` so the first SSR render assumes desktop, then a
 * useEffect on mount corrects to the real viewport. This is intentional:
 * matches the existing "desktop default, mobile is the fallback" framing and
 * avoids hydration mismatches at the layout level (the hamburger appears
 * after hydration on mobile, which is a one-frame flicker users won't notice).
 */
'use client'

import { useEffect, useState } from 'react'

export function useIsMobile(breakpoint: number = 900): boolean {
  const [isMobile, setIsMobile] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined') return
    const check = () => setIsMobile(window.innerWidth < breakpoint)
    check()
    window.addEventListener('resize', check)
    return () => window.removeEventListener('resize', check)
  }, [breakpoint])

  return isMobile
}
