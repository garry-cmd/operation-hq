'use client'
import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from '@/lib/supabase'
import { Space, AnnualObjective, RoadmapItem, WeeklyAction, DailyCheckin, WeeklyReview, ObjectiveLink, ObjectiveLog, HabitCheckin, MetricCheckin } from '@/lib/types'
import { getMonday, ACTIVE_Q } from '@/lib/utils'
import Roadmap from '@/components/Roadmap'
import OKRs from '@/components/OKRs'
import Focus from '@/components/Focus'
import Reflect from '@/components/Reflect'
import ParkingLot from '@/components/ParkingLot'
import FastCapture from '@/components/FastCapture'
import Toast from '@/components/Toast'
import SpaceSwitcher from '@/components/SpaceSwitcher'
import PTPage from '@/app/pt/page'
import type { User } from '@supabase/supabase-js'

type Screen = 'reflect' | 'focus' | 'okr' | 'roadmap' | 'pt' | 'park'

interface SearchResult { label: string; sub: string; screen: Screen }

export default function HQPage() {
  const [user, setUser] = useState<User | null | undefined>(undefined)
  const [screen, setScreen] = useState<Screen>('okr')
  const [loading, setLoading] = useState(true)
  const [toast, setToast] = useState<string | null>(null)
  const [weekStart, setWeekStart] = useState(getMonday())
  const [avatarOpen, setAvatarOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const [theme, setTheme] = useState<'dark' | 'light'>('light')
  const [searchQuery, setSearchQuery] = useState('')
  const [searchFocused, setSearchFocused] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)
  const avatarRef = useRef<HTMLDivElement>(null)

  const [objectives, setObjectives] = useState<AnnualObjective[]>([])
  const [roadmapItems, setRoadmapItems] = useState<RoadmapItem[]>([])
  const [actions, setActions] = useState<WeeklyAction[]>([])
  const [checkins, setCheckins] = useState<DailyCheckin[]>([])
  const [habitCheckins, setHabitCheckins] = useState<HabitCheckin[]>([])
  const [metricCheckins, setMetricCheckins] = useState<MetricCheckin[]>([])
  const [reviews, setReviews] = useState<WeeklyReview[]>([])
  const [links, setLinks] = useState<ObjectiveLink[]>([])
  const [logs, setLogs] = useState<ObjectiveLog[]>([])
  const [shareToken, setShareToken] = useState('')
  const [spaces, setSpaces] = useState<Space[]>([])
  const [activeSpaceId, setActiveSpaceId] = useState('')


  useEffect(() => {
    const saved = localStorage.getItem('hq-theme') as 'dark' | 'light' | null
    const initial = saved ?? 'light'
    setTheme(initial)
    document.documentElement.setAttribute('data-theme', initial)
  }, [])

  function switchSpace(spaceId: string) {
    setActiveSpaceId(spaceId)
    localStorage.setItem('hq-active-space', spaceId)
  }

  function toggleTheme() {
    const next = theme === 'dark' ? 'light' : 'dark'
    setTheme(next)
    document.documentElement.setAttribute('data-theme', next)
    localStorage.setItem('hq-theme', next)
  }

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => setUser(session?.user ?? null))
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, s) => setUser(s?.user ?? null))
    return () => subscription.unsubscribe()
  }, [])

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (avatarRef.current && !avatarRef.current.contains(e.target as Node)) setAvatarOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const loadAll = useCallback(async () => {
    setLoading(true)
    const [o, r, a, ci, hc, mc, rv, lk, lg, sp, st] = await Promise.all([
      supabase.from('annual_objectives').select('*').order('sort_order'),
      supabase.from('roadmap_items').select('*').order('sort_order'),
      supabase.from('weekly_actions').select('*').order('created_at'),
      supabase.from('daily_checkins').select('*').order('checkin_date', { ascending: false }),
      supabase.from('habit_checkins').select('*').order('date', { ascending: false }),
      supabase.from('metric_checkins').select('*').order('created_at', { ascending: false }),
      supabase.from('weekly_reviews').select('*').order('week_start', { ascending: false }),
      supabase.from('objective_links').select('*').order('sort_order'),
      supabase.from('objective_logs').select('*').order('created_at', { ascending: false }),
      supabase.from('spaces').select('*').order('sort_order'),
      supabase.from('share_tokens').select('token').eq('label', 'Melissa').eq('active', true).single(),
    ])
    setObjectives(o.data ?? [])
    setRoadmapItems(r.data ?? [])
    setActions(a.data ?? [])
    setCheckins(ci.data ?? [])
    setHabitCheckins(hc.data ?? [])
    setMetricCheckins(mc.data ?? [])
    setReviews(rv.data ?? [])
    setLinks(lk.data ?? [])
    setLogs(lg.data ?? [])
    const loadedSpaces: Space[] = sp.data ?? []
    setSpaces(loadedSpaces)
    if (st.data) setShareToken(st.data.token)
    // Set active space from localStorage or default to first
    const savedSpaceId = localStorage.getItem('hq-active-space')
    const validId = loadedSpaces.find(s => s.id === savedSpaceId)?.id ?? loadedSpaces[0]?.id ?? ''
    setActiveSpaceId(validId)
    setLoading(false)
  }, [])

  useEffect(() => { if (user) loadAll() }, [user, loadAll])

  // Search
  const searchResults: SearchResult[] = searchQuery.trim().length < 2 ? [] : (() => {
    const q = searchQuery.toLowerCase()
    const results: SearchResult[] = []
    objectives.forEach(o => { if (o.name.toLowerCase().includes(q)) results.push({ label: o.name, sub: 'Objective', screen: 'roadmap' }) })
    roadmapItems.filter(i => !i.is_parked).forEach(i => { if (i.title.toLowerCase().includes(q)) results.push({ label: i.title, sub: 'Key Result', screen: i.quarter === ACTIVE_Q ? 'okr' : 'roadmap' }) })
    actions.filter(a => a.week_start === weekStart).forEach(a => { if (a.title.toLowerCase().includes(q)) results.push({ label: a.title, sub: 'Action this week', screen: 'focus' }) })
    roadmapItems.filter(i => i.is_parked).forEach(i => { if (i.title.toLowerCase().includes(q)) results.push({ label: i.title, sub: 'Parking Lot', screen: 'park' }) })
    return results.slice(0, 6)
  })()

  function copyShareLink() {
    const link = `${window.location.origin}/share/${shareToken}`
    navigator.clipboard.writeText(link)
    setCopied(true); setAvatarOpen(false); setToast('Share link copied!')
    setTimeout(() => setCopied(false), 2000)
  }

  if (user === undefined) return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--navy-900)' }}>
      <div style={{ width: 20, height: 20, borderRadius: '50%', border: '2px solid var(--navy-600)', borderTopColor: 'var(--accent)', animation: 'spin .6s linear infinite' }} />
    </div>
  )
  if (!user) return <LoginPage />

  const initials = user.email?.slice(0, 2).toUpperCase() ?? 'HQ'
  const parkedCount = roadmapItems.filter(i => i.is_parked).length

  // Space-scoped data — everything filters from the active space's objectives
  const activeSpace = spaces.find(s => s.id === activeSpaceId)
  const spaceObjectives = objectives.filter(o => o.space_id === activeSpaceId)
  const spaceObjectiveIds = new Set(spaceObjectives.map(o => o.id))
  const spaceRoadmapItems = roadmapItems.filter(i => spaceObjectiveIds.has(i.annual_objective_id))
  const spaceRoadmapItemIds = new Set(spaceRoadmapItems.map(i => i.id))
  const spaceActions = actions.filter(a => spaceRoadmapItemIds.has(a.roadmap_item_id))
  const spaceCheckins = checkins.filter(c => spaceRoadmapItemIds.has(c.roadmap_item_id))
  const spaceHabitCheckins = habitCheckins.filter(h => spaceRoadmapItemIds.has(h.roadmap_item_id))
  const spaceMetricCheckins = metricCheckins.filter(m => spaceRoadmapItemIds.has(m.roadmap_item_id))
  const spaceLinks = links.filter(l => spaceObjectiveIds.has(l.objective_id))
  const spaceLogs = logs.filter(l => spaceObjectiveIds.has(l.objective_id))
  const spaceReviews = reviews.filter(r => r.space_id === activeSpaceId)

  // Nav — Reflect | Focus | OKRs⚡ | Roadmap | PT | Parking
  const NAV: { id: Screen; label: string; icon: React.ReactNode; fab?: boolean }[] = [
    { id: 'reflect',  label: 'Reflect',  icon: <ReflectIcon  active={screen === 'reflect'} /> },
    { id: 'focus',    label: 'Focus',    icon: <FocusIcon    active={screen === 'focus'} /> },
    { id: 'okr',      label: 'OKRs',     icon: <OKRIcon />, fab: true },
    { id: 'roadmap',  label: 'Roadmap',  icon: <RoadmapIcon  active={screen === 'roadmap'} /> },
    { id: 'pt',       label: 'PT',       icon: <PTIcon       active={screen === 'pt'} /> },
    { id: 'park',     label: 'Parking',  icon: <ParkIcon     active={screen === 'park'} /> },
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh', background: 'var(--navy-900)' }}>
      {/* Topbar */}
      <header style={{ position: 'sticky', top: 0, zIndex: 40, height: 54, background: 'var(--navy-800)', borderBottom: '1px solid var(--navy-600)', display: 'flex', alignItems: 'center', padding: '0 16px', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          <div style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '1.5px', color: 'var(--navy-50)' }}>
            Op <span style={{ color: 'var(--accent)' }}>HQ</span>
          </div>
          {spaces.length > 0 && (
            <SpaceSwitcher
              spaces={spaces}
              activeSpaceId={activeSpaceId}
              objectives={objectives}
              roadmapItems={roadmapItems}
              onSelect={switchSpace}
              onSpaceCreated={space => setSpaces(prev => [...prev, space])}
              onSpaceUpdated={space => setSpaces(prev => prev.map(s => s.id === space.id ? space : s))}
            />
          )}
        </div>
        {/* Search */}
        <div style={{ flex: 1, position: 'relative' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'var(--navy-700)', border: `1px solid ${searchFocused ? 'var(--accent)' : 'var(--navy-500)'}`, borderRadius: 99, height: 34, padding: '0 12px', transition: 'border-color .15s' }}>
            <svg width="13" height="13" viewBox="0 0 13 13" fill="none" style={{ flexShrink: 0 }}><circle cx="5.5" cy="5.5" r="4" stroke="var(--navy-400)" strokeWidth="1.4"/><path d="M9 9l2.5 2.5" stroke="var(--navy-400)" strokeWidth="1.4" strokeLinecap="round"/></svg>
            <input ref={searchRef} value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
              onFocus={() => setSearchFocused(true)} onBlur={() => setTimeout(() => setSearchFocused(false), 150)}
              placeholder="Search objectives, key results, actions…"
              style={{ flex: 1, background: 'none', border: 'none', outline: 'none', fontSize: 12, color: 'var(--navy-100)', fontFamily: 'inherit' }} />
            {searchQuery && <button onClick={() => setSearchQuery('')} style={{ color: 'var(--navy-400)', background: 'none', border: 'none', cursor: 'pointer', fontSize: 14, lineHeight: 1 }}>×</button>}
          </div>
          {searchFocused && searchResults.length > 0 && (
            <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, marginTop: 4, background: 'var(--navy-700)', border: '1px solid var(--navy-500)', borderRadius: 12, overflow: 'hidden', zIndex: 50 }}>
              {searchResults.map((r, i) => (
                <button key={i} onMouseDown={() => { setScreen(r.screen); setSearchQuery(''); setSearchFocused(false) }}
                  style={{ width: '100%', padding: '10px 14px', display: 'flex', flexDirection: 'column', gap: 2, background: 'none', border: 'none', borderBottom: '1px solid var(--navy-600)', cursor: 'pointer', textAlign: 'left' }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'var(--navy-600)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'none')}>
                  <span style={{ fontSize: 12, color: 'var(--navy-50)', fontWeight: 500 }}>{r.label}</span>
                  <span style={{ fontSize: 10, color: 'var(--navy-400)' }}>{r.sub}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        {/* Avatar */}
        <div ref={avatarRef} style={{ position: 'relative', flexShrink: 0 }}>
          <button onClick={() => setAvatarOpen(o => !o)}
            style={{ width: 32, height: 32, borderRadius: '50%', background: avatarOpen ? 'var(--accent)' : 'var(--accent-dim)', color: avatarOpen ? '#fff' : 'var(--accent)', fontSize: 11, fontWeight: 700, border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            {initials}
          </button>
          {avatarOpen && (
            <div style={{ position: 'absolute', top: '100%', right: 0, marginTop: 6, background: 'var(--navy-700)', border: '1px solid var(--navy-500)', borderRadius: 12, overflow: 'hidden', minWidth: 190, zIndex: 50 }}>
              <button onClick={() => { toggleTheme(); setAvatarOpen(false) }}
                style={{ width: '100%', padding: '11px 14px', display: 'flex', alignItems: 'center', gap: 10, background: 'none', border: 'none', borderBottom: '1px solid var(--navy-600)', cursor: 'pointer', fontSize: 12, color: 'var(--navy-100)', textAlign: 'left' }}>
                {theme === 'dark'
                  ? <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="7" r="3" stroke="currentColor" strokeWidth="1.3"/><path d="M7 1v1M7 12v1M1 7h1M12 7h1M2.9 2.9l.7.7M10.4 10.4l.7.7M10.4 2.9l-.7.7M2.9 10.4l.7-.7" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>
                  : <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M12 7.5A5 5 0 1 1 6.5 2a3.5 3.5 0 0 0 5.5 5.5Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/></svg>
                }
                {theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
              </button>
              <button onClick={copyShareLink}
                style={{ width: '100%', padding: '11px 14px', display: 'flex', alignItems: 'center', gap: 10, background: 'none', border: 'none', borderBottom: '1px solid var(--navy-600)', cursor: 'pointer', fontSize: 12, color: 'var(--navy-100)', textAlign: 'left' }}>
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="10.5" cy="3" r="1.75" stroke="currentColor" strokeWidth="1.3"/><circle cx="3.5" cy="7" r="1.75" stroke="currentColor" strokeWidth="1.3"/><circle cx="10.5" cy="11" r="1.75" stroke="currentColor" strokeWidth="1.3"/><path d="M5.1 6.1l3.7-2.1M5.1 7.9l3.7 2.1" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>
                Share with Melissa
              </button>
              <button onClick={() => supabase.auth.signOut()}
                style={{ width: '100%', padding: '11px 14px', display: 'flex', alignItems: 'center', gap: 10, background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, color: 'var(--navy-300)', textAlign: 'left' }}>
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M9 2H11.5C12.05 2 12.5 2.45 12.5 3V11C12.5 11.55 12.05 12 11.5 12H9M5.5 9.5L2 7M2 7L5.5 4.5M2 7H9" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/></svg>
                Sign out
              </button>
            </div>
          )}
        </div>
      </header>

      {/* Main */}
      <main style={{ flex: 1, padding: '20px 16px 100px', maxWidth: 800, width: '100%', margin: '0 auto' }}>
        {loading ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', paddingTop: 80, gap: 10, color: 'var(--navy-400)', fontSize: 13 }}>
            <div style={{ width: 18, height: 18, borderRadius: '50%', border: '2px solid var(--navy-600)', borderTopColor: 'var(--accent)', animation: 'spin .6s linear infinite' }} />
            Loading…
          </div>
        ) : (
          <>
            {screen === 'okr'     && <OKRs objectives={spaceObjectives} roadmapItems={spaceRoadmapItems} setObjectives={setObjectives} setRoadmapItems={setRoadmapItems} actions={spaceActions} setActions={setActions} weekStart={weekStart} links={spaceLinks} logs={spaceLogs} onAddLink={link => setLinks(prev => [...prev, link])} onDeleteLink={id => setLinks(prev => prev.filter(l => l.id !== id))} onAddLog={log => setLogs(prev => [log, ...prev])} onDeleteLog={id => setLogs(prev => prev.filter(l => l.id !== id))} activeSpaceId={activeSpaceId} habitCheckins={spaceHabitCheckins} metricCheckins={spaceMetricCheckins} toast={setToast} />}
            {screen === 'focus'   && <Focus objectives={spaceObjectives} roadmapItems={spaceRoadmapItems} actions={spaceActions} setActions={setActions} habitCheckins={spaceHabitCheckins} setHabitCheckins={setHabitCheckins} weekStart={weekStart} setWeekStart={setWeekStart} toast={setToast} />}
            {screen === 'roadmap' && <Roadmap objectives={spaceObjectives} roadmapItems={spaceRoadmapItems} setObjectives={setObjectives} setRoadmapItems={setRoadmapItems} activeSpaceId={activeSpaceId} toast={setToast} />}
            {screen === 'reflect' && <Reflect objectives={spaceObjectives} roadmapItems={spaceRoadmapItems} setRoadmapItems={setRoadmapItems} checkins={spaceCheckins} setCheckins={setCheckins} reviews={spaceReviews} setReviews={setReviews} weekStart={weekStart} activeSpaceId={activeSpaceId} metricCheckins={spaceMetricCheckins} setMetricCheckins={setMetricCheckins} toast={setToast} />}
            {screen === 'pt'      && <PTPage />}
            {screen === 'park'    && <ParkingLot objectives={spaceObjectives} roadmapItems={spaceRoadmapItems} setRoadmapItems={setRoadmapItems} toast={setToast} />}
          </>
        )}
      </main>

      {/* Footer nav — Reflect | Focus | OKRs⚡ | Roadmap | PT | Parking */}
      <nav style={{ position: 'fixed', bottom: 0, left: 0, right: 0, height: 72, background: 'var(--navy-800)', borderTop: '1px solid var(--navy-600)', display: 'flex', alignItems: 'center', justifyContent: 'space-around', padding: '0 8px', zIndex: 40 }}>
        {NAV.map(item => item.fab ? (
          <button key={item.id} onClick={() => setScreen(item.id)}
            style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, background: 'none', border: 'none', cursor: 'pointer', marginTop: -20 }}>
            <div style={{ width: 52, height: 52, borderRadius: '50%', background: 'var(--accent)', border: '3px solid var(--navy-800)', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: screen === item.id ? '0 0 0 3px var(--accent-dim)' : 'none', transition: 'box-shadow .2s' }}>
              {item.icon}
            </div>
            <span style={{ fontSize: 10, fontWeight: 700, color: screen === item.id ? 'var(--accent)' : 'var(--navy-400)' }}>{item.label}</span>
          </button>
        ) : (
          <button key={item.id} onClick={() => setScreen(item.id)}
            style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, background: screen === item.id ? 'var(--accent-dim)' : 'none', border: 'none', cursor: 'pointer', padding: '6px 10px', borderRadius: 12, minWidth: 56, position: 'relative', transition: 'background .15s' }}>
            {item.id === 'park' && parkedCount > 0 && (
              <span style={{ position: 'absolute', top: 2, right: 6, background: 'var(--amber)', color: '#0b1520', fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 99, lineHeight: 1.4 }}>{parkedCount}</span>
            )}
            {item.icon}
            <span style={{ fontSize: 10, fontWeight: 600, color: screen === item.id ? 'var(--accent)' : 'var(--navy-400)' }}>{item.label}</span>
          </button>
        ))}
      </nav>

      <FastCapture
        objectives={spaceObjectives}
        roadmapItems={spaceRoadmapItems}
        weekStart={weekStart}
        setRoadmapItems={setRoadmapItems}
        setActions={setActions}
        toast={setToast}
      />

      {toast && <Toast msg={toast} onDone={() => setToast(null)} />}

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        * { -webkit-tap-highlight-color: transparent; }
      `}</style>
    </div>
  )
}

// — Icons ——————————————————————————————————————————————————————————————————————————
function ReflectIcon({ active }: { active: boolean }) {
  const c = active ? 'var(--accent)' : 'var(--navy-400)'
  return <svg width="22" height="22" viewBox="0 0 22 22" fill="none"><circle cx="11" cy="11" r="8" stroke={c} strokeWidth="1.5"/><path d="M11 6v5l3 2" stroke={c} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
}
function FocusIcon({ active }: { active: boolean }) {
  const c = active ? 'var(--accent)' : 'var(--navy-400)'
  return <svg width="22" height="22" viewBox="0 0 22 22" fill="none"><path d="M11 2.5L7 11h4l-1 8.5 5.5-9.5H12L11 2.5Z" stroke={c} strokeWidth="1.5" strokeLinejoin="round"/></svg>
}
function OKRIcon() {
  return <svg width="26" height="26" viewBox="0 0 26 26" fill="none"><circle cx="13" cy="13" r="10" stroke="white" strokeWidth="1.8"/><circle cx="13" cy="13" r="6" stroke="white" strokeWidth="1.8"/><circle cx="13" cy="13" r="2" fill="white"/></svg>
}
function RoadmapIcon({ active }: { active: boolean }) {
  const c = active ? 'var(--accent)' : 'var(--navy-400)'
  return <svg width="22" height="22" viewBox="0 0 22 22" fill="none"><rect x="2" y="5" width="5" height="13" rx="1.5" stroke={c} strokeWidth="1.5"/><rect x="9" y="3" width="5" height="17" rx="1.5" stroke={c} strokeWidth="1.5"/><rect x="16" y="7" width="5" height="10" rx="1.5" stroke={c} strokeWidth="1.5"/></svg>
}
function PTIcon({ active }: { active: boolean }) {
  const c = active ? 'var(--accent)' : 'var(--navy-400)'
  return <svg width="22" height="22" viewBox="0 0 22 22" fill="none"><path d="M6.5 7a4.5 4.5 0 1 1 9 0M4 12v-2a4 4 0 1 1 8 0v2" stroke={c} strokeWidth="1.5" strokeLinecap="round"/><path d="M9 12H4a2 2 0 0 0-2 2v1a2 2 0 0 0 2 2h5m4-5h5a2 2 0 0 1 2 2v1a2 2 0 0 1-2 2h-5" stroke={c} strokeWidth="1.5" strokeLinecap="round"/></svg>
}
function ParkIcon({ active }: { active: boolean }) {
  const c = active ? 'var(--accent)' : 'var(--navy-400)'
  return <svg width="22" height="22" viewBox="0 0 22 22" fill="none"><rect x="3" y="3" width="16" height="16" rx="4" stroke={c} strokeWidth="1.5"/><path d="M9 8h4a2.5 2.5 0 0 1 0 5H9V8Z" stroke={c} strokeWidth="1.5"/><path d="M9 13v4" stroke={c} strokeWidth="1.5" strokeLinecap="round"/></svg>
}

// — Login ——————————————————————————————————————————————————————————————————————————
function LoginPage() {
  const [mode, setMode] = useState<'login' | 'signup'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setLoading(true); setError('')
    if (mode === 'login') {
      const { error: err } = await supabase.auth.signInWithPassword({ email, password })
      if (err) setError(err.message)
    } else {
      const { error: err } = await supabase.auth.signUp({ email, password })
      if (err) setError(err.message)
      else setError('Account created — sign in below.')
    }
    setLoading(false)
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--navy-900)', padding: 20 }}>
      <div style={{ width: '100%', maxWidth: 380, background: 'var(--navy-700)', border: '1px solid var(--navy-600)', borderRadius: 20, padding: 32 }}>
        <div style={{ fontSize: 18, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '1.5px', color: 'var(--navy-50)', marginBottom: 4 }}>
          Operation <span style={{ color: 'var(--accent)' }}>HQ</span>
        </div>
        <p style={{ fontSize: 13, color: 'var(--navy-400)', marginBottom: 24 }}>{mode === 'login' ? 'Sign in to your mission control' : 'Create your account'}</p>
        {error && <div style={{ background: 'var(--red-bg)', color: 'var(--red-text)', fontSize: 12, padding: '8px 12px', borderRadius: 10, marginBottom: 12 }}>{error}</div>}
        <form onSubmit={submit}>
          <div className="field"><label>Email</label><input className="input" type="email" value={email} onChange={e => setEmail(e.target.value)} required autoFocus /></div>
          <div className="field"><label>Password</label><input className="input" type="password" value={password} onChange={e => setPassword(e.target.value)} required /></div>
          <button className="btn-primary" style={{ width: '100%', padding: '11px', marginTop: 4 }} disabled={loading}>
            {loading ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Create account'}
          </button>
        </form>
        <p style={{ fontSize: 12, color: 'var(--navy-400)', textAlign: 'center', marginTop: 16 }}>
          {mode === 'login' ? 'New here? ' : 'Have an account? '}
          <button style={{ color: 'var(--accent)', background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, textDecoration: 'underline' }} onClick={() => { setMode(m => m === 'login' ? 'signup' : 'login'); setError('') }}>
            {mode === 'login' ? 'Create account' : 'Sign in'}
          </button>
        </p>
      </div>
    </div>
  )
}
