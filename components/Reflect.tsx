'use client'
import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import { AnnualObjective, RoadmapItem, QuarterlyKR, DailyCheckin, WeeklyReview, CheckinStatus, ReviewRating } from '@/lib/types'
import { ACTIVE_Q, formatWeek, formatDate } from '@/lib/utils'
import StatusPill from './StatusPill'

interface Props {
  objectives: AnnualObjective[]
  roadmapItems: RoadmapItem[]
  krs: QuarterlyKR[]
  setKrs: (fn: (p: QuarterlyKR[]) => QuarterlyKR[]) => void
  checkins: DailyCheckin[]
  setCheckins: (fn: (p: DailyCheckin[]) => DailyCheckin[]) => void
  reviews: WeeklyReview[]
  setReviews: (fn: (p: WeeklyReview[]) => WeeklyReview[]) => void
  weekStart: string
  toast: (m: string) => void
}

type SubTab = 'checkin' | 'review' | 'history'

export default function Reflect({ objectives, roadmapItems, krs, setKrs, checkins, setCheckins, reviews, setReviews, weekStart, toast }: Props) {
  const [sub, setSub] = useState<SubTab>('checkin')

  const TABS: { id: SubTab; label: string }[] = [
    { id: 'checkin', label: 'Daily check-in' },
    { id: 'review',  label: 'Week review' },
    { id: 'history', label: 'Look back' },
  ]

  return (
    <div>
      <h1 style={{ fontSize: 18, fontWeight: 700, color: 'var(--navy-50)', marginBottom: 3 }}>Reflect</h1>
      <p style={{ fontSize: 12, color: 'var(--navy-300)', marginBottom: 18 }}>Check in · Review · History</p>

      {/* Sub-tabs */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
        {TABS.map(t => (
          <button key={t.id} onClick={() => setSub(t.id)}
            className="sub-tab-btn"
            style={sub === t.id
              ? { background: 'var(--accent)', color: '#fff' }
              : { background: 'var(--navy-700)', color: 'var(--navy-200)', border: '1px solid var(--navy-500)' }}>
            {t.label}
          </button>
        ))}
      </div>

      {sub === 'checkin' && <CheckinView objectives={objectives} roadmapItems={roadmapItems} krs={krs} setKrs={setKrs} checkins={checkins} setCheckins={setCheckins} toast={toast} />}
      {sub === 'review'  && <ReviewView objectives={objectives} roadmapItems={roadmapItems} krs={krs} reviews={reviews} setReviews={setReviews} weekStart={weekStart} toast={toast} />}
      {sub === 'history' && <HistoryView reviews={reviews} />}
    </div>
  )
}

function CheckinView({ objectives, roadmapItems, krs, setKrs, checkins, setCheckins, toast }: Omit<Props, 'reviews' | 'setReviews' | 'weekStart'>) {
  const today = new Date().toISOString().slice(0, 10)
  const activeItems = roadmapItems.filter(i => i.quarter === ACTIVE_Q && i.status !== 'abandoned' && !i.is_parked)
  const allKrs = krs.filter(k => activeItems.some(i => i.id === k.roadmap_item_id))
  const pinned = allKrs.filter(k => k.pinned_to_checkin)
  const display = pinned.length ? pinned : allKrs.slice(0, 6)
  const todayCheckins = checkins.filter(c => c.checkin_date === today)

  async function setStatus(krId: string, status: CheckinStatus) {
    const ex = todayCheckins.find(c => c.quarterly_kr_id === krId)
    if (ex) {
      await supabase.from('daily_checkins').update({ status }).eq('id', ex.id)
      setCheckins(prev => prev.map(c => c.id === ex.id ? { ...c, status } : c))
    } else {
      const { data } = await supabase.from('daily_checkins').insert({ checkin_date: today, quarterly_kr_id: krId, status }).select().single()
      if (data) setCheckins(prev => [...prev, data])
    }
  }

  async function togglePin(kr: QuarterlyKR) {
    const next = !kr.pinned_to_checkin
    await supabase.from('quarterly_krs').update({ pinned_to_checkin: next }).eq('id', kr.id)
    setKrs(prev => prev.map(k => k.id === kr.id ? { ...k, pinned_to_checkin: next } : k))
  }

  const STATUS_CONFIG = [
    { value: 'on_track'  as CheckinStatus, label: 'On track',  active: 'var(--teal)',  text: '#fff' },
    { value: 'off_track' as CheckinStatus, label: 'Off track', active: 'var(--red)',   text: '#fff' },
    { value: 'blocked'   as CheckinStatus, label: 'Blocked',   active: 'var(--amber)', text: '#fff' },
  ]

  return (
    <div>
      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--navy-400)', marginBottom: 14, textTransform: 'uppercase', letterSpacing: '.5px' }}>{formatDate(today)}</div>

      {display.map(kr => {
        const item = roadmapItems.find(i => i.id === kr.roadmap_item_id)
        const obj = objectives.find(o => o.id === item?.annual_objective_id)
        const current = todayCheckins.find(c => c.quarterly_kr_id === kr.id)?.status

        return (
          <div key={kr.id} style={{ background: 'var(--navy-700)', border: '1px solid var(--navy-600)', borderRadius: 16, marginBottom: 12, overflow: 'hidden', borderLeft: `4px solid ${obj?.color ?? 'var(--accent)'}` }}>
            <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--navy-600)' }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--navy-300)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '.4px' }}>{obj?.name}</div>
              <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--navy-50)', lineHeight: 1.4 }}>{kr.title}</div>
            </div>
            <div style={{ padding: '12px 14px', display: 'flex', gap: 8 }}>
              {STATUS_CONFIG.map(s => (
                <button key={s.value}
                  className="status-btn"
                  onClick={() => setStatus(kr.id, s.value)}
                  style={current === s.value
                    ? { background: s.active, color: s.text, border: `1px solid ${s.active}` }
                    : { background: 'var(--navy-800)', color: 'var(--navy-300)', border: '1px solid var(--navy-500)' }}>
                  {s.label}
                </button>
              ))}
            </div>
          </div>
        )
      })}

      {allKrs.length > 0 && (
        <div style={{ background: 'var(--navy-700)', border: '1px solid var(--navy-600)', borderRadius: 16, padding: '14px 16px', marginTop: 8 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--navy-300)', marginBottom: 12, textTransform: 'uppercase', letterSpacing: '.5px' }}>Pin KRs to daily check-in</div>
          {allKrs.map(kr => (
            <label key={kr.id} style={{ display: 'flex', alignItems: 'center', gap: 12, minHeight: 44, cursor: 'pointer', padding: '4px 0', borderBottom: '1px solid var(--navy-600)' }}>
              <input type="checkbox" checked={!!kr.pinned_to_checkin} onChange={() => togglePin(kr)}
                style={{ accentColor: 'var(--accent)', width: 18, height: 18, flexShrink: 0, cursor: 'pointer' }} />
              <span style={{ fontSize: 13, color: 'var(--navy-200)', lineHeight: 1.35 }}>{kr.title}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  )
}

function ReviewView({ objectives, roadmapItems, krs, reviews, setReviews, weekStart, toast }: Omit<Props, 'checkins' | 'setCheckins' | 'setKrs'>) {
  const activeItems = roadmapItems.filter(i => i.quarter === ACTIVE_Q && !i.is_parked)
  const allKrs = krs.filter(k => activeItems.some(i => i.id === k.roadmap_item_id))
  const existing = reviews.find(r => r.week_start === weekStart)
  const [rv, setRv] = useState({
    rating: existing?.rating ?? 'steady' as ReviewRating,
    win: existing?.win ?? '',
    slipped: existing?.slipped ?? '',
    adjust_notes: existing?.adjust_notes ?? '',
  })

  async function save() {
    const krsHit = allKrs.filter(k => k.status === 'on_track' || k.status === 'done').length
    const payload = { week_start: weekStart, ...rv, krs_hit: krsHit, krs_total: allKrs.length }
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
      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--navy-400)', marginBottom: 16, textTransform: 'uppercase', letterSpacing: '.5px' }}>Week of {formatWeek(weekStart)}</div>

      <div style={{ background: 'var(--navy-700)', border: '1px solid var(--navy-600)', borderRadius: 16, overflow: 'hidden', marginBottom: 14 }}>
        <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--navy-600)' }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--navy-300)', marginBottom: 12, textTransform: 'uppercase', letterSpacing: '.5px' }}>How did the week go?</div>
          <div style={{ display: 'flex', gap: 8 }}>
            {RATINGS.map(r => (
              <button key={r.value} onClick={() => setRv(d => ({ ...d, rating: r.value }))}
                className="status-btn"
                style={rv.rating === r.value
                  ? { background: r.color, color: '#fff', border: `1px solid ${r.color}`, flex: 1 }
                  : { background: 'var(--navy-800)', color: 'var(--navy-300)', border: '1px solid var(--navy-500)', flex: 1 }}>
                {r.label}
              </button>
            ))}
          </div>
        </div>

        {FIELDS.map(({ key, label, placeholder }, i) => (
          <div key={key} style={{ padding: '14px 16px', borderBottom: i < FIELDS.length - 1 ? '1px solid var(--navy-600)' : 'none' }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--navy-300)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '.5px' }}>{label}</div>
            <textarea rows={2} placeholder={placeholder} value={rv[key] as string}
              onChange={e => setRv(d => ({ ...d, [key]: e.target.value }))}
              className="input" style={{ resize: 'none' }} />
          </div>
        ))}
      </div>

      <button onClick={save} className="btn-primary" style={{ width: '100%', fontSize: 15 }}>
        Save week review
      </button>
    </div>
  )
}

function HistoryView({ reviews }: { reviews: WeeklyReview[] }) {
  if (!reviews.length) return (
    <div style={{ textAlign: 'center', padding: '48px 0', color: 'var(--navy-400)', fontSize: 14 }}>
      <div style={{ fontSize: 36, marginBottom: 10 }}>📚</div>
      No reviews yet. Close out your week in the Week review tab.
    </div>
  )

  return (
    <div>
      {reviews.map(r => (
        <div key={r.id} style={{ background: 'var(--navy-700)', border: '1px solid var(--navy-600)', borderRadius: 16, padding: '14px 16px', marginBottom: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: r.win || r.slipped ? 10 : 0 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--navy-50)' }}>Week of {formatWeek(r.week_start)}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--teal-text)' }}>{r.krs_hit}/{r.krs_total} KRs</span>
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
