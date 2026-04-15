'use client'
import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { AnnualObjective, RoadmapItem, QuarterlyKR, WeeklyAction, DailyCheckin, WeeklyReview } from '@/lib/types'
import { getMonday, ACTIVE_Q } from '@/lib/utils'
import Roadmap from '@/components/Roadmap'
import OKRs from '@/components/OKRs'
import Weekly from '@/components/Weekly'
import Checkin from '@/components/Checkin'
import History from '@/components/History'
import Toast from '@/components/Toast'
import Modal from '@/components/Modal'
import type { User } from '@supabase/supabase-js'

type Screen = 'roadmap' | 'okr' | 'weekly' | 'checkin' | 'history'

export default function HQPage() {
  const [user, setUser] = useState<User | null | undefined>(undefined)
  const [screen, setScreen] = useState<Screen>('roadmap')
  const [loading, setLoading] = useState(true)
  const [toast, setToast] = useState<string | null>(null)
  const [weekStart, setWeekStart] = useState(getMonday())

  // Data
  const [objectives, setObjectives] = useState<AnnualObjective[]>([])
  const [roadmapItems, setRoadmapItems] = useState<RoadmapItem[]>([])
  const [krs, setKrs] = useState<QuarterlyKR[]>([])
  const [actions, setActions] = useState<WeeklyAction[]>([])
  const [checkins, setCheckins] = useState<DailyCheckin[]>([])
  const [reviews, setReviews] = useState<WeeklyReview[]>([])
  const [shareToken, setShareToken] = useState('')

  // Auth modals
  const [authMode, setAuthMode] = useState<'login' | 'signup'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [authError, setAuthError] = useState('')
  const [authLoading, setAuthLoading] = useState(false)
  const [shareModalOpen, setShareModalOpen] = useState(false)
  const [copied, setCopied] = useState(false)

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
      else setAuthError('Check your email to confirm your account, then sign in.')
    }
    setAuthLoading(false)
  }

  function copyShareLink() {
    const link = `${window.location.origin}/share/${shareToken}`
    navigator.clipboard.writeText(link)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  // Loading state
  if (user === undefined) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="w-5 h-5 border-2 border-gray-200 border-t-[#1D9E75] rounded-full animate-spin" />
      </div>
    )
  }

  // Login page
  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="bg-white rounded-2xl border border-gray-200 p-9 w-full max-w-sm shadow-sm">
          <div className="text-lg font-bold uppercase tracking-widest text-gray-900 mb-1">
            Operation <span className="text-[#1D9E75]">HQ</span>
          </div>
          <p className="text-sm text-gray-400 mb-7">
            {authMode === 'login' ? 'Sign in to your mission control' : 'Create your account'}
          </p>
          {authError && (
            <div className="bg-[#FAECE7] text-[#993C1D] text-xs px-3 py-2 rounded-lg mb-3">{authError}</div>
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
          <p className="text-xs text-gray-500 text-center mt-4">
            {authMode === 'login' ? "New here? " : "Have an account? "}
            <button className="text-[#1D9E75] underline" onClick={() => { setAuthMode(m => m === 'login' ? 'signup' : 'login'); setAuthError('') }}>
              {authMode === 'login' ? 'Create account' : 'Sign in'}
            </button>
          </p>
        </div>
      </div>
    )
  }

  const initials = user.email?.slice(0, 2).toUpperCase() ?? 'HQ'
  const NAV: [Screen, string][] = [['roadmap','Roadmap'],['okr',`${ACTIVE_Q} OKRs`],['weekly','Weekly'],['checkin','Check-in'],['history','History']]

  return (
    <div className="flex flex-col min-h-screen bg-gray-50">
      {/* Topbar */}
      <header className="sticky top-0 z-40 flex items-center gap-0 bg-white border-b border-gray-200 px-5 h-13">
        <div className="text-sm font-bold uppercase tracking-widest text-gray-900 pr-5 border-r border-gray-200 mr-4 shrink-0">
          Operation <span className="text-[#1D9E75]">HQ</span>
        </div>
        <nav className="flex gap-0.5 flex-1 overflow-x-auto">
          {NAV.map(([id, label]) => (
            <button key={id} onClick={() => setScreen(id)}
              className={`text-xs px-3.5 py-1.5 rounded-lg whitespace-nowrap transition-all ${
                screen === id ? 'bg-[#1D9E75] text-white font-medium' : 'text-gray-500 hover:bg-gray-100 hover:text-gray-900'
              }`}>
              {label}
            </button>
          ))}
        </nav>
        <div className="flex items-center gap-2 ml-auto pl-4">
          <button className="flex items-center gap-1.5 text-xs border border-gray-200 px-3 py-1.5 rounded-lg text-gray-600 hover:bg-gray-50"
            onClick={() => setShareModalOpen(true)}>
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" className="shrink-0">
              <path d="M9 4a1.5 1.5 0 100-3 1.5 1.5 0 000 3zM3 7.5a1.5 1.5 0 100-3 1.5 1.5 0 000 3zM9 11a1.5 1.5 0 100-3 1.5 1.5 0 000 3zM4.41 6.59l3.19 1.82M7.59 3.41L4.41 5.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
            </svg>
            Share with Melissa
          </button>
          <button title={user.email} onClick={() => supabase.auth.signOut()}
            className="w-8 h-8 rounded-full bg-[#E1F5EE] text-[#0F6E56] text-xs font-semibold flex items-center justify-center hover:bg-[#1D9E75] hover:text-white transition-colors">
            {initials}
          </button>
        </div>
      </header>

      {/* Content */}
      <main className="flex-1 p-5 max-w-[1200px] w-full mx-auto">
        {loading ? (
          <div className="flex items-center justify-center py-20 gap-2 text-gray-400 text-sm">
            <div className="w-4 h-4 border-2 border-gray-200 border-t-[#1D9E75] rounded-full animate-spin" />
            Loading your data…
          </div>
        ) : (
          <>
            {screen === 'roadmap' && <Roadmap objectives={objectives} roadmapItems={roadmapItems} setObjectives={setObjectives} setRoadmapItems={setRoadmapItems} toast={setToast} />}
            {screen === 'okr' && <OKRs objectives={objectives} roadmapItems={roadmapItems} krs={krs} setKrs={setKrs} toast={setToast} />}
            {screen === 'weekly' && <Weekly objectives={objectives} roadmapItems={roadmapItems} krs={krs} actions={actions} setActions={setActions} weekStart={weekStart} setWeekStart={setWeekStart} toast={setToast} />}
            {screen === 'checkin' && <Checkin objectives={objectives} roadmapItems={roadmapItems} krs={krs} setKrs={setKrs} checkins={checkins} setCheckins={setCheckins} reviews={reviews} setReviews={setReviews} weekStart={weekStart} toast={setToast} />}
            {screen === 'history' && <History reviews={reviews} />}
          </>
        )}
      </main>

      {/* Share modal */}
      {shareModalOpen && (
        <Modal title="Share with Melissa" onClose={() => setShareModalOpen(false)}
          footer={<button className="btn" onClick={() => setShareModalOpen(false)}>Close</button>}>
          <p className="text-sm text-gray-500 mb-4">
            Melissa gets a read-only view of your active quarter's OKRs. She can't edit anything.
          </p>
          <div className="flex gap-2 items-center bg-gray-50 border border-gray-200 rounded-lg px-3 py-2.5">
            <span className="text-xs text-gray-500 font-mono flex-1 truncate">
              {typeof window !== 'undefined' ? `${window.location.origin}/share/${shareToken}` : ''}
            </span>
            <button onClick={copyShareLink}
              className="text-xs px-2.5 py-1 border border-gray-200 bg-white rounded-lg hover:bg-gray-50 shrink-0">
              {copied ? 'Copied!' : 'Copy'}
            </button>
          </div>
        </Modal>
      )}

      {toast && <Toast msg={toast} onDone={() => setToast(null)} />}
    </div>
  )
}
