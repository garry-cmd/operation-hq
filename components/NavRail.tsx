'use client'
/**
 * NavRail — desktop-first left navigation. Replaces the previous fixed
 * top bar + fixed bottom-nav combo. The full app vertically scrolls within
 * a 240px-wide rail that anchors space switching, search, screen routing,
 * and the user/settings footer.
 *
 * Screens are organized into three groups by use frequency:
 *   - Daily:     Tasks, Notes          (the many-times-a-day tools)
 *   - Strategic: OKRs, Roadmap          (planning / weekly cadence)
 *   - Archive:   Reflect, Parking      (consulted, not daily)
 *
 * Mobile fallback is deliberately not implemented yet — the brief is
 * desktop-first. A hamburger / icon-only collapsed mode is a follow-on.
 */
import { useEffect, useRef, useState } from 'react'
import SpaceSwitcher from './SpaceSwitcher'
import { Space, AnnualObjective, RoadmapItem } from '@/lib/types'

export type Screen = 'home' | 'agent' | 'tasks' | 'notes' | 'calendar' | 'okr' | 'roadmap' | 'reflect' | 'park' | 'tags' | 'settings'

interface Props {
  screen: Screen
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
  homeAttentionCount?: number
  tasksOverdueCount?: number
  parkedCount?: number
  reviewsCount?: number

  // True while the Chief of Staff is mid-turn — shows a pulsing dot on the
  // agent nav row so an in-progress reply is visible from any screen.
  agentWorking?: boolean

  // Search — the rail renders a trigger that opens the command palette
  // (owned by page.tsx, which holds the searchable data).
  onOpenSearch: () => void

  // Footer / user menu.
  initials: string
  email: string
  theme: 'light' | 'dark'
  onToggleTheme: () => void
  onCopyShareLink: () => void
  onSignOut: () => void

  // Mobile fallback (May 17): when true, the rail is rendered as a fixed
  // slide-in drawer. `onClose` is called whenever the user navigates or
  // taps outside-equivalent — the parent owns the open/closed state since
  // it also owns the hamburger button that toggles it.
  isMobile?: boolean
  isOpen?: boolean
  onClose?: () => void
}

const NAV_GROUPS: { label: string; items: { id: Screen; label: string; icon: React.ReactNode }[] }[] = [
  {
    label: 'Daily',
    items: [
      { id: 'home', label: 'Home', icon: <HomeIcon /> },
      { id: 'agent', label: 'Chief of Staff', icon: <AgentIcon /> },
      { id: 'tasks', label: 'Tasks', icon: <TasksIcon /> },
      { id: 'notes', label: 'Notes', icon: <NotesIcon /> },
      { id: 'calendar', label: 'Calendar', icon: <CalendarIcon /> },
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
    label: 'Meta',
    items: [
      { id: 'tags', label: 'Tags', icon: <TagsIcon /> },
      { id: 'settings', label: 'Settings', icon: <SettingsIcon /> },
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

  const avatarRef = useRef<HTMLDivElement>(null)
  const [avatarOpen, setAvatarOpen] = useState(false)

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
    if (id === 'home') return props.homeAttentionCount
    if (id === 'tasks') return props.tasksOverdueCount
    if (id === 'park') return props.parkedCount
    if (id === 'reflect') return props.reviewsCount
    return undefined
  }

  return (
    <>
      {/* Mobile backdrop — only rendered while the drawer is open. Click
          dismisses, matching native drawer UX. */}
      {props.isMobile && props.isOpen && (
        <div onClick={props.onClose}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 39, animation: 'fadeIn .12s ease' }} />
      )}
      <aside style={{
        width: 240, flexShrink: 0,
        background: 'var(--navy-700)',
        borderRight: '1px solid var(--navy-600)',
        display: 'flex', flexDirection: 'column',
        // Desktop: sticky 240px column. Mobile: fixed slide-in drawer.
        position: props.isMobile ? 'fixed' : 'sticky',
        top: 0, left: 0, height: '100vh',
        zIndex: props.isMobile ? 40 : 30,
        transform: props.isMobile ? (props.isOpen ? 'translateX(0)' : 'translateX(-100%)') : 'none',
        transition: props.isMobile ? 'transform .22s ease' : 'none',
        boxShadow: props.isMobile && props.isOpen ? '4px 0 20px rgba(0,0,0,0.35)' : 'none',
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

        {/* Search — opens the command palette */}
        <button
          onClick={() => props.onOpenSearch()}
          style={{
            width: '100%', display: 'flex', alignItems: 'center', gap: 7,
            background: 'var(--navy-800)', border: '1px solid var(--navy-500)',
            borderRadius: 8, padding: '6px 10px', cursor: 'pointer',
            fontFamily: 'inherit', textAlign: 'left',
          }}
          onMouseEnter={e => (e.currentTarget.style.borderColor = 'var(--accent)')}
          onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--navy-500)')}
        >
          <svg width="13" height="13" viewBox="0 0 13 13" fill="none" style={{ flexShrink: 0 }}>
            <circle cx="5.5" cy="5.5" r="4" stroke="var(--navy-400)" strokeWidth="1.4"/>
            <path d="M9 9l2.5 2.5" stroke="var(--navy-400)" strokeWidth="1.4" strokeLinecap="round"/>
          </svg>
          <span style={{ flex: 1, fontSize: 12.5, color: 'var(--navy-400)' }}>Search…</span>
          <kbd style={{
            fontSize: 10, padding: '1px 5px', background: 'var(--navy-700)',
            border: '1px solid var(--navy-500)', borderRadius: 3, color: 'var(--navy-400)',
            fontFamily: 'monospace', flexShrink: 0,
          }}>⌘K</kbd>
        </button>
      </div>

      {/* Nav groups */}
      <nav style={{ flex: 1, overflowY: 'auto', padding: '4px 0' }}>
        <style>{`@keyframes hqPulse{0%,100%{opacity:.3;transform:scale(.8)}50%{opacity:1;transform:scale(1)}}`}</style>
        {NAV_GROUPS.map(group => (
          <div key={group.label}>
            <div style={{
              padding: '14px 18px 4px', fontSize: 10, fontWeight: 600, letterSpacing: '.18em',
              textTransform: 'uppercase', color: 'var(--nw-label)', fontFamily: 'var(--font-mono)',
            }}>
              {group.label}
            </div>
            {group.items.map(item => {
              const isActive = props.screen === item.id
              const b = badge(item.id)
              return (
                <button key={item.id}
                  onClick={() => { props.onScreenChange(item.id); if (props.isMobile) props.onClose?.() }}
                  style={{
                    position: 'relative',
                    width: 'calc(100% - 12px)', margin: '0 6px', display: 'flex', alignItems: 'center', gap: 10,
                    padding: '7px 12px', border: 'none', borderRadius: 6, cursor: 'pointer',
                    background: isActive ? 'var(--accent-bg)' : 'none',
                    color: isActive ? 'var(--accent-2)' : 'var(--navy-100)',
                    fontSize: 13.5, fontWeight: isActive ? 600 : 500, fontFamily: 'inherit', textAlign: 'left',
                    transition: 'background .15s',
                  }}
                  onMouseEnter={e => { if (!isActive) e.currentTarget.style.background = 'var(--hover)' }}
                  onMouseLeave={e => { if (!isActive) e.currentTarget.style.background = 'none' }}>
                  {isActive && <span aria-hidden style={{ position: 'absolute', left: 0, top: 6, bottom: 6, width: 3, borderRadius: '0 3px 3px 0', background: 'var(--accent)' }} />}
                  <span style={{ width: 18, height: 18, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    {item.icon}
                  </span>
                  <span style={{ flex: 1 }}>{item.label}</span>
                  {item.id === 'agent' && props.agentWorking && (
                    <span title="Working…" style={{
                      width: 7, height: 7, borderRadius: 99, flexShrink: 0,
                      background: 'var(--accent)', animation: 'hqPulse 1.4s ease-in-out infinite',
                    }} />
                  )}
                  {b != null && b > 0 && (
                    <span style={{
                      fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums',
                      fontSize: 10, fontWeight: 600, padding: '1px 7px', borderRadius: 99,
                      background: item.id === 'tasks' ? 'var(--red-bg)' : (isActive ? 'var(--accent)' : 'var(--surface-2)'),
                      color: item.id === 'tasks' ? 'var(--red-text)' : (isActive ? '#fff' : 'var(--navy-300)'),
                      lineHeight: 1.5,
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
    </>
  )
}

// React import shim removed — useState now imported at top with useEffect/useRef.

/* ----- icons -------------------------------------------------------- */

function AgentIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
      <path d="M12 7.5 12.9 10l2.6.6-2 1.7.4 2.7-1.9-1.2-1.9 1.2.4-2.7-2-1.7L11.1 10z" fill="currentColor" stroke="none" />
    </svg>
  )
}

function CalendarIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="17" rx="2" />
      <line x1="3" y1="9" x2="21" y2="9" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="16" y1="2" x2="16" y2="6" />
    </svg>
  )
}
function HomeIcon() {
  return <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M2.5 7L8 2.5 13.5 7" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/><path d="M3.7 6.4V13h8.6V6.4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/></svg>
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
function TagsIcon() {
  return <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M6 1.5L4.5 14.5M11.5 1.5L10 14.5M1.5 5h13M1.5 11h13" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></svg>
}
function SettingsIcon() {
  return <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="2.25" stroke="currentColor" strokeWidth="1.4"/><path d="M8 1.5v1.6M8 12.9v1.6M14.5 8h-1.6M3.1 8H1.5M12.6 3.4l-1.1 1.1M4.5 11.5l-1.1 1.1M12.6 12.6l-1.1-1.1M4.5 4.5L3.4 3.4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></svg>
}
