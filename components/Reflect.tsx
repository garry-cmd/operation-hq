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

  const tabStyle = (t: SubTab): React.CSSProperties => sub === t
    ? { background: 'var(--accent)', color: '#fff', border: 'none' }
    : { background: 'var(--navy-700)', color: 'var(--navy-300)', border: '1px solid var(--navy-600)' }

  return (
    <div>
      <h1 style={{ fontSize: 16, fontWeight: 700, color: 'var(--navy-50)', marginBottom: 4 }}>Reflect</h1>
      <p style={{ fontSize: 11, color: 'var(--navy-400)', marginBottom: 16 }}>Check in · Week review · Look back</p>

      <div style={{ display: 'flex', gap: 8, marginBottom: 18 }}>
        {(['checkin', 'review', 'history'] as SubTab[]).map(t => (
          <button key={t} onClick={() => setSub(t)}
            style={{ fontSize: 12, fontWeight: 600, padding: '6px 16px', borderRadius: 99, cursor: 'pointer', transition: 'all .15s', ...tabStyle(t) }}>
            {t === 'checkin' ? 'Daily check-in' : t === 'review' ? 'Week review' : 'Look back'}
          </button>
        ))}
      </div>

      {sub === 'checkin' && <CheckinView objectives={objectives} roadmapItems={roadmapItems} krs={krs} setKrs={setKrs} checkins={checkins} setCheckins={setCheckins} toast={toast} />}
      {sub === 'review' && <ReviewView objectives={objectives} roadmapItems={roadmapItems} krs={krs} reviews={reviews} setReviews={setReviews} weekStart={weekStart} toast={toast} />}
      {sub === 'history' && <HistoryView reviews={reviews} />}
    </div>
  )
}

function CheckinView({ objectives, roadmapItems, krs, setKrs, checkins, setCheckins, toast }: Omit<Props, 'reviews' | 'setReviews' | 'weekStart'>) {
  const today = new Date().toISOString().slice(0, 10)
  const activeItems = roadmapItems.filter(i => i.quarter === ACTIVE_Q && i.status !== 'abandoned' && !i.is_parked)
  const allKrs = krs.filter(k => activeItems.some(i => i.id === k.roadmap_item_id))
  const pinned = allKrs.filter(k => k.pinned_to_checkin)
  const display = pinned.length ? pinned : allKrs.slice(0, 5)
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

  const btnStyle = (sel: boolean, color: string, bg: string): React.CSSProperties => sel
    ? { background: bg, border: `1px solid ${bg}`, color }
    : { background: 'var(--navy-800)', border: '1px solid var(--navy-500)', color: 'var(--navy-300)' }

  return (
    <div>
      <div style={{ fontSize: 11, color: 'var(--navy-400)', marginBottom: 12 }}>{formatDate(today)}</div>
      {display.map(kr => {
        const item = roadmapItems.find(i => i.id === kr.roadmap_item_id)
        const obj = objectives.find(o => o.id === item?.annual_objective_id)
        const current = todayCheckins.find(c => c.quarterly_kr_id === kr.id)?.status
        return (
          <div key={kr.id} style={{ background: 'var(--navy-700)', border: '1px solid var(--navy-600)', borderRadius: 14, padding: 14, marginBottom: 10 }}>
            <div style={{ fontSize: 10, color: 'var(--navy-400)', marginBottom: 3 }}>{obj?.name} ↑</div>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--navy-50)', marginBottom: 10, lineHeight: 1.4 }}>{kr.title}</div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {(['on_track', 'off_track', 'blocked'] as CheckinStatus[]).map(s => (
                <button key={s} onClick={() => setStatus(kr.id, s)}
                  style={{ fontSize: 12, fontWeight: 600, padding: '6px 14px', borderRadius: 99, cursor: 'pointer', transition: 'all .12s', ...btnStyle(current === s, '#fff', s === 'on_track' ? 'var(--teal)' : s === 'off_track' ? 'var(--red)' : 'var(--amber)') }}>
                  {s === 'on_track' ? 'On track' : s === 'off_track' ? 'Off track' : 'Blocked'}
                </button>
              ))}
            </div>
          </div>
        )
      })}
      <div style={{ background: 'var(--navy-700)', border: '1px solid var(--navy-600)', borderRadius: 14, padding: 14, marginTop: 6 }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--navy-300)', marginBottom: 10 }}>Pin KRs to daily check-in</div>
        {allKrs.map(kr => (
          <label key={kr.id} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8, cursor: 'pointer' }}>
            <input type="checkbox" checked={kr.pinned_to_checkin} onChange={() => togglePin(kr)} style={{ accentColor: 'var(--accent)', width: 16, height: 16 }} />
            <span style={{ fontSize: 12, color: 'var(--navy-300)' }}>{kr.title}</span>
          </label>
        ))}
      </div>
    </div>
  )
}

function ReviewView({ objectives, roadmapItems, krs, reviews, setReviews, weekStart, toast }: Omit<Props, 'checkins' | 'setCheckins' | 'setKrs'>) {
  const activeItems = roadmapItems.filter(i => i.quarter === ACTIVE_Q && !i.is_parked)
  const allKrs = krs.filter(k => activeItems.some(i => i.id === k.roadmap_item_id))
  const existing = reviews.find(r => r.week_start === weekStart)
  const [rv, setRv] = useState({ rating: existing?.rating ?? 'steady' as ReviewRating, win: existing?.win ?? '', slipped: existing?.slipped ?? '', adjust_notes: existing?.adjust_notes ?? '' })

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

  const ratingBtn = (r: ReviewRating, label: string, color: string): React.CSSProperties => rv.rating === r
    ? { background: color, border: `1px solid ${color}`, color: '#fff' }
    : { background: 'var(--navy-700)', border: '1px solid var(--navy-600)', color: 'var(--navy-300)' }

  return (
    <div>
      <div style={{ fontSize: 11, color: 'var(--navy-400)', marginBottom: 14 }}>Week of {formatWeek(weekStart)}</div>
      <div style={{ background: 'var(--navy-700)', border: '1px solid var(--navy-600)', borderRadius: 14, overflow: 'hidden', marginBottom: 12 }}>
        <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--navy-600)' }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--navy-300)', marginBottom: 10 }}>How did the week go?</div>
          <div style={{ display: 'flex', gap: 8 }}>
            {([['strong', 'Strong', 'var(--teal)'], ['steady', 'Steady', 'var(--amber)'], ['rough', 'Rough', 'var(--red)']] as [ReviewRating, string, string][]).map(([r, l, c]) => (
              <button key={r} onClick={() => setRv(d => ({ ...d, rating: r }))}
                style={{ fontSize: 12, fontWeight: 600, padding: '6px 16px', borderRadius: 99, cursor: 'pointer', transition: 'all .12s', ...ratingBtn(r, l, c) }}>{l}</button>
            ))}
          </div>
        </div>
        {[['Win of the week', 'win', 'What moved the needle?'], ['What slipped?', 'slipped', 'One honest line…'], ['Adjust for next week?', 'adjust_notes', 'Drop a KR, shift a deadline…']].map(([label, field, ph]) => (
          <div key={field} style={{ padding: '12px 14px', borderBottom: '1px solid var(--navy-600)' }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--navy-300)', marginBottom: 8 }}>{label}</div>
            <textarea rows={2} placeholder={ph} value={rv[field as keyof typeof rv] as string}
              onChange={e => setRv(d => ({ ...d, [field]: e.target.value }))}
              style={{ width: '100%', background: 'var(--navy-800)', border: '1px solid var(--navy-500)', borderRadius: 8, padding: '8px 10px', fontSize: 13, color: 'var(--navy-50)', fontFamily: 'inherit', resize: 'none', outline: 'none' }} />
          </div>
        ))}
      </div>
      <button onClick={save} style={{ width: '100%', padding: 14, background: 'var(--accent)', color: '#fff', fontSize: 14, fontWeight: 700, border: 'none', borderRadius: 14, cursor: 'pointer' }}>
        Save review
      </button>
    </div>
  )
}

function HistoryView({ reviews }: { reviews: WeeklyReview[] }) {
  return (
    <div>
      {reviews.length === 0 && (
        <div style={{ textAlign: 'center', padding: '48px 0', color: 'var(--navy-500)', fontSize: 13 }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>📚</div>
          No reviews yet. Close out a week in the Week review tab.
        </div>
      )}
      {reviews.map(r => (
        <div key={r.id} style={{ background: 'var(--navy-700)', border: '1px solid var(--navy-600)', borderRadius: 14, padding: 14, marginBottom: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--navy-50)' }}>Week of {formatWeek(r.week_start)}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--teal-text)' }}>{r.krs_hit}/{r.krs_total} KRs</span>
              <StatusPill status={r.rating} />
            </div>
          </div>
          {r.win && <div style={{ fontSize: 12, color: 'var(--navy-300)', marginBottom: 4 }}><span style={{ color: 'var(--navy-500)', fontSize: 10 }}>WIN  </span>{r.win}</div>}
          {r.slipped && <div style={{ fontSize: 12, color: 'var(--navy-300)' }}><span style={{ color: 'var(--navy-500)', fontSize: 10 }}>SLIPPED  </span>{r.slipped}</div>}
        </div>
      ))}
    </div>
  )
}
