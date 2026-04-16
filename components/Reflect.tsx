'use client'
import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import { AnnualObjective, RoadmapItem, DailyCheckin, WeeklyReview, CheckinStatus, ReviewRating } from '@/lib/types'
import { ACTIVE_Q, formatWeek, formatDate } from '@/lib/utils'
import StatusPill from './StatusPill'

type Props = {
  objectives: AnnualObjective[]
  roadmapItems: RoadmapItem[]
  setRoadmapItems: (fn: (p: RoadmapItem[]) => RoadmapItem[]) => void
  checkins: DailyCheckin[]
  setCheckins: (fn: (p: DailyCheckin[]) => DailyCheckin[]) => void
  reviews: WeeklyReview[]
  setReviews: (fn: (p: WeeklyReview[]) => WeeklyReview[]) => void
  weekStart: string
  toast: (m: string) => void
}

type Sub = 'checkin' | 'progress' | 'review' | 'history'

export default function Reflect({ objectives, roadmapItems, setRoadmapItems, checkins, setCheckins, reviews, setReviews, weekStart, toast }: Props) {
  const [sub, setSub] = useState<Sub>('checkin')
  const TABS: { id: Sub; label: string }[] = [
    { id: 'checkin',  label: 'Check-in' },
    { id: 'progress', label: 'Progress' },
    { id: 'review',   label: 'Review' },
    { id: 'history',  label: 'History' },
  ]

  return (
    <div>
      <h1 style={{ fontSize: 18, fontWeight: 700, color: 'var(--navy-50)', marginBottom: 3 }}>Reflect</h1>
      <p style={{ fontSize: 12, color: 'var(--navy-300)', marginBottom: 18 }}>Check in · Progress · Review · History</p>
      <div style={{ display: 'flex', gap: 7, marginBottom: 20, flexWrap: 'wrap' }}>
        {TABS.map(t => (
          <button key={t.id} onClick={() => setSub(t.id)} className="sub-tab-btn"
            style={sub === t.id
              ? { background: 'var(--accent)', color: '#fff' }
              : { background: 'var(--navy-700)', color: 'var(--navy-200)', border: '1px solid var(--navy-500)' }}>
            {t.label}
          </button>
        ))}
      </div>
      {sub === 'checkin'  && <CheckinView  objectives={objectives} roadmapItems={roadmapItems} checkins={checkins} setCheckins={setCheckins} />}
      {sub === 'progress' && <ProgressView objectives={objectives} roadmapItems={roadmapItems} setRoadmapItems={setRoadmapItems} toast={toast} />}
      {sub === 'review'   && <ReviewView   reviews={reviews} setReviews={setReviews} roadmapItems={roadmapItems} weekStart={weekStart} toast={toast} />}
      {sub === 'history'  && <HistoryView  reviews={reviews} />}
    </div>
  )
}

/* ── Check-in ── */
function CheckinView({ objectives, roadmapItems, checkins, setCheckins }: Pick<Props, 'objectives' | 'roadmapItems' | 'checkins' | 'setCheckins'>) {
  const today = new Date().toISOString().slice(0, 10)
  const activeKRs = roadmapItems.filter(i => !i.is_parked && i.status !== 'abandoned' && i.status !== 'done')
  const todayCheckins = checkins.filter(c => c.checkin_date === today)

  async function setStatus(krId: string, status: CheckinStatus) {
    const ex = todayCheckins.find(c => c.roadmap_item_id === krId)
    if (ex) {
      await supabase.from('daily_checkins').update({ status }).eq('id', ex.id)
      setCheckins(prev => prev.map(c => c.id === ex.id ? { ...c, status } : c))
    } else {
      const { data } = await supabase.from('daily_checkins').insert({ checkin_date: today, roadmap_item_id: krId, status }).select().single()
      if (data) setCheckins(prev => [...prev, data])
    }
  }

  const STATUS_CFG = [
    { value: 'on_track' as CheckinStatus, label: 'On track', bg: 'var(--teal)', color: '#fff', inactiveBg: 'var(--navy-700)', inactiveColor: 'var(--navy-300)' },
    { value: 'off_track' as CheckinStatus, label: 'Off track', bg: 'var(--red)', color: '#fff', inactiveBg: 'var(--navy-700)', inactiveColor: 'var(--navy-300)' },
    { value: 'blocked' as CheckinStatus, label: 'Blocked', bg: 'var(--amber)', color: '#fff', inactiveBg: 'var(--navy-700)', inactiveColor: 'var(--navy-300)' },
  ]

  return (
    <div>
      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--navy-400)', marginBottom: 14, textTransform: 'uppercase', letterSpacing: '.5px' }}>{formatDate(today)}</div>
      {activeKRs.length === 0 && <div style={{ color: 'var(--navy-400)', fontSize: 14, textAlign: 'center', padding: '32px 0' }}>No active key results to check in on.</div>}
      {activeKRs.map(kr => {
        const obj = objectives.find(o => o.id === kr.annual_objective_id)
        const current = todayCheckins.find(c => c.roadmap_item_id === kr.id)?.status
        return (
          <div key={kr.id} style={{ background: 'var(--navy-700)', border: '1px solid var(--navy-600)', borderRadius: 16, marginBottom: 10, overflow: 'hidden', borderLeft: `4px solid ${obj?.color ?? 'var(--accent)'}` }}>
            <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--navy-600)' }}>
              <div style={{ fontSize: 11, color: 'var(--navy-300)', marginBottom: 3, textTransform: 'uppercase', letterSpacing: '.4px' }}>{obj?.name}</div>
              <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--navy-50)', lineHeight: 1.4 }}>{kr.title}</div>
            </div>
            <div style={{ padding: '11px 13px', display: 'flex', gap: 8 }}>
              {STATUS_CFG.map(s => (
                <button key={s.value} className="status-btn" onClick={() => setStatus(kr.id, s.value)}
                  style={current === s.value
                    ? { background: s.bg, color: s.color, border: `1px solid ${s.bg}` }
                    : { background: s.inactiveBg, color: s.inactiveColor, border: '1px solid var(--navy-500)' }}>
                  {s.label}
                </button>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}

/* ── Progress ── */
function ProgressView({ objectives, roadmapItems, setRoadmapItems, toast }: Pick<Props, 'objectives' | 'roadmapItems' | 'setRoadmapItems' | 'toast'>) {
  const activeKRs = roadmapItems.filter(i => !i.is_parked && i.status !== 'abandoned' && i.status !== 'done')
  const PCT_OPTS = [0, 25, 50, 75, 100]

  async function setPct(kr: RoadmapItem, pct: number) {
    await supabase.from('roadmap_items').update({ progress: pct }).eq('id', kr.id)
    setRoadmapItems(prev => prev.map(i => i.id === kr.id ? { ...i, progress: pct } : i))
  }

  return (
    <div>
      <div style={{ fontSize: 12, color: 'var(--navy-400)', marginBottom: 16, lineHeight: 1.6 }}>
        Update how far along you are on each key result. This feeds the progress bar on the OKRs screen.
      </div>
      {activeKRs.length === 0 && <div style={{ color: 'var(--navy-400)', fontSize: 14, textAlign: 'center', padding: '32px 0' }}>No active key results.</div>}
      {activeKRs.map(kr => {
        const obj = objectives.find(o => o.id === kr.annual_objective_id)
        const pct = kr.progress ?? 0
        return (
          <div key={kr.id} style={{ background: 'var(--navy-700)', border: '1px solid var(--navy-600)', borderRadius: 16, marginBottom: 10, overflow: 'hidden', borderLeft: `4px solid ${obj?.color ?? 'var(--accent)'}` }}>
            <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--navy-600)' }}>
              <div style={{ fontSize: 11, color: 'var(--navy-300)', marginBottom: 3, textTransform: 'uppercase', letterSpacing: '.4px' }}>{obj?.name}</div>
              <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--navy-50)', lineHeight: 1.4 }}>{kr.title}</div>
            </div>
            <div style={{ padding: '12px 14px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                <span style={{ fontSize: 12, color: 'var(--navy-400)' }}>How far along?</span>
                <span style={{ fontSize: 20, fontWeight: 700, color: 'var(--accent)' }}>{pct}%</span>
              </div>
              <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
                {PCT_OPTS.map(p => (
                  <button key={p} onClick={() => setPct(kr, p)}
                    style={{ flex: 1, padding: '8px 0', fontSize: 11, fontWeight: 700, borderRadius: 9, border: `1.5px solid ${pct === p ? obj?.color ?? 'var(--accent)' : 'var(--navy-500)'}`, background: pct === p ? obj?.color ?? 'var(--accent)' : 'var(--navy-800)', color: pct === p ? '#fff' : 'var(--navy-400)', cursor: 'pointer', transition: 'all .12s', textAlign: 'center' }}>
                    {p === 100 ? '✓' : p}
                  </button>
                ))}
              </div>
              <div style={{ height: 4, background: 'var(--navy-600)', borderRadius: 2 }}>
                <div style={{ height: 4, borderRadius: 2, background: obj?.color ?? 'var(--accent)', width: `${pct}%`, transition: 'width .3s' }} />
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

/* ── Review ── */
function ReviewView({ reviews, setReviews, roadmapItems, weekStart, toast }: Pick<Props, 'reviews' | 'setReviews' | 'roadmapItems' | 'weekStart' | 'toast'>) {
  const existing = reviews.find(r => r.week_start === weekStart)
  const [rv, setRv] = useState({ rating: existing?.rating ?? 'steady' as ReviewRating, win: existing?.win ?? '', slipped: existing?.slipped ?? '', adjust_notes: existing?.adjust_notes ?? '' })
  const activeKRs = roadmapItems.filter(i => !i.is_parked && i.status !== 'abandoned' && i.status !== 'done')

  async function save() {
    const onTrack = activeKRs.filter(k => k.health_status === 'on_track' || k.health_status === 'done').length
    const payload = { week_start: weekStart, ...rv, krs_hit: onTrack, krs_total: activeKRs.length }
    if (existing) {
      await supabase.from('weekly_reviews').update(payload).eq('id', existing.id)
      setReviews(prev => prev.map(r => r.id === existing.id ? { ...r, ...payload } : r))
    } else {
      const { data } = await supabase.from('weekly_reviews').insert(payload).select().single()
      if (data) setReviews(prev => [data, ...prev])
    }
    toast('Review saved!')
  }

  const RATINGS: { value: ReviewRating; label: string; color: string }[] = [
    { value: 'strong', label: '💪 Strong', color: 'var(--teal)' },
    { value: 'steady', label: '⚖️ Steady', color: 'var(--amber)' },
    { value: 'rough',  label: '😤 Rough',  color: 'var(--red)' },
  ]
  const FIELDS: { key: keyof typeof rv; label: string; placeholder: string }[] = [
    { key: 'win',          label: 'Win of the week',       placeholder: 'What moved the needle?' },
    { key: 'slipped',      label: 'What slipped?',         placeholder: 'One honest line…' },
    { key: 'adjust_notes', label: 'Adjust for next week?', placeholder: 'Drop a KR, shift a deadline…' },
  ]

  return (
    <div>
      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--navy-400)', marginBottom: 14, textTransform: 'uppercase', letterSpacing: '.5px' }}>Week of {formatWeek(weekStart)}</div>
      <div style={{ background: 'var(--navy-700)', border: '1px solid var(--navy-600)', borderRadius: 16, overflow: 'hidden', marginBottom: 12 }}>
        <div style={{ padding: '13px 14px', borderBottom: '1px solid var(--navy-600)' }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--navy-300)', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '.5px' }}>How did the week go?</div>
          <div style={{ display: 'flex', gap: 8 }}>
            {RATINGS.map(r => (
              <button key={r.value} onClick={() => setRv(d => ({ ...d, rating: r.value }))} className="status-btn"
                style={{ flex: 1, ...(rv.rating === r.value ? { background: r.color, color: '#fff', border: `1px solid ${r.color}` } : { background: 'var(--navy-800)', color: 'var(--navy-300)', border: '1px solid var(--navy-500)' }) }}>
                {r.label}
              </button>
            ))}
          </div>
        </div>
        {FIELDS.map(({ key, label, placeholder }, i) => (
          <div key={key} style={{ padding: '13px 14px', borderBottom: i < FIELDS.length - 1 ? '1px solid var(--navy-600)' : 'none' }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--navy-300)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '.5px' }}>{label}</div>
            <textarea rows={2} placeholder={placeholder} value={rv[key] as string}
              onChange={e => setRv(d => ({ ...d, [key]: e.target.value }))}
              className="input" style={{ resize: 'none' }} />
          </div>
        ))}
      </div>
      <button onClick={save} className="btn-primary" style={{ width: '100%', fontSize: 15 }}>Save week review</button>
    </div>
  )
}

/* ── History ── */
function HistoryView({ reviews }: Pick<Props, 'reviews'>) {
  if (!reviews.length) return (
    <div style={{ textAlign: 'center', padding: '48px 0', color: 'var(--navy-400)', fontSize: 14 }}>
      <div style={{ fontSize: 32, marginBottom: 8 }}>📚</div>
      No reviews yet. Close out your week in the Review tab.
    </div>
  )
  return (
    <div>
      {reviews.map(r => (
        <div key={r.id} style={{ background: 'var(--navy-700)', border: '1px solid var(--navy-600)', borderRadius: 14, padding: '13px 14px', marginBottom: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: r.win || r.slipped ? 9 : 0 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--navy-50)' }}>Week of {formatWeek(r.week_start)}</div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--teal-text)' }}>{r.krs_hit}/{r.krs_total} on track</span>
              <StatusPill status={r.rating} />
            </div>
          </div>
          {r.win     && <div style={{ fontSize: 13, color: 'var(--navy-200)', marginBottom: 4 }}><span style={{ fontSize: 10, fontWeight: 700, color: 'var(--navy-400)', marginRight: 6 }}>WIN</span>{r.win}</div>}
          {r.slipped && <div style={{ fontSize: 13, color: 'var(--navy-200)' }}><span style={{ fontSize: 10, fontWeight: 700, color: 'var(--navy-400)', marginRight: 6 }}>SLIPPED</span>{r.slipped}</div>}
        </div>
      ))}
    </div>
  )
}
