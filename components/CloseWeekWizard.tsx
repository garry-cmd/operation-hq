'use client'
import { useState, useEffect, useRef } from 'react'
import { supabase } from '@/lib/supabase'
import {
  AnnualObjective, RoadmapItem, WeeklyAction, HabitCheckin,
  WeeklyReview, ReviewRating, HealthStatus,
} from '@/lib/types'
import { addWeeks, formatWeek, getMonday } from '@/lib/utils'
import { calculateHabitProgress, parseHabitPattern } from '@/lib/habitUtils'

const PROGRESS_OPTIONS = [0, 25, 50, 75, 100]

// Health status pills available in step 1.
const HEALTH_OPTIONS: { value: HealthStatus; label: string; bg: string; fg: string }[] = [
  { value: 'on_track',  label: 'on track',  bg: 'var(--teal-bg, #d4ecdf)',  fg: 'var(--teal-text, #2a6044)' },
  { value: 'off_track', label: 'off track', bg: 'var(--red-bg, #f4dcd2)',   fg: 'var(--red-text, #7a3a28)' },
  { value: 'blocked',   label: 'blocked',   bg: 'var(--amber-bg, #f4e4c2)', fg: 'var(--amber-text, #6a4a10)' },
  { value: 'done',      label: 'done',      bg: 'var(--navy-700, #2a3a5a)', fg: 'var(--navy-50, #fff)' },
]

const RATINGS: { value: ReviewRating; label: string; color: string }[] = [
  { value: 'strong', label: 'Strong', color: 'var(--teal)' },
  { value: 'steady', label: 'Steady', color: 'var(--amber)' },
  { value: 'rough',  label: 'Rough',  color: 'var(--red)' },
]

type Props = {
  closingWeek: string
  objectives: AnnualObjective[]
  roadmapItems: RoadmapItem[]
  setRoadmapItems: (fn: (p: RoadmapItem[]) => RoadmapItem[]) => void
  actions: WeeklyAction[]
  setActions: (fn: (p: WeeklyAction[]) => WeeklyAction[]) => void
  habitCheckins: HabitCheckin[]
  reviews: WeeklyReview[]
  setReviews: (fn: (p: WeeklyReview[]) => WeeklyReview[]) => void
  setWeekStart: (fn: (s: string) => string) => void
  activeSpaceId: string
  toast: (m: string) => void
  onClose: () => void
}

type PersistedState = {
  step: 1 | 2
  rating: ReviewRating | null
  win: string
  slipped: string
  adjustNotes: string
  walkthroughIndex: number
  seeded: boolean   // Have we inserted carry/recur rows for the next week yet?
}

const initialPersisted = (existing?: WeeklyReview): PersistedState => ({
  step: 1,
  rating: existing?.rating ?? null,
  win: existing?.win ?? '',
  slipped: existing?.slipped ?? '',
  adjustNotes: existing?.adjust_notes ?? '',
  walkthroughIndex: 0,
  seeded: false,
})

export default function CloseWeekWizard({
  closingWeek, objectives, roadmapItems, setRoadmapItems, actions, setActions,
  habitCheckins, reviews, setReviews, setWeekStart, activeSpaceId, toast, onClose,
}: Props) {
  // The week the new actions land in. If the user is closing a stale past week
  // (e.g. Wednesday, last Monday never closed), the new actions go in the
  // CURRENT week, not the literal next week — otherwise carries are stranded.
  const todayMonday = getMonday()
  const literalNext = addWeeks(closingWeek, 1)
  const nextWeek = literalNext > todayMonday ? literalNext : todayMonday

  const storageKey = `hq-close-wizard:${activeSpaceId}:${closingWeek}`
  const existingReview = reviews.find(r => r.week_start === closingWeek)

  // Hydrate from localStorage if a wizard run was in progress for this week,
  // else seed from any existing review record so re-opening the wizard for a
  // week you already partially reflected on doesn't wipe your inputs.
  const [s, setS] = useState<PersistedState>(() => {
    if (typeof window === 'undefined') return initialPersisted(existingReview)
    const raw = window.localStorage.getItem(storageKey)
    if (raw) {
      try { return { ...initialPersisted(existingReview), ...JSON.parse(raw) } }
      catch { /* fall through */ }
    }
    return initialPersisted(existingReview)
  })

  // Persist every change. Cheap; localStorage writes are synchronous and small.
  useEffect(() => {
    try { window.localStorage.setItem(storageKey, JSON.stringify(s)) } catch { /* noop */ }
  }, [s, storageKey])

  function patch(p: Partial<PersistedState>) { setS(prev => ({ ...prev, ...p })) }

  // ---------- Derived data ----------
  const activeKRs = roadmapItems.filter(i => !i.is_parked && i.status !== 'abandoned' && i.status !== 'done')
  const habitKRs = activeKRs.filter(kr => kr.is_habit)
  const outcomeKRs = activeKRs.filter(kr => !kr.is_habit && !(kr as { metric_type?: string }).metric_type)

  // Habit recap for the week being closed.
  const habitRecap = habitKRs.map(kr => {
    const krCheckins = habitCheckins.filter(c => c.roadmap_item_id === kr.id)
    const progress = calculateHabitProgress(kr, krCheckins, closingWeek)
    const pattern = parseHabitPattern(kr.title)
    const dotsFilled = Math.min(7, progress.completedSessions.length)
    const dots = '●'.repeat(dotsFilled) + '○'.repeat(Math.max(0, 7 - dotsFilled))
    let label = '—'
    let labelColor = 'var(--navy-400)'
    if (pattern.mode === 'weekly_count') {
      const target = pattern.target ?? 1
      label = `${progress.completedSessions.length} / ${target}`
      labelColor = progress.completedSessions.length >= target ? 'var(--teal)' : 'var(--red)'
    } else if (pattern.mode === 'daily') {
      label = `${progress.completedSessions.length} / 7`
      labelColor = progress.completedSessions.length >= 5 ? 'var(--teal)' : 'var(--red)'
    }
    return { kr, dots, label, labelColor }
  })

  // ---------- Step 1: KR mutations save immediately (matches Reflect today) ----------
  async function setKRHealth(kr: RoadmapItem, health: HealthStatus) {
    await supabase.from('roadmap_items').update({ health_status: health }).eq('id', kr.id)
    setRoadmapItems(prev => prev.map(i => i.id === kr.id ? { ...i, health_status: health } : i))
  }
  async function setKRProgress(kr: RoadmapItem, progress: number) {
    await supabase.from('roadmap_items').update({ progress }).eq('id', kr.id)
    setRoadmapItems(prev => prev.map(i => i.id === kr.id ? { ...i, progress } : i))
  }

  // ---------- Step 1 → Step 2: write the review, seed next-week actions ----------
  const [advancing, setAdvancing] = useState(false)
  async function continueToStep2() {
    if (!s.rating) { toast('Pick a rating first.'); return }
    if (advancing) return
    setAdvancing(true)
    try {
      // 1. Save the weekly review.
      const onTrack = activeKRs.filter(k => k.health_status === 'on_track' || k.health_status === 'done').length
      const payload = {
        week_start: closingWeek,
        rating: s.rating,
        win: s.win,
        slipped: s.slipped,
        adjust_notes: s.adjustNotes,
        krs_hit: onTrack,
        krs_total: activeKRs.length,
      }
      if (existingReview) {
        await supabase.from('weekly_reviews').update(payload).eq('id', existingReview.id)
        setReviews(prev => prev.map(r => r.id === existingReview.id ? { ...r, ...payload } : r))
      } else {
        const { data } = await supabase.from('weekly_reviews').insert({ ...payload, space_id: activeSpaceId }).select().single()
        if (data) setReviews(prev => [data, ...prev])
      }

      // 2. Seed next-week actions (carries + recurring re-spawns), if not already done.
      if (!s.seeded) {
        const closing = actions.filter(a => a.week_start === closingWeek)
        const next = actions.filter(a => a.week_start === nextWeek)
        const dup = (a: WeeklyAction) => next.some(n => n.roadmap_item_id === a.roadmap_item_id && n.title === a.title)

        const recurring = closing.filter(a => a.is_recurring && !dup(a))
        const carrying = closing.filter(a => !a.is_recurring && !a.completed && !dup(a))

        const inserts = [
          ...recurring.map(a => ({ roadmap_item_id: a.roadmap_item_id, title: a.title, week_start: nextWeek, is_recurring: true,  carried_over: false, completed: false })),
          ...carrying.map(a => ({ roadmap_item_id: a.roadmap_item_id, title: a.title, week_start: nextWeek, is_recurring: false, carried_over: true,  completed: false })),
        ]
        if (inserts.length > 0) {
          const { data, error } = await supabase.from('weekly_actions').insert(inserts).select()
          if (error) { toast('Could not seed next week.'); setAdvancing(false); return }
          if (data) setActions(prev => [...prev, ...data])
        }
        patch({ step: 2, seeded: true })
      } else {
        patch({ step: 2 })
      }
    } finally {
      setAdvancing(false)
    }
  }

  // ---------- Step 2 mutations ----------
  const nextWeekActions = actions.filter(a => a.week_start === nextWeek)

  async function removeAction(id: string) {
    await supabase.from('weekly_actions').delete().eq('id', id)
    setActions(prev => prev.filter(a => a.id !== id))
  }

  async function addActionForKR(krId: string, title: string) {
    const { data } = await supabase.from('weekly_actions')
      .insert({ roadmap_item_id: krId, title, week_start: nextWeek }).select().single()
    if (data) setActions(prev => [...prev, data])
  }

  async function finish() {
    setWeekStart(() => nextWeek)
    try { window.localStorage.removeItem(storageKey) } catch { /* noop */ }
    toast(`Week of ${formatWeek(closingWeek)} closed`)
    onClose()
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 60, background: 'var(--navy-900)', display: 'flex', flexDirection: 'column' }}>
      <Header step={s.step} closingWeek={closingWeek} />

      <div style={{ flex: 1, overflowY: 'auto', padding: '20px 16px 100px', maxWidth: 700, width: '100%', margin: '0 auto', boxSizing: 'border-box' }}>
        {s.step === 1 ? (
          <Step1
            habitRecap={habitRecap}
            outcomeKRs={outcomeKRs}
            objectives={objectives}
            rating={s.rating}
            win={s.win}
            slipped={s.slipped}
            adjustNotes={s.adjustNotes}
            onRating={r => patch({ rating: r })}
            onWin={v => patch({ win: v })}
            onSlipped={v => patch({ slipped: v })}
            onAdjust={v => patch({ adjustNotes: v })}
            onSetHealth={setKRHealth}
            onSetProgress={setKRProgress}
            onContinue={continueToStep2}
            advancing={advancing}
          />
        ) : (
          <Step2
            outcomeKRs={outcomeKRs}
            objectives={objectives}
            nextWeekActions={nextWeekActions}
            walkthroughIndex={s.walkthroughIndex}
            onIndex={i => patch({ walkthroughIndex: i })}
            onRemoveAction={removeAction}
            onAddActionForKR={addActionForKR}
            onFinish={finish}
            nextWeek={nextWeek}
          />
        )}
      </div>
    </div>
  )
}

// ============================================================================
// Header — step indicator, no close button (deliberate; the wizard is mandatory)
// ============================================================================
function Header({ step, closingWeek }: { step: 1 | 2; closingWeek: string }) {
  const dot = (n: 1 | 2, label: string) => {
    const active = step === n
    const done = step > n
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{
          width: 24, height: 24, borderRadius: '50%',
          background: active || done ? 'var(--accent)' : 'transparent',
          border: active || done ? 'none' : '1.5px solid var(--navy-500)',
          color: active || done ? '#fff' : 'var(--navy-400)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 12, fontWeight: 600,
        }}>
          {done ? <svg width="11" height="9" viewBox="0 0 12 9" fill="none"><path d="M1 4L4.5 7.5L11 1" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg> : n}
        </div>
        <span style={{ fontSize: 12, fontWeight: active ? 600 : 400, color: active ? 'var(--navy-50)' : 'var(--navy-400)' }}>{label}</span>
      </div>
    )
  }
  return (
    <div style={{ background: 'var(--navy-800)', borderBottom: '1px solid var(--navy-600)', padding: '12px 16px', flexShrink: 0 }}>
      <div style={{ maxWidth: 700, margin: '0 auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <div>
          <div style={{ fontSize: 11, color: 'var(--navy-400)', textTransform: 'uppercase', letterSpacing: '.5px' }}>Closing</div>
          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--navy-50)' }}>Week of {formatWeek(closingWeek)}</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {dot(1, 'Reflect')}
          <div style={{ width: 30, height: 2, background: step > 1 ? 'var(--accent)' : 'var(--navy-600)' }} />
          {dot(2, 'Plan')}
        </div>
      </div>
    </div>
  )
}

// ============================================================================
// Step 1 — Reflect
// ============================================================================
function Step1({
  habitRecap, outcomeKRs, objectives, rating, win, slipped, adjustNotes,
  onRating, onWin, onSlipped, onAdjust, onSetHealth, onSetProgress, onContinue, advancing,
}: {
  habitRecap: { kr: RoadmapItem; dots: string; label: string; labelColor: string }[]
  outcomeKRs: RoadmapItem[]
  objectives: AnnualObjective[]
  rating: ReviewRating | null
  win: string; slipped: string; adjustNotes: string
  onRating: (r: ReviewRating) => void
  onWin: (v: string) => void; onSlipped: (v: string) => void; onAdjust: (v: string) => void
  onSetHealth: (kr: RoadmapItem, h: HealthStatus) => void
  onSetProgress: (kr: RoadmapItem, p: number) => void
  onContinue: () => void
  advancing: boolean
}) {
  return (
    <>
      {habitRecap.length > 0 && (
        <Card title="Habits this week">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr auto auto', gap: '8px 14px', alignItems: 'center', fontSize: 13 }}>
            {habitRecap.map(({ kr, dots, label, labelColor }) => (
              <RowGroup key={kr.id}>
                <span style={{ color: 'var(--navy-50)' }}>{kr.title}</span>
                <span style={{ fontFamily: 'var(--font-mono, ui-monospace, monospace)', color: 'var(--navy-400)', fontSize: 12, letterSpacing: 2 }}>{dots}</span>
                <span style={{ color: labelColor, fontWeight: 600, fontSize: 12 }}>{label}</span>
              </RowGroup>
            ))}
          </div>
        </Card>
      )}

      <Field label="How was the week?">
        <div style={{ display: 'flex', gap: 8 }}>
          {RATINGS.map(r => (
            <button key={r.value} onClick={() => onRating(r.value)}
              style={{
                flex: 1, padding: '10px 12px', borderRadius: 10, border: 'none', cursor: 'pointer',
                background: rating === r.value ? r.color : 'var(--navy-700)',
                color: rating === r.value ? '#fff' : 'var(--navy-300)',
                fontSize: 13, fontWeight: 600,
              }}>
              {r.label}
            </button>
          ))}
        </div>
      </Field>

      <Field label="What was the win?">
        <textarea className="input" rows={2} value={win} onChange={e => onWin(e.target.value)}
          placeholder="Biggest thing that went right." />
      </Field>

      <Field label="What slipped?">
        <textarea className="input" rows={2} value={slipped} onChange={e => onSlipped(e.target.value)}
          placeholder="What didn't happen that should have." />
      </Field>

      <Field label="What's the adjustment?">
        <textarea className="input" rows={2} value={adjustNotes} onChange={e => onAdjust(e.target.value)}
          placeholder="One thing to change for next week." />
      </Field>

      {outcomeKRs.length > 0 && (
        <Card title="KR health & progress">
          {outcomeKRs.map(kr => {
            const obj = objectives.find(o => o.id === kr.annual_objective_id)
            return (
              <div key={kr.id} style={{ paddingBottom: 14, marginBottom: 14, borderBottom: '1px solid var(--navy-700)' }}>
                {obj && <div style={{ fontSize: 11, color: 'var(--navy-400)', marginBottom: 2 }}>{obj.name}</div>}
                <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--navy-50)', marginBottom: 8 }}>{kr.title}</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
                  {HEALTH_OPTIONS.map(opt => (
                    <button key={opt.value} onClick={() => onSetHealth(kr, opt.value)}
                      style={{
                        fontSize: 11, padding: '4px 10px', borderRadius: 99, border: 'none', cursor: 'pointer',
                        background: kr.health_status === opt.value ? opt.bg : 'var(--navy-700)',
                        color: kr.health_status === opt.value ? opt.fg : 'var(--navy-300)',
                        fontWeight: 600,
                      }}>
                      ● {opt.label}
                    </button>
                  ))}
                  <span style={{ fontSize: 11, color: 'var(--navy-400)', marginLeft: 4 }}>progress:</span>
                  {PROGRESS_OPTIONS.map(p => (
                    <button key={p} onClick={() => onSetProgress(kr, p)}
                      style={{
                        fontSize: 11, padding: '4px 8px', borderRadius: 6, border: '1px solid var(--navy-600)', cursor: 'pointer',
                        background: kr.progress === p ? 'var(--accent)' : 'transparent',
                        color: kr.progress === p ? '#fff' : 'var(--navy-300)',
                        fontWeight: kr.progress === p ? 600 : 400,
                        minWidth: 28,
                      }}>
                      {p}
                    </button>
                  ))}
                </div>
              </div>
            )
          })}
        </Card>
      )}

      <button onClick={onContinue} disabled={advancing || !rating} className="btn-primary"
        style={{ width: '100%', padding: '14px', fontSize: 14, fontWeight: 600, marginTop: 8 }}>
        {advancing ? 'Saving…' : 'Continue to plan →'}
      </button>
    </>
  )
}

// ============================================================================
// Step 2 — Plan
// ============================================================================
function Step2({
  outcomeKRs, objectives, nextWeekActions, walkthroughIndex, onIndex,
  onRemoveAction, onAddActionForKR, onFinish, nextWeek,
}: {
  outcomeKRs: RoadmapItem[]
  objectives: AnnualObjective[]
  nextWeekActions: WeeklyAction[]
  walkthroughIndex: number
  onIndex: (i: number) => void
  onRemoveAction: (id: string) => Promise<void>
  onAddActionForKR: (krId: string, title: string) => Promise<void>
  onFinish: () => void
  nextWeek: string
}) {
  const krList = outcomeKRs
  const total = krList.length
  const safeIndex = Math.min(walkthroughIndex, Math.max(0, total - 1))
  const currentKR = krList[safeIndex]
  const currentObj = currentKR ? objectives.find(o => o.id === currentKR.annual_objective_id) : null
  const currentActions = currentKR ? nextWeekActions.filter(a => a.roadmap_item_id === currentKR.id) : []
  const done = safeIndex >= total - 1

  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => { setInput(''); inputRef.current?.focus() }, [safeIndex])

  async function add() {
    if (!input.trim() || busy || !currentKR) return
    setBusy(true)
    await onAddActionForKR(currentKR.id, input.trim())
    setInput('')
    setBusy(false)
    inputRef.current?.focus()
  }

  function next() {
    if (done) onFinish()
    else onIndex(safeIndex + 1)
  }

  return (
    <>
      <Card title="Already on next week's list">
        {nextWeekActions.length === 0 ? (
          <div style={{ fontSize: 12, color: 'var(--navy-400)' }}>Nothing yet — add actions per KR below.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {nextWeekActions.map(a => (
              <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', background: 'var(--navy-700)', border: '1px solid var(--navy-600)', borderRadius: 8 }}>
                {a.is_recurring && <Badge bg="var(--accent-dim)" fg="var(--accent)">↻ weekly</Badge>}
                {a.carried_over && <Badge bg="var(--amber-bg)" fg="var(--amber-text)">carried</Badge>}
                <span style={{ fontSize: 12, color: 'var(--navy-50)', flex: 1 }}>{a.title}</span>
                <button onClick={() => onRemoveAction(a.id)} title="Remove"
                  style={{ background: 'none', border: 'none', color: 'var(--navy-400)', fontSize: 16, cursor: 'pointer', padding: '0 4px' }}>×</button>
              </div>
            ))}
          </div>
        )}
      </Card>

      {total === 0 ? (
        <div style={{ background: 'var(--navy-800)', border: '1px solid var(--navy-600)', borderRadius: 14, padding: 20, textAlign: 'center', marginBottom: 16 }}>
          <div style={{ fontSize: 13, color: 'var(--navy-300)', lineHeight: 1.6 }}>
            No outcome KRs to walk through. Add some on the Roadmap tab when you're ready.
          </div>
        </div>
      ) : (
        <Card title={`Walking through KRs — ${safeIndex + 1} of ${total}`}>
          <div style={{ height: 3, background: 'var(--navy-600)', borderRadius: 2, marginBottom: 14 }}>
            <div style={{ width: `${((safeIndex + 1) / total) * 100}%`, height: 3, background: 'var(--accent)', borderRadius: 2, transition: 'width .2s' }} />
          </div>

          {currentKR && (
            <>
              {currentObj && <div style={{ fontSize: 11, color: 'var(--navy-400)', marginBottom: 4 }}>{currentObj.name}</div>}
              <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--navy-50)', marginBottom: 12 }}>{currentKR.title}</div>

              {currentActions.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 10 }}>
                  {currentActions.map(a => (
                    <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', background: 'var(--navy-700)', border: '1px solid var(--navy-600)', borderRadius: 8 }}>
                      <div style={{ width: 14, height: 14, borderRadius: '50%', border: '1.5px solid var(--navy-400)', flexShrink: 0 }} />
                      <span style={{ fontSize: 12, color: 'var(--navy-50)', flex: 1 }}>{a.title}</span>
                      <button onClick={() => onRemoveAction(a.id)} style={{ background: 'none', border: 'none', color: 'var(--navy-400)', fontSize: 14, cursor: 'pointer' }}>×</button>
                    </div>
                  ))}
                </div>
              )}

              <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
                <input ref={inputRef} value={input} onChange={e => setInput(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add() } }}
                  className="input" style={{ flex: 1, fontSize: 13 }}
                  placeholder="What are you doing for this KR?" />
                <button onClick={add} disabled={!input.trim() || busy} className="btn-primary"
                  style={{ fontSize: 13, padding: '0 14px' }}>{busy ? '…' : 'Add'}</button>
              </div>

              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={next}
                  style={{ flex: 1, padding: 11, borderRadius: 10, border: '1px solid var(--navy-600)', background: 'var(--navy-700)', color: 'var(--navy-300)', fontSize: 12, cursor: 'pointer' }}>
                  Skip — nothing this week
                </button>
                <button onClick={next} className="btn-primary" style={{ flex: 1, padding: 11, fontSize: 12, fontWeight: 600 }}>
                  {done ? 'Finish →' : 'Next KR →'}
                </button>
              </div>
            </>
          )}
        </Card>
      )}

      <button onClick={onFinish} className="btn-primary"
        style={{ width: '100%', padding: '14px', fontSize: 14, fontWeight: 600, marginTop: 8 }}>
        Done — start week of {formatWeek(nextWeek)} →
      </button>
    </>
  )
}

// ============================================================================
// Tiny helpers
// ============================================================================
function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ background: 'var(--navy-800)', border: '1px solid var(--navy-600)', borderRadius: 14, padding: '14px 16px', marginBottom: 14 }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--navy-400)', textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 12 }}>{title}</div>
      {children}
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--navy-200)', marginBottom: 6 }}>{label}</div>
      {children}
    </div>
  )
}

function Badge({ bg, fg, children }: { bg: string; fg: string; children: React.ReactNode }) {
  return <span style={{ fontSize: 9, padding: '1px 6px', borderRadius: 99, background: bg, color: fg, fontWeight: 700, flexShrink: 0 }}>{children}</span>
}

// CSS Grid contents wrapper so the three columns stay aligned across rows.
function RowGroup({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
