'use client'
import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import { AnnualObjective, RoadmapItem, QuarterlyKR, DailyCheckin, WeeklyReview, CheckinStatus, ReviewRating } from '@/lib/types'
import { ACTIVE_Q, formatWeek, formatDate } from '@/lib/utils'

interface Props {
  objectives: AnnualObjective[]; roadmapItems: RoadmapItem[]
  krs: QuarterlyKR[]; setKrs: (fn: (p: QuarterlyKR[]) => QuarterlyKR[]) => void
  checkins: DailyCheckin[]; setCheckins: (fn: (p: DailyCheckin[]) => DailyCheckin[]) => void
  reviews: WeeklyReview[]; setReviews: (fn: (p: WeeklyReview[]) => WeeklyReview[]) => void
  weekStart: string; toast: (m: string) => void
}

const panelStyle = { background: 'var(--navy-700)', border: '1px solid var(--navy-600)', borderRadius: 16, overflow: 'hidden' as const }
const sectionStyle = { borderBottom: '1px solid var(--navy-600)', padding: '12px 16px' }

export default function Checkin({ objectives, roadmapItems, krs, setKrs, checkins, setCheckins, reviews, setReviews, weekStart, toast }: Props) {
  const today = new Date().toISOString().slice(0, 10)
  const activeItems = roadmapItems.filter(i => i.quarter === ACTIVE_Q && i.status !== 'abandoned')
  const allActiveKrs = krs.filter(k => activeItems.some(i => i.id === k.roadmap_item_id))
  const pinnedKrs = allActiveKrs.filter(k => k.pinned_to_checkin)
  const displayKrs = pinnedKrs.length ? pinnedKrs : allActiveKrs.slice(0, 5)
  const todayCheckins = checkins.filter(c => c.checkin_date === today)
  const existing = reviews.find(r => r.week_start === weekStart)
  const [review, setReview] = useState({ rating: existing?.rating ?? 'steady' as ReviewRating, win: existing?.win ?? '', slipped: existing?.slipped ?? '', adjust_notes: existing?.adjust_notes ?? '' })

  async function setCheckinStatus(krId: string, status: CheckinStatus) {
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
  async function saveReview() {
    const krsHit = allActiveKrs.filter(k => k.status === 'on_track' || k.status === 'done').length
    const payload = { week_start: weekStart, ...review, krs_hit: krsHit, krs_total: allActiveKrs.length }
    if (existing) {
      await supabase.from('weekly_reviews').update(payload).eq('id', existing.id)
      setReviews(prev => prev.map(r => r.id === existing.id ? { ...r, ...payload } : r))
    } else {
      const { data } = await supabase.from('weekly_reviews').insert(payload).select().single()
      if (data) setReviews(prev => [data, ...prev])
    }
    toast('Review saved!')
  }

  function ciBtn(label: string, sel: boolean, color: string, bgColor: string, onClick: () => void) {
    return (
      <button key={label} onClick={onClick}
        className="text-[11px] px-2.5 py-1 rounded-full font-medium transition-all"
        style={sel ? { background: bgColor, color, border: `1px solid ${bgColor}` } : { background: 'var(--navy-800)', color: 'var(--navy-300)', border: '1px solid var(--navy-500)' }}>
        {label}
      </button>
    )
  }

  return (
    <div>
      <div className="mb-4">
        <h1 className="text-base font-semibold" style={{ color: 'var(--navy-50)' }}>Check-ins</h1>
        <p className="text-xs mt-0.5" style={{ color: 'var(--navy-400)' }}>Daily pulse + weekly review for {formatWeek(weekStart)}</p>
      </div>
      <div className="grid grid-cols-2 gap-4">
        {/* Daily pulse */}
        <div style={panelStyle}>
          <div style={sectionStyle}>
            <div className="text-sm font-semibold" style={{ color: 'var(--navy-50)' }}>Daily pulse</div>
            <div className="text-[11px] mt-0.5" style={{ color: 'var(--navy-400)' }}>{formatDate(today)}</div>
          </div>
          {displayKrs.map(kr => {
            const item = roadmapItems.find(i => i.id === kr.roadmap_item_id)
            const obj = objectives.find(o => o.id === item?.annual_objective_id)
            const current = todayCheckins.find(c => c.quarterly_kr_id === kr.id)?.status
            return (
              <div key={kr.id} style={sectionStyle}>
                <div className="text-[10px] mb-1" style={{ color: 'var(--navy-400)' }}>{obj?.name} ↑</div>
                <div className="text-xs font-medium mb-2 leading-snug" style={{ color: 'var(--navy-100)' }}>{kr.title}</div>
                <div className="flex gap-1.5">
                  {ciBtn('On track',  current === 'on_track',  'white', 'var(--teal)',  () => setCheckinStatus(kr.id, 'on_track'))}
                  {ciBtn('Off track', current === 'off_track', 'white', 'var(--red)',   () => setCheckinStatus(kr.id, 'off_track'))}
                  {ciBtn('Blocked',   current === 'blocked',   'white', 'var(--amber)', () => setCheckinStatus(kr.id, 'blocked'))}
                </div>
              </div>
            )
          })}
          <div style={{ padding: '12px 16px' }}>
            <div className="text-[11px] font-semibold mb-2" style={{ color: 'var(--navy-300)' }}>Pin KRs to daily check-in</div>
            {allActiveKrs.map(kr => (
              <label key={kr.id} className="flex items-center gap-2 mb-1.5 cursor-pointer">
                <input type="checkbox" checked={kr.pinned_to_checkin} onChange={() => togglePin(kr)} style={{ accentColor: 'var(--accent)' }} />
                <span className="text-[11px]" style={{ color: 'var(--navy-300)' }}>{kr.title}</span>
              </label>
            ))}
          </div>
        </div>

        {/* Weekly review */}
        <div style={panelStyle}>
          <div style={sectionStyle}>
            <div className="text-sm font-semibold" style={{ color: 'var(--navy-50)' }}>Weekly review</div>
            <div className="text-[11px] mt-0.5" style={{ color: 'var(--navy-400)' }}>Week of {formatWeek(weekStart)}</div>
          </div>
          <div style={sectionStyle}>
            <div className="text-[11px] font-semibold mb-2" style={{ color: 'var(--navy-300)' }}>How did the week go?</div>
            <div className="flex gap-2">
              {ciBtn('Strong', review.rating === 'strong', 'white', 'var(--teal)',  () => setReview(d => ({ ...d, rating: 'strong' })))}
              {ciBtn('Steady', review.rating === 'steady', 'white', 'var(--amber)', () => setReview(d => ({ ...d, rating: 'steady' })))}
              {ciBtn('Rough',  review.rating === 'rough',  'white', 'var(--red)',   () => setReview(d => ({ ...d, rating: 'rough' })))}
            </div>
          </div>
          {[['Win of the week', 'win', 'What moved the needle?'], ['What slipped?', 'slipped', 'One honest line…'], ['Adjust for next week?', 'adjust_notes', 'Drop a KR, shift a deadline…']].map(([label, field, ph]) => (
            <div key={field} style={sectionStyle}>
              <div className="text-[11px] font-semibold mb-1.5" style={{ color: 'var(--navy-300)' }}>{label}</div>
              <textarea rows={2} className="input text-xs" placeholder={ph}
                value={review[field as keyof typeof review] as string}
                onChange={e => setReview(d => ({ ...d, [field]: e.target.value }))} />
            </div>
          ))}
          <div style={{ padding: 16 }}>
            <button className="btn-primary w-full py-2.5" onClick={saveReview}>Save review</button>
          </div>
        </div>
      </div>
    </div>
  )
}
