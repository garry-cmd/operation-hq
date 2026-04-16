'use client'
import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { AnnualObjective, RoadmapItem, QuarterlyKR, WeeklyAction, DailyCheckin, WeeklyReview } from '@/lib/types'
import { getMonday, ACTIVE_Q } from '@/lib/utils'
import Roadmap from '@/components/Roadmap'
import OKRs from '@/components/OKRs'
import Checkin from '@/components/Checkin'
import ParkingLot from '@/components/ParkingLot'
import History from '@/components/History'
import Toast from '@/components/Toast'
import Modal from '@/components/Modal'
import type { User } from '@supabase/supabase-js'

type Screen = 'roadmap' | 'okr' | 'checkin' | 'history'

export default function HQPage() {
  const [user, setUser] = useState<User | null | undefined>(undefined)
  const [screen, setScreen] = useState<Screen>('roadmap')
  const [loading, setLoading] = useState(true)
  const [toast, setToast] = useState<string | null>(null)
  const [weekStart, setWeekStart] = useState(getMonday())

  const [objectives, setObjectives] = useState<AnnualObjective[]>([])
  const [roadmapItems, setRoadmapItems] = useState<RoadmapItem[]>([])
  const [krs, setKrs] = useState<QuarterlyKR[]>([])
  const [actions, setActions] = useState<WeeklyAction[]>([])
  const [checkins, setCheckins] = useState<DailyCheckin[]>([])
  const [reviews, setReviews] = useState<WeeklyReview[]>([])
  const [shareToken, setShareToken] = useState('')
  const [shareModalOpen, setShareModalOpen] = useState(false)
  const [parkingOpen, setParkingOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const [authMode, setAuthMode] = useState<'login' | 'signup'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [authError, setAuthError] = useState('')
  const [authLoading, setAuthLoading] = useState(false)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => setUser(session?.user ?? null))
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, s) => setUser(s?.user ?? null))
    return () => subscription.unsubscribe()
  }, [])

  const loadAll = useCallback(async () => {
    setLoading(true)
    const [o, r, k, a, rv, ci, st] = await Promise.all([
      supabase.from('annual_objectives').select('*').order('sort_order'),
      supabase.from('roadmap_items').select('*').order('sort_order'),
      supabase.from('quarterly_krs').select('*').order('sort_order'),
      supabase.from('weekly_actions').select('*').order('sort_order'),
      supabase.from('weekly_reviews').select('*').order('week_start', { ascending: false }),
      supabase.from('daily_checkins').select('*').order('checkin_date', { ascending: false }),
      supabase.from('share_tokens').select('token').eq('label', 'Melissa').eq('active', true).single(),
    ])
    setObjectives(o.data ?? [])
    setRoadmapItems(r.data ?? [])
    setKrs(k.data ?? [])
    setActions(a.data ?? [])
    setReviews(rv.data ?? [])
    setCheckins(ci.data ?? [])
    if (st.data) setShareToken(st.data.token)
    setLoading(false)
  }, [])

  useEffect(() => { if (user) loadAll() }, [user, loadAll])

  async function authSubmit(e: React.FormEvent) {
    e.preventDefault()
    setAuthLoading(true); setAuthError('')
    if (authMode === 'login') {
      const { error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) setAuthError(error.message)
    } else {
      const { error } = await supabase.auth.signUp({ email, password })
      if (error) setAuthError(error.message)
      else setAuthError('Account created — sign in below.')
    }
    setAuthLoading(false)
  }

  function copyShareLink() {
    const link = `${window.location.origin}/share/${shareToken}`
    navigator.clipboard.writeText(link)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  if (user === undefined) return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: 'var(--navy-900)' }}>
      <div className="w-5 h-5 rounded-full border-2 animate-spin" style={{ borderColor: 'var(--navy-500)', borderTopColor: 'var(--accent)' }} />
    </div>
  )

  if (!user) return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: 'var(--navy-900)' }}>
      <div className="w-full max-w-sm p-9 rounded-2xl border" style={{ background: 'var(--navy-700)', borderColor: 'var(--navy-500)' }}>
        <div className="text-lg font-bold uppercase tracking-widest mb-1" style={{ color: 'var(--navy-50)' }}>
          Operation <span style={{ color: 'var(--accent)' }}>HQ</span>
        </div>
        <p className="text-sm mb-7" style={{ color: 'var(--navy-300)' }}>
          {authMode === 'login' ? 'Sign in to your mission control' : 'Create your account'}
        </p>
        {authError && (
          <div className="text-xs px-3 py-2 rounded-lg mb-3" style={{ background: 'var(--red-bg)', color: 'var(--red-text)' }}>
            {authError}
          </div>
        )}
        <form onSubmit={authSubmit}>
          <div className="field">
            <label>Email</label>
            <input className="input" type="email" value={email} onChange={e => setEmail(e.target.value)} required autoFocus />
          </div>
          <div className="field">
            <label>Password</label>
            <input className="input" type="password" value={password} onChange={e => setPassword(e.target.value)} required />
          </div>
          <button className="btn-primary w-full py-2.5 mt-1" disabled={authLoading}>
            {authLoading ? 'Please wait…' : authMode === 'login' ? 'Sign in' : 'Create account'}
          </button>
        </form>
        <p className="text-xs text-center mt-4" style={{ color: 'var(--navy-300)' }}>
          {authMode === 'login' ? 'New here? ' : 'Have an account? '}
          <button className="underline" style={{ color: 'var(--accent)', background: 'none', border: 'none', cursor: 'pointer' }}
            onClick={() => { setAuthMode(m => m === 'login' ? 'signup' : 'login'); setAuthError('') }}>
            {authMode === 'login' ? 'Create account' : 'Sign in'}
          </button>
        </p>
      </div>
    </div>
  )

  const initials = user.email?.slice(0, 2).toUpperCase() ?? 'HQ'
  const NAV: [Screen, string][] = [
    ['roadmap', 'Roadmap'],
    ['okr', `${ACTIVE_Q} OKRs`],
    ['checkin', 'Check-in'],
    ['history', 'History'],
  ]

  return (
    <div className="flex flex-col min-h-screen" style={{ background: 'var(--navy-900)' }}>
      {/* Topbar */}
      <header className="sticky top-0 z-40 flex items-center gap-0 px-5 h-14 border-b"
        style={{ background: 'var(--navy-800)', borderColor: 'var(--navy-600)' }}>
        <div className="text-sm font-bold uppercase tracking-widest pr-5 mr-4 shrink-0 border-r"
          style={{ color: 'var(--navy-50)', borderColor: 'var(--navy-600)' }}>
          Operation <span style={{ color: 'var(--accent)' }}>HQ</span>
        </div>
        <nav className="flex gap-1.5 flex-1 overflow-x-auto">
          {NAV.map(([id, label]) => (
            <button key={id} onClick={() => setScreen(id)}
              className="text-xs px-4 py-1.5 rounded-full whitespace-nowrap font-medium transition-all"
              style={screen === id
                ? { background: 'var(--accent)', color: '#fff', border: 'none' }
                : { background: 'transparent', color: 'var(--navy-300)', border: '1px solid var(--navy-600)' }
              }>
              {label}
            </button>
          ))}
        </nav>
        <div className="flex items-center gap-2 ml-auto pl-4">
          <button onClick={() => setParkingOpen(o => !o)}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full font-medium relative"
            style={parkingOpen
              ? { background: 'var(--amber-bg)', border: '1px solid var(--amber)', color: 'var(--amber-text)' }
              : { background: 'var(--navy-700)', border: '1px solid var(--navy-500)', color: 'var(--navy-300)' }}>
            🅿 Parking Lot
            {roadmapItems.filter(i => i.is_parked).length > 0 && (
              <span style={{ background: 'var(--amber)', color: '#000', fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 99 }}>
                {roadmapItems.filter(i => i.is_parked).length}
              </span>
            )}
          </button>
          <button onClick={() => setShareModalOpen(true)}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full font-medium"
            style={{ background: 'var(--navy-700)', border: '1px solid var(--navy-500)', color: 'var(--navy-200)' }}>
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <circle cx="9" cy="2.5" r="1.5" stroke="currentColor" strokeWidth="1.2"/>
              <circle cx="3" cy="6" r="1.5" stroke="currentColor" strokeWidth="1.2"/>
              <circle cx="9" cy="9.5" r="1.5" stroke="currentColor" strokeWidth="1.2"/>
              <path d="M4.41 5.09l3.18-1.82M4.41 6.91l3.18 1.82" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
            </svg>
            Share with Melissa
          </button>
          <button title={user.email ?? ''} onClick={() => supabase.auth.signOut()}
            className="w-8 h-8 rounded-full text-xs font-bold flex items-center justify-center transition-all"
            style={{ background: 'var(--accent-dim)', color: 'var(--accent)' }}>
            {initials}
          </button>
        </div>
      </header>

      {/* Main content */}
      <main className="flex-1 p-5 max-w-[1200px] w-full mx-auto">
        {loading ? (
          <div className="flex items-center justify-center py-20 gap-2 text-sm" style={{ color: 'var(--navy-400)' }}>
            <div className="w-4 h-4 rounded-full border-2 animate-spin"
              style={{ borderColor: 'var(--navy-600)', borderTopColor: 'var(--accent)' }} />
            Loading your data…
          </div>
        ) : (
          <>
            {screen === 'roadmap' && <Roadmap objectives={objectives} roadmapItems={roadmapItems} setObjectives={setObjectives} setRoadmapItems={setRoadmapItems} toast={setToast} />}
            {screen === 'okr'      && <OKRs objectives={objectives} roadmapItems={roadmapItems} krs={krs} setKrs={setKrs} actions={actions} setActions={setActions} weekStart={weekStart} setWeekStart={setWeekStart} toast={setToast} />}
            {screen === 'checkin'  && <Checkin objectives={objectives} roadmapItems={roadmapItems} krs={krs} setKrs={setKrs} checkins={checkins} setCheckins={setCheckins} reviews={reviews} setReviews={setReviews} weekStart={weekStart} toast={setToast} />}
            {screen === 'history'  && <History reviews={reviews} />}
          </>
        )}
      </main>

      {/* Share modal */}
      {shareModalOpen && (
        <Modal title="Share with Melissa" onClose={() => setShareModalOpen(false)}
          footer={<button className="btn" onClick={() => setShareModalOpen(false)}>Close</button>}>
          <p className="text-sm mb-4" style={{ color: 'var(--navy-300)' }}>
            Melissa gets a read-only view of your active quarter OKRs. She can&apos;t edit anything.
          </p>
          <div className="flex gap-2 items-center rounded-xl px-3 py-2.5"
            style={{ background: 'var(--navy-800)', border: '1px solid var(--navy-500)' }}>
            <span className="text-xs flex-1 truncate font-mono" style={{ color: 'var(--navy-300)' }}>
              {typeof window !== 'undefined' ? `${window.location.origin}/share/${shareToken}` : ''}
            </span>
            <button onClick={copyShareLink} className="btn text-xs px-2.5 py-1" style={{ fontSize: 11 }}>
              {copied ? 'Copied!' : 'Copy'}
            </button>
          </div>
        </Modal>
      )}

      {toast && <Toast msg={toast} onDone={() => setToast(null)} />}

      <ParkingLot
        open={parkingOpen}
        onClose={() => setParkingOpen(false)}
        objectives={objectives}
        roadmapItems={roadmapItems}
        setRoadmapItems={setRoadmapItems}
        toast={setToast}
      />
    </div>
  )
}
