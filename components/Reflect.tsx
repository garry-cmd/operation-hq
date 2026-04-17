'use client'
import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import { AnnualObjective, RoadmapItem, DailyCheckin, WeeklyReview, CheckinStatus, ReviewRating, HealthStatus } from '@/lib/types'
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
  activeSpaceId: string
  toast: (m: string) => void
}

type Tab = 'review' | 'history'

export default function Reflect({ objectives, roadmapItems, setRoadmapItems, checkins, setCheckins, reviews, setReviews, weekStart, activeSpaceId, toast }: Props) {
  const [tab, setTab] = useState<Tab>('review')
  
  const TABS: { id: Tab; label: string }[] = [
    { id: 'review',   label: 'Weekly Review' },
    { id: 'history',  label: 'History' },
  ]

  return (
    <div>
      <h1 style={{ fontSize: 18, fontWeight: 700, color: 'var(--navy-50)', marginBottom: 3 }}>Reflect</h1>
      <p style={{ fontSize: 12, color: 'var(--navy-300)', marginBottom: 18 }}>Weekly review and progress tracking</p>
      
      <div style={{ display: 'flex', gap: 7, marginBottom: 20, flexWrap: 'wrap' }}>
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} className="sub-tab-btn"
            style={tab === t.id
              ? { background: 'var(--accent)', color: '#fff' }
              : { background: 'var(--navy-700)', color: 'var(--navy-200)', border: '1px solid var(--navy-500)' }}>
            {t.label}
          </button>
        ))}
      </div>
      
      {tab === 'review' && (
        <WeeklyReviewView 
          objectives={objectives}
          roadmapItems={roadmapItems} 
          setRoadmapItems={setRoadmapItems}
          checkins={checkins}
          setCheckins={setCheckins}
          reviews={reviews} 
          setReviews={setReviews} 
          weekStart={weekStart} 
          activeSpaceId={activeSpaceId} 
          toast={toast} 
        />
      )}
      {tab === 'history' && <HistoryView reviews={reviews} />}
    </div>
  )
}

// Consolidated weekly review with progress, check-ins, and reflection
function WeeklyReviewView({ objectives, roadmapItems, setRoadmapItems, checkins, setCheckins, reviews, setReviews, weekStart, activeSpaceId, toast }: Props) {
  const existing = reviews.find(r => r.week_start === weekStart)
  const [rating, setRating] = useState<ReviewRating>(existing?.rating ?? 'steady')
  const [win, setWin] = useState(existing?.win ?? '')
  const [slipped, setSlipped] = useState(existing?.slipped ?? '')
  const [adjustNotes, setAdjustNotes] = useState(existing?.adjust_notes ?? '')
  const [saving, setSaving] = useState(false)

  const activeKRs = roadmapItems.filter(i => !i.is_parked && i.status !== 'abandoned' && i.status !== 'done')
  const today = new Date().toISOString().slice(0, 10)
  const todayCheckins = checkins.filter(c => c.checkin_date === today)

  async function setKRProgress(kr: RoadmapItem, progress: number) {
    await supabase.from('roadmap_items').update({ progress }).eq('id', kr.id)
    setRoadmapItems(prev => prev.map(i => i.id === kr.id ? { ...i, progress } : i))
    toast('Progress updated ✓')
  }

  async function setKRHealth(kr: RoadmapItem, health: HealthStatus) {
    await supabase.from('roadmap_items').update({ health_status: health }).eq('id', kr.id)
    setRoadmapItems(prev => prev.map(i => i.id === kr.id ? { ...i, health_status: health } : i))
    toast('Status updated ✓')
  }

  async function setTodayCheckin(krId: string, status: CheckinStatus) {
    const existing = todayCheckins.find(c => c.roadmap_item_id === krId)
    if (existing) {
      await supabase.from('daily_checkins').update({ status }).eq('id', existing.id)
      setCheckins(prev => prev.map(c => c.id === existing.id ? { ...c, status } : c))
    } else {
      const { data } = await supabase.from('daily_checkins').insert({ checkin_date: today, roadmap_item_id: krId, status }).select().single()
      if (data) setCheckins(prev => [...prev, data])
    }
    toast('Check-in saved ✓')
  }

  async function saveReview() {
    setSaving(true)
    const onTrack = activeKRs.filter(k => k.health_status === 'on_track' || k.health_status === 'done').length
    const payload = { 
      week_start: weekStart, 
      rating, 
      win, 
      slipped, 
      adjust_notes: adjustNotes, 
      krs_hit: onTrack, 
      krs_total: activeKRs.length 
    }
    
    if (existing) {
      await supabase.from('weekly_reviews').update(payload).eq('id', existing.id)
      setReviews(prev => prev.map(r => r.id === existing.id ? { ...r, ...payload } : r))
    } else {
      const { data } = await supabase.from('weekly_reviews').insert({ ...payload, space_id: activeSpaceId }).select().single()
      if (data) setReviews(prev => [data, ...prev])
    }
    
    setSaving(false)
    toast('Weekly review saved! 🎯')
  }

  const RATINGS: { value: ReviewRating; label: string; color: string }[] = [
    { value: 'strong', label: '💪 Strong', color: 'var(--teal)' },
    { value: 'steady', label: '⚖️ Steady', color: 'var(--amber)' },
    { value: 'rough',  label: '😤 Rough',  color: 'var(--red)' },
  ]

  const HEALTH_CYCLE: HealthStatus[] = ['not_started', 'on_track', 'off_track', 'blocked', 'done']

  const PROGRESS_OPTIONS = [0, 25, 50, 75, 100]

  return (
    <div style={{ maxWidth: 600 }}>
      {/* Week Header */}
      <div style={{ 
        background: 'var(--navy-700)', 
        border: '1px solid var(--navy-600)', 
        borderRadius: 12, 
        padding: 16, 
        marginBottom: 24,
        textAlign: 'center'
      }}>
        <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--navy-50)', marginBottom: 4 }}>
          Week of {formatWeek(weekStart)}
        </div>
        <div style={{ fontSize: 12, color: 'var(--navy-400)' }}>
          {activeKRs.length} active key results
        </div>
      </div>

      {/* Key Results Progress & Status */}
      <div style={{ marginBottom: 32 }}>
        <h3 style={{ fontSize: 14, fontWeight: 600, color: 'var(--navy-200)', marginBottom: 16 }}>
          📊 Progress & Status Check
        </h3>
        
        {activeKRs.length === 0 ? (
          <div style={{ 
            color: 'var(--navy-400)', 
            fontSize: 14, 
            textAlign: 'center', 
            padding: '32px 0',
            background: 'var(--navy-700)',
            borderRadius: 8
          }}>
            No active key results to review.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {activeKRs.map(kr => {
              const obj = objectives.find(o => o.id === kr.annual_objective_id)
              const todayCheckin = todayCheckins.find(c => c.roadmap_item_id === kr.id)
              
              return (
                <div key={kr.id} style={{
                  background: 'var(--navy-700)',
                  border: '1px solid var(--navy-600)',
                  borderRadius: 8,
                  padding: 16
                }}>
                  {/* KR Title & Objective */}
                  <div style={{ marginBottom: 12 }}>
                    <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--navy-50)', marginBottom: 2 }}>
                      {kr.title}
                    </div>
                    {obj && (
                      <div style={{ fontSize: 11, color: 'var(--navy-400)' }}>
                        {obj.name}
                      </div>
                    )}
                  </div>

                  {/* Progress Slider */}
                  <div style={{ marginBottom: 12 }}>
                    <div style={{ fontSize: 11, color: 'var(--navy-400)', marginBottom: 6 }}>
                      Progress: {kr.progress}%
                    </div>
                    <div style={{ display: 'flex', gap: 4 }}>
                      {PROGRESS_OPTIONS.map(pct => (
                        <button
                          key={pct}
                          onClick={() => setKRProgress(kr, pct)}
                          style={{
                            flex: 1,
                            padding: '6px 8px',
                            fontSize: 11,
                            borderRadius: 4,
                            border: 'none',
                            cursor: 'pointer',
                            background: kr.progress === pct ? 'var(--accent)' : 'var(--navy-600)',
                            color: kr.progress === pct ? '#fff' : 'var(--navy-300)',
                            transition: 'all .15s'
                          }}
                        >
                          {pct}%
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Health Status */}
                  <div style={{ marginBottom: 12 }}>
                    <div style={{ fontSize: 11, color: 'var(--navy-400)', marginBottom: 6 }}>
                      Weekly Status
                    </div>
                    <button
                      onClick={() => {
                        const currentIndex = HEALTH_CYCLE.indexOf(kr.health_status)
                        const nextStatus = HEALTH_CYCLE[(currentIndex + 1) % HEALTH_CYCLE.length]
                        setKRHealth(kr, nextStatus)
                      }}
                      style={{
                        background: 'none',
                        border: 'none',
                        cursor: 'pointer',
                        padding: 0
                      }}
                    >
                      <StatusPill status={kr.health_status} />
                    </button>
                  </div>

                  {/* Today's Check-in */}
                  <div>
                    <div style={{ fontSize: 11, color: 'var(--navy-400)', marginBottom: 6 }}>
                      Today's Check-in
                    </div>
                    <div style={{ display: 'flex', gap: 4 }}>
                      {(['on_track', 'off_track', 'blocked'] as CheckinStatus[]).map(status => (
                        <button
                          key={status}
                          onClick={() => setTodayCheckin(kr.id, status)}
                          style={{
                            flex: 1,
                            padding: '4px 8px',
                            fontSize: 10,
                            borderRadius: 4,
                            border: 'none',
                            cursor: 'pointer',
                            background: todayCheckin?.status === status ? 'var(--accent)' : 'var(--navy-600)',
                            color: todayCheckin?.status === status ? '#fff' : 'var(--navy-300)',
                            transition: 'all .15s'
                          }}
                        >
                          {status.replace('_', ' ')}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Weekly Reflection */}
      <div>
        <h3 style={{ fontSize: 14, fontWeight: 600, color: 'var(--navy-200)', marginBottom: 16 }}>
          💭 Weekly Reflection
        </h3>
        
        {/* Overall Rating */}
        <div className="field">
          <label>How was this week overall?</label>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {RATINGS.map(r => (
              <button key={r.value} onClick={() => setRating(r.value)}
                style={{ 
                  padding: '8px 16px', 
                  fontSize: 13, 
                  borderRadius: 8, 
                  border: 'none', 
                  cursor: 'pointer',
                  background: rating === r.value ? r.color : 'var(--navy-600)',
                  color: rating === r.value ? '#fff' : 'var(--navy-300)',
                  transition: 'all .15s'
                }}>
                {r.label}
              </button>
            ))}
          </div>
        </div>

        {/* Win of the Week */}
        <div className="field">
          <label>Win of the week</label>
          <textarea 
            className="input" 
            rows={2} 
            value={win} 
            onChange={e => setWin(e.target.value)}
            placeholder="What moved the needle?"
          />
        </div>

        {/* What Slipped */}
        <div className="field">
          <label>What slipped?</label>
          <textarea 
            className="input" 
            rows={2} 
            value={slipped} 
            onChange={e => setSlipped(e.target.value)}
            placeholder="One honest line…"
          />
        </div>

        {/* Adjustments */}
        <div className="field">
          <label>Adjust for next week?</label>
          <textarea 
            className="input" 
            rows={2} 
            value={adjustNotes} 
            onChange={e => setAdjustNotes(e.target.value)}
            placeholder="Drop a KR, shift a deadline…"
          />
        </div>

        {/* Save Button */}
        <button 
          onClick={saveReview}
          disabled={saving}
          className="btn-primary"
          style={{ 
            width: '100%', 
            padding: '12px', 
            fontSize: 14, 
            fontWeight: 600,
            marginTop: 8
          }}
        >
          {saving ? 'Saving…' : existing ? 'Update Review' : 'Save Weekly Review'}
        </button>
      </div>
    </div>
  )
}

// History view 
function HistoryView({ reviews }: { reviews: WeeklyReview[] }) {
  const sorted = [...reviews].sort((a, b) => new Date(b.week_start).getTime() - new Date(a.week_start).getTime())

  return (
    <div>
      {sorted.length === 0 ? (
        <div style={{ color: 'var(--navy-400)', fontSize: 14, textAlign: 'center', padding: '60px 0' }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>📚</div>
          No reviews yet.<br />
          <span style={{ fontSize: 12 }}>Complete your first weekly review to see it here.</span>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {sorted.map(r => (
            <div key={r.id} style={{ background: 'var(--navy-700)', border: '1px solid var(--navy-600)', borderRadius: 8, padding: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--navy-200)' }}>{formatWeek(r.week_start)}</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 11, color: 'var(--navy-400)' }}>{r.krs_hit}/{r.krs_total} KRs</span>
                  <span style={{ fontSize: 12, padding: '2px 8px', borderRadius: 4, background: r.rating === 'strong' ? 'var(--teal)' : r.rating === 'steady' ? 'var(--amber)' : 'var(--red)', color: '#fff' }}>
                    {r.rating === 'strong' ? '💪' : r.rating === 'steady' ? '⚖️' : '😤'}
                  </span>
                </div>
              </div>
              {r.win && <div style={{ fontSize: 12, color: 'var(--navy-300)', marginBottom: 4, lineHeight: 1.4 }}><strong>Win:</strong> {r.win}</div>}
              {r.slipped && <div style={{ fontSize: 12, color: 'var(--navy-300)', marginBottom: 4, lineHeight: 1.4 }}><strong>Slipped:</strong> {r.slipped}</div>}
              {r.adjust_notes && <div style={{ fontSize: 12, color: 'var(--navy-300)', lineHeight: 1.4 }}><strong>Adjust:</strong> {r.adjust_notes}</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
