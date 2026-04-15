'use client'
import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import { AnnualObjective, RoadmapItem, QuarterlyKR, DailyCheckin, WeeklyReview, CheckinStatus, ReviewRating } from '@/lib/types'
import { ACTIVE_Q, formatWeek, formatDate } from '@/lib/utils'

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

export default function Checkin({ objectives, roadmapItems, krs, setKrs, checkins, setCheckins, reviews, setReviews, weekStart, toast }: Props) {
  const today = new Date().toISOString().slice(0, 10)
  const activeItems = roadmapItems.filter(i => i.quarter === ACTIVE_Q && i.status !== 'abandoned')
  const allActiveKrs = krs.filter(k => activeItems.some(i => i.id === k.roadmap_item_id))
  const pinnedKrs = allActiveKrs.filter(k => k.pinned_to_checkin)
  const displayKrs = pinnedKrs.length ? pinnedKrs : allActiveKrs.slice(0, 5)
  const todayCheckins = checkins.filter(c => c.checkin_date === today)

  const existing = reviews.find(r => r.week_start === weekStart)
  const [review, setReview] = useState<{ rating: ReviewRating; win: string; slipped: string; adjust_notes: string }>({
    rating: existing?.rating ?? 'steady',
    win: existing?.win ?? '',
    slipped: existing?.slipped ?? '',
    adjust_notes: existing?.adjust_notes ?? '',
  })

  async function setCheckinStatus(krId: string, status: CheckinStatus) {
    const ex = todayCheckins.find(c => c.quarterly_kr_id === krId)
    if (ex) {
      await supabase.from('daily_checkins').update({ status }).eq('id', ex.id)
      setCheckins(prev => prev.map(c => c.id === ex.id ? { ...c, status } : c))
    } else {
      const { data } = await supabase.from('daily_checkins')
        .insert({ checkin_date: today, quarterly_kr_id: krId, status }).select().single()
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

  return (
    <div>
      <div className="mb-4">
        <h1 className="text-base font-semibold text-gray-900">Check-ins</h1>
        <p className="text-xs text-gray-400 mt-0.5">Daily pulse + weekly review for {formatWeek(weekStart)}</p>
      </div>

      <div className="grid grid-cols-2 gap-4">
        {/* Daily pulse */}
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100">
            <div className="text-sm font-semibold text-gray-900">Daily pulse</div>
            <div className="text-[11px] text-gray-400 mt-0.5">{formatDate(today)}</div>
          </div>

          {displayKrs.map(kr => {
            const item = roadmapItems.find(i => i.id === kr.roadmap_item_id)
            const obj = objectives.find(o => o.id === item?.annual_objective_id)
            const current = todayCheckins.find(c => c.quarterly_kr_id === kr.id)?.status
            return (
              <div key={kr.id} className="px-4 py-3 border-b border-gray-50">
                <div className="text-[10px] text-gray-400 mb-1">{obj?.name} ↑</div>
                <div className="text-xs font-medium text-gray-900 mb-2 leading-snug">{kr.title}</div>
                <div className="flex gap-1.5">
                  {(['on_track', 'off_track', 'blocked'] as CheckinStatus[]).map(s => (
                    <button key={s} onClick={() => setCheckinStatus(kr.id, s)}
                      className={`text-[11px] px-2.5 py-1 rounded-full border transition-all ${
                        current === s
                          ? s === 'on_track' ? 'bg-[#1D9E75] border-[#1D9E75] text-white'
                          : s === 'off_track' ? 'bg-[#D85A30] border-[#D85A30] text-white'
                          : 'bg-[#EF9F27] border-[#EF9F27] text-white'
                          : 'border-gray-200 text-gray-500 hover:border-gray-400'
                      }`}>
                      {s === 'on_track' ? 'On track' : s === 'off_track' ? 'Off track' : 'Blocked'}
                    </button>
                  ))}
                </div>
              </div>
            )
          })}

          <div className="px-4 py-3 border-t border-gray-100">
            <div className="text-[11px] text-gray-500 font-medium mb-2">Pin KRs to daily check-in</div>
            {allActiveKrs.map(kr => (
              <label key={kr.id} className="flex items-center gap-2 mb-1.5 cursor-pointer">
                <input type="checkbox" checked={kr.pinned_to_checkin} onChange={() => togglePin(kr)}
                  className="accent-[#1D9E75] w-3.5 h-3.5" />
                <span className="text-[11px] text-gray-600">{kr.title}</span>
              </label>
            ))}
          </div>
        </div>

        {/* Weekly review */}
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100">
            <div className="text-sm font-semibold text-gray-900">Weekly review</div>
            <div className="text-[11px] text-gray-400 mt-0.5">Week of {formatWeek(weekStart)}</div>
          </div>

          <div className="px-4 py-3 border-b border-gray-50">
            <div className="text-[11px] font-medium text-gray-600 mb-2">How did the week go?</div>
            <div className="flex gap-2">
              {(['strong', 'steady', 'rough'] as ReviewRating[]).map(r => (
                <button key={r} onClick={() => setReview(d => ({ ...d, rating: r }))}
                  className={`text-[11px] px-3 py-1.5 rounded-full border transition-all capitalize ${
                    review.rating === r
                      ? r === 'strong' ? 'bg-[#1D9E75] border-[#1D9E75] text-white'
                      : r === 'rough'  ? 'bg-[#D85A30] border-[#D85A30] text-white'
                      : 'bg-[#EF9F27] border-[#EF9F27] text-white'
                      : 'border-gray-200 text-gray-500 hover:border-gray-400'
                  }`}>{r}</button>
              ))}
            </div>
          </div>

          {[
            ['Win of the week', 'win', 'What moved the needle?'],
            ['What slipped?', 'slipped', 'Be honest, one line is fine…'],
            ['Adjust anything for next week?', 'adjust_notes', 'Drop a KR, shift a deadline…'],
          ].map(([label, field, placeholder]) => (
            <div key={field} className="px-4 py-3 border-b border-gray-50">
              <div className="text-[11px] font-medium text-gray-600 mb-1.5">{label}</div>
              <textarea rows={2}
                className="w-full text-xs border border-gray-200 rounded-lg px-3 py-2 resize-none focus:outline-none focus:border-[#1D9E75] text-gray-800 placeholder:text-gray-300"
                placeholder={placeholder}
                value={review[field as keyof typeof review] as string}
                onChange={e => setReview(d => ({ ...d, [field]: e.target.value }))}
              />
            </div>
          ))}

          <div className="px-4 py-3">
            <button className="btn-primary w-full py-2.5" onClick={saveReview}>Save review</button>
          </div>
        </div>
      </div>
    </div>
  )
}
