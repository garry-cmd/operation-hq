'use client'
/**
 * NavRail — desktop-first left navigation. Replaces the previous fixed
 * top bar + fixed bottom-nav combo. The full app vertically scrolls within
 * a 240px-wide rail that anchors space switching, search, screen routing,
 * and the user/settings footer.
 *
 * Screens are organized into three groups by use frequency:
 *   - Daily:     Focus, Tasks, Notes   (the many-times-a-day tools)
 *   - Strategic: OKRs, Roadmap         (planning / weekly cadence)
 *   - Archive:   Reflect, Parking      (consulted, not daily)
 *
 * Mobile fallback is deliberately not implemented yet — the brief is
 * desktop-first. A hamburger / icon-only collapsed mode is a follow-on.
 */
import { useEffect, useRef, useState } from 'react'
import SpaceSwitcher from './SpaceSwitcher'
import { Space, AnnualObjective, RoadmapItem } from '@/lib/types'

export type Screen = 'focus' | 'tasks' | 'notes' | 'okr' | 'roadmap' | 'reflect' | 'park'

export interface SearchResult { label: string; sub: string; screen: Screen }

interface Props {
  screen: Screen
  isAllSpaces: boolean
  onScreenChange: (s: Screen) => void

  // Space switching — passed through to SpaceSwitcher unchanged.
  spaces: Space[]
  activeSpaceId: string
  objectives: AnnualObjective[]
  roadmapItems: RoadmapItem[]
  onSpaceSelect: (id: string) => void
  onSpaceCreated: (s: Space) => void
  onSpaceUpdated: (s: Space) => void

  // Badges on nav rows. All optional / zero-friendly.
  focusOpenCount?: number
  tasksOverdueCount?: number
  parkedCount?: number
  reviewsCount?: number

  // Search — query and results are computed in page.tsx (it owns the
  // searchable data); the rail just renders the input and the result list.
  searchQuery: string
  setSearchQuery: (q: string) => void
  searchResults: SearchResult[]

  // Footer / user menu.
  initials: string
  email: string
  theme: 'light' | 'dark'
  onToggleTheme: () => void
  onCopyShareLink: () => void
  onSignOut: () => void
}

const NAV_GROUPS: { label: string; items: { id: Screen; label: string; icon: React.ReactNode }[] }[] = [
  {
    label: 'Daily',
    items: [
      { id: 'focus', label: 'Focus', icon: <FocusIcon /> },
      { id: 'tasks', label: 'Tasks', icon: <TasksIcon /> },
      { id: 'notes', label: 'Notes', icon: <NotesIcon /> },
    ],
  },
  {
    label: 'Strategic',
    items: [
      { id: 'okr', label: 'OKRs', icon: <OKRIcon /> },
      { id: 'roadmap', label: 'Roadmap', icon: <RoadmapIcon /> },
    ],
  },
  {
    label: 'Archive',
    items: [
      { id: 'reflect', label: 'Reflect', icon: <ReflectIcon /> },
      { id: 'park', label: 'Parking', icon: <ParkIcon /> },
    ],
  },
]

export default function NavRail(props: Props) {
  const searchRef = useRef<HTMLInputElement>(null)
  const avatarRef = useRef<HTMLDivElement>(null)
  const [avatarOpen, setAvatarOpen] = useState(false)
  const [searchFocused, setSearchFocused] = useState(false)

  // Global Cmd/Ctrl+K → focus the search input. Doesn't fire when the user
  // is already typing into another input (so it doesn't fight normal text
  // entry inside the app).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        const target = e.target as HTMLElement | null
        const inField = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
        if (inField) return
        e.preventDefault()
        searchRef.current?.focus()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  // Close avatar menu on outside click — mirrors the old top-bar behavior.
  useEffect(() => {
    if (!avatarOpen) return
    function onClick(e: MouseEvent) {
      if (avatarRef.current && !avatarRef.current.contains(e.target as Node)) setAvatarOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [avatarOpen])

  function badge(id: Screen): number | undefined {
    if (id === 'focus') return props.focusOpenCount
    if (id === 'tasks') return props.tasksOverdueCount
    if (id === 'park') return props.parkedCount
    if (id === 'reflect') return props.reviewsCount
    return undefined
  }

  return (
    <aside style={{
      width: 240, flexShrink: 0,
      background: 'var(--navy-700)',
      borderRight: '1px solid var(--navy-600)',
      display: 'flex', flexDirection: 'column',
      position: 'sticky', top: 0, height: '100vh',
      zIndex: 30,
    }}>
      {/* Top: brand + space switcher + search */}
      <div style={{ padding: '16px 14px 12px' }}>
        <div style={{
          fontSize: 12, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '1.5px',
          color: 'var(--navy-50)', marginBottom: 12, paddingLeft: 4,
        }}>
          Operation <span style={{ color: 'var(--accent)' }}>HQ</span>
        </div>

        {props.spaces.length > 0 && (
          <div style={{ marginBottom: 10 }}>
            <SpaceSwitcher
              spaces={props.spaces}
              activeSpaceId={props.activeSpaceId}
              objectives={props.objectives}
              roadmapItems={props.roadmapItems}
              onSelect={props.onSpaceSelect}
              onSpaceCreated={props.onSpaceCreated}
              onSpaceUpdated={props.onSpaceUpdated}
            />
          </div>
        )}

        {/* Search */}
        <div style={{ position: 'relative' }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 7,
            background: 'var(--navy-800)',
            border: `1px solid ${searchFocused ? 'var(--accent)' : 'var(--navy-500)'}`,
            borderRadius: 8, padding: '6px 10px',
            transition: 'border-color .15s',
          }}>
            <svg width="13" height="13" viewBox="0 0 13 13" fill="none" style={{ flexShrink: 0 }}>
              <circle cx="5.5" cy="5.5" r="4" stroke="var(--navy-400)" strokeWidth="1.4"/>
              <path d="M9 9l2.5 2.5" stroke="var(--navy-400)" strokeWidth="1.4" strokeLinecap="round"/>
            </svg>
            <input ref={searchRef}
              value={props.searchQuery}
              onChange={e => props.setSearchQuery(e.target.value)}
              onFocus={() => setSearchFocused(true)}
              onBlur={() => setTimeout(() => setSearchFocused(false), 150)}
              placeholder="Search…"
              style={{
                flex: 1, minWidth: 0, background: 'none', border: 'none', outline: 'none',
                fontSize: 12.5, color: 'var(--navy-100)', fontFamily: 'inherit',
              }} />
            {!props.searchQuery && (
              <kbd style={{
                fontSize: 10, padding: '1px 5px', background: 'var(--navy-700)',
                border: '1px solid var(--navy-500)', borderRadius: 3, color: 'var(--navy-400)',
                fontFamily: 'monospace', flexShrink: 0,
              }}>⌘K</kbd>
            )}
            {props.searchQuery && (
              <button onClick={() => props.setSearchQuery('')}
                style={{ color: 'var(--navy-400)', background: 'none', border: 'none', cursor: 'pointer', fontSize: 14, lineHeight: 1, padding: 0 }}>
                ×
              </button>
            )}
          </div>
          {searchFocused && props.searchResults.length > 0 && (
            <div style={{
              position: 'absolute', top: '100%', left: 0, right: 0, marginTop: 4,
              background: 'var(--navy-700)', border: '1px solid var(--navy-500)',
              borderRadius: 10, overflow: 'hidden', zIndex: 50, maxHeight: 320, overflowY: 'auto',
            }}>
              {props.searchResults.map((r, i) => (
                <button key={i}
                  onMouseDown={() => { props.onScreenChange(r.screen); props.setSearchQuery(''); setSearchFocused(false) }}
                  style={{
                    width: '100%', padding: '9px 12px', display: 'flex', flexDirection: 'column', gap: 2,
                    background: 'none', border: 'none', borderBottom: '1px solid var(--navy-600)',
                    cursor: 'pointer', textAlign: 'left',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'var(--navy-600)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'none')}>
                  <span style={{ fontSize: 12, color: 'var(--navy-50)', fontWeight: 500 }}>{r.label}</span>
                  <span style={{ fontSize: 10, color: 'var(--navy-400)' }}>{r.sub}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Nav groups */}
      <nav style={{ flex: 1, overflowY: 'auto', padding: '4px 0' }}>
        {NAV_GROUPS.map(group => (
          <div key={group.label}>
            <div style={{
              padding: '14px 18px 4px', fontSize: 10, fontWeight: 700, letterSpacing: '0.08em',
              textTransform: 'uppercase', color: 'var(--navy-300)',
            }}>
              {group.label}
            </div>
            {group.items.map(item => {
              const isActive = !props.isAllSpaces && props.screen === item.id
              const b = badge(item.id)
              return (
                <button key={item.id}
                  onClick={() => props.onScreenChange(item.id)}
                  style={{
                    width: 'calc(100% - 12px)', margin: '0 6px', display: 'flex', alignItems: 'center', gap: 10,
                    padding: '7px 12px', border: 'none', borderRadius: 6, cursor: 'pointer',
                    background: isActive ? 'var(--accent-dim)' : 'none',
                    color: isActive ? 'var(--accent)' : 'var(--navy-100)',
                    fontSize: 13.5, fontWeight: isActive ? 600 : 500, fontFamily: 'inherit', textAlign: 'left',
                    transition: 'background .15s',
                  }}
                  onMouseEnter={e => { if (!isActive) e.currentTarget.style.background = 'var(--navy-600)' }}
                  onMouseLeave={e => { if (!isActive) e.currentTarget.style.background = 'none' }}>
                  <span style={{ width: 18, height: 18, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    {item.icon}
                  </span>
                  <span style={{ flex: 1 }}>{item.label}</span>
                  {b != null && b > 0 && (
                    <span style={{
                      fontSize: 10.5, fontWeight: 700, padding: '1px 7px', borderRadius: 99,
                      background: item.id === 'tasks' ? 'var(--red-bg)' : (isActive ? 'var(--accent)' : 'var(--navy-600)'),
                      color: item.id === 'tasks' ? 'var(--red-text)' : (isActive ? '#fff' : 'var(--navy-300)'),
                      lineHeight: 1.4,
                    }}>
                      {b}
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        ))}
      </nav>

      {/* Footer: avatar + theme toggle */}
      <div ref={avatarRef} style={{
        borderTop: '1px solid var(--navy-600)', padding: '10px 12px',
        display: 'flex', alignItems: 'center', gap: 10, position: 'relative',
      }}>
        <button onClick={() => setAvatarOpen(o => !o)}
          style={{
            width: 30, height: 30, borderRadius: '50%',
            background: avatarOpen ? 'var(--accent)' : 'var(--accent-dim)',
            color: avatarOpen ? '#fff' : 'var(--accent)',
            fontSize: 11, fontWeight: 700, border: 'none', cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
          }}>
          {props.initials}
        </button>
        <div style={{ flex: 1, minWidth: 0, lineHeight: 1.2 }}>
          <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--navy-50)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {props.email.split('@')[0]}
          </div>
          <div style={{ fontSize: 10.5, color: 'var(--navy-400)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {props.email}
          </div>
        </div>
        <button onClick={props.onToggleTheme} title={`Switch to ${props.theme === 'dark' ? 'light' : 'dark'} mode`}
          style={{
            width: 26, height: 26, borderRadius: 5, background: 'none', border: 'none',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer', color: 'var(--navy-300)', flexShrink: 0,
          }}
          onMouseEnter={e => { e.currentTarget.style.background = 'var(--navy-600)'; e.currentTarget.style.color = 'var(--accent)' }}
          onMouseLeave={e => { e.currentTarget.style.background = 'none'; e.currentTarget.style.color = 'var(--navy-300)' }}>
          {props.theme === 'dark'
            ? <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="7" r="3" stroke="currentColor" strokeWidth="1.3"/><path d="M7 1v1M7 12v1M1 7h1M12 7h1M2.9 2.9l.7.7M10.4 10.4l.7.7M10.4 2.9l-.7.7M2.9 10.4l.7-.7" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>
            : <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M12 7.5A5 5 0 1 1 6.5 2a3.5 3.5 0 0 0 5.5 5.5Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/></svg>
          }
        </button>

        {avatarOpen && (
          <div style={{
            position: 'absolute', bottom: '100%', left: 12, right: 12, marginBottom: 6,
            background: 'var(--navy-700)', border: '1px solid var(--navy-500)',
            borderRadius: 10, overflow: 'hidden', zIndex: 50,
          }}>
            <button onClick={() => { props.onCopyShareLink(); setAvatarOpen(false) }}
              style={{
                width: '100%', padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 10,
                background: 'none', border: 'none', borderBottom: '1px solid var(--navy-600)',
                cursor: 'pointer', fontSize: 12, color: 'var(--navy-100)', textAlign: 'left',
                fontFamily: 'inherit',
              }}>
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <circle cx="10.5" cy="3" r="1.75" stroke="currentColor" strokeWidth="1.3"/>
                <circle cx="3.5" cy="7" r="1.75" stroke="currentColor" strokeWidth="1.3"/>
                <circle cx="10.5" cy="11" r="1.75" stroke="currentColor" strokeWidth="1.3"/>
                <path d="M5.1 6.1l3.7-2.1M5.1 7.9l3.7 2.1" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
              </svg>
              Share with Melissa
            </button>
            <button onClick={() => { props.onSignOut(); setAvatarOpen(false) }}
              style={{
                width: '100%', padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 10,
                background: 'none', border: 'none', cursor: 'pointer',
                fontSize: 12, color: 'var(--navy-300)', textAlign: 'left', fontFamily: 'inherit',
              }}>
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d="M9 2H11.5C12.05 2 12.5 2.45 12.5 3V11C12.5 11.55 12.05 12 11.5 12H9M5.5 9.5L2 7M2 7L5.5 4.5M2 7H9" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              Sign out
            </button>
          </div>
        )}
      </div>
    </aside>
  )
}

// React import shim removed — useState now imported at top with useEffect/useRef.

/* ----- icons -------------------------------------------------------- */

function FocusIcon() {
  return <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.4"/><circle cx="8" cy="8" r="3" stroke="currentColor" strokeWidth="1.4"/><circle cx="8" cy="8" r="1" fill="currentColor"/></svg>
}
function TasksIcon() {
  return <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="1.7" y="1.7" width="12.6" height="12.6" rx="2.3" stroke="currentColor" strokeWidth="1.4"/><path d="M4.5 8.2l2.2 2.2 4.8-4.8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
}
function NotesIcon() {
  return <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M3 1.7h7.5L13 4.2v10.1H3z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round"/><path d="M5.5 6.5h5M5.5 9h5M5.5 11.5h3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></svg>
}
function OKRIcon() {
  return <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.4"/><circle cx="8" cy="8" r="2.4" fill="currentColor"/></svg>
}
function RoadmapIcon() {
  return <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="2" y="3" width="9" height="2.4" rx="1.2" stroke="currentColor" strokeWidth="1.4"/><rect x="2" y="6.8" width="12" height="2.4" rx="1.2" stroke="currentColor" strokeWidth="1.4"/><rect x="2" y="10.6" width="6" height="2.4" rx="1.2" stroke="currentColor" strokeWidth="1.4"/></svg>
}
function ReflectIcon() {
  return <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.4"/><path d="M8 4v4l2.5 1.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></svg>
}
function ParkIcon() {
  return <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.4"/><path d="M6.4 11.5V4.5h2.4c1.2 0 2.1.9 2.1 2.1s-.9 2.1-2.1 2.1H6.4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
}
