'use client'
import React, { useState } from 'react'
import { supabase } from '@/lib/supabase'
import { AnnualObjective, RoadmapItem, DailyCheckin, WeeklyReview, CheckinStatus, ReviewRating, HealthStatus, MetricCheckin } from '@/lib/types'
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
  metricCheckins: MetricCheckin[]
  setMetricCheckins: (fn: (p: MetricCheckin[]) => MetricCheckin[]) => void
  toast: (m: string) => void
}

type Tab = 'review' | 'history'

export default function Reflect({ objectives, roadmapItems, setRoadmapItems, checkins, setCheckins, reviews, setReviews, weekStart, activeSpaceId, metricCheckins, setMetricCheckins, toast }: Props) {
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
          metricCheckins={metricCheckins}
          setMetricCheckins={setMetricCheckins}
          toast={toast} 
        />
      )}
      {tab === 'history' && <HistoryView reviews={reviews} />}
    </div>
  )
}

// Workflow-based weekly review: Habits → Actions → Outcomes → Reflection
function WeeklyReviewView({ objectives, roadmapItems, setRoadmapItems, checkins, setCheckins, reviews, setReviews, weekStart, activeSpaceId, metricCheckins, setMetricCheckins, toast }: Props) {
  const existing = reviews.find(r => r.week_start === weekStart)
  const [rating, setRating] = useState<ReviewRating>(existing?.rating ?? 'steady')
  const [win, setWin] = useState(existing?.win ?? '')
  const [slipped, setSlipped] = useState(existing?.slipped ?? '')
  const [adjustNotes, setAdjustNotes] = useState(existing?.adjust_notes ?? '')
  const [saving, setSaving] = useState(false)

  // Metric entry state
  const [metricValues, setMetricValues] = useState<Record<string, string>>({})
  const [savingMetrics, setSavingMetrics] = useState(false)

  const activeKRs = roadmapItems.filter(i => !i.is_parked && i.status !== 'abandoned' && i.status !== 'done')
  const habitKRs = activeKRs.filter(kr => kr.is_habit)
  const metricKRs = activeKRs.filter(kr => (kr as any).metric_type)
  const outcomeKRs = activeKRs.filter(kr => !kr.is_habit && !(kr as any).metric_type)

  // Get current metric values for this week
  React.useEffect(() => {
    const currentValues: Record<string, string> = {}
    metricKRs.forEach(kr => {
      const existingCheckin = metricCheckins.find(c => c.roadmap_item_id === kr.id && c.week_start === weekStart)
      if (existingCheckin) {
        currentValues[kr.id] = existingCheckin.value.toString()
      }
    })
    setMetricValues(currentValues)
  }, [metricKRs, metricCheckins, weekStart])

  async function saveMetrics() {
    setSavingMetrics(true)
    try {
      for (const kr of metricKRs) {
        const value = parseFloat(metricValues[kr.id])
        if (isNaN(value)) continue

        const existingCheckin = metricCheckins.find(c => c.roadmap_item_id === kr.id && c.week_start === weekStart)
        
        if (existingCheckin) {
          // Update existing
          const { error } = await supabase
            .from('metric_checkins')
            .update({ value })
            .eq('id', existingCheckin.id)
          if (error) throw error
          
          setMetricCheckins(prev => prev.map(c => 
            c.id === existingCheckin.id ? { ...c, value } : c
          ))
        } else {
          // Create new
          const { data, error } = await supabase
            .from('metric_checkins')
            .insert({ roadmap_item_id: kr.id, week_start: weekStart, value })
            .select()
            .single()
          if (error) throw error
          
          if (data) {
            setMetricCheckins(prev => [data, ...prev])
          }
        }
      }
      
      setSavingMetrics(false)
      toast('Metrics updated ✓')
    } catch (error) {
      setSavingMetrics(false)
      toast('Error saving metrics')
    }
  }
  
  // Get this week's habit performance from Focus tab data
  const weekStartDate = new Date(weekStart)
  const weekEndDate = new Date(weekStartDate)
  weekEndDate.setDate(weekEndDate.getDate() + 6)
  
  const thisWeekCheckins = checkins.filter(c => {
    const checkinDate = new Date(c.checkin_date)
    return checkinDate >= weekStartDate && checkinDate <= weekEndDate
  })

  // Get incomplete actions from the week (these need review)
  const incompleteActions = roadmapItems.filter(i => 
    !i.is_parked && 
    i.status !== 'abandoned' && 
    i.status !== 'done' &&
    !i.is_habit &&
    i.progress < 100
  )

  async function setOutcomeProgress(kr: RoadmapItem, progress: number) {
    await supabase.from('roadmap_items').update({ progress }).eq('id', kr.id)
    setRoadmapItems(prev => prev.map(i => i.id === kr.id ? { ...i, progress } : i))
    toast('Progress updated ✓')
  }

  async function handleAction(actionId: string, decision: 'keep' | 'park' | 'abandon') {
    if (decision === 'park') {
      await supabase.from('roadmap_items').update({ is_parked: true, quarter: null }).eq('id', actionId)
      setRoadmapItems(prev => prev.map(i => i.id === actionId ? { ...i, is_parked: true, quarter: null } : i))
      toast('Moved to parking lot')
    } else if (decision === 'abandon') {
      await supabase.from('roadmap_items').update({ status: 'abandoned' }).eq('id', actionId)
      setRoadmapItems(prev => prev.map(i => i.id === actionId ? { ...i, status: 'abandoned' } : i))
      toast('Action abandoned')
    }
    // 'keep' means no change - stays active for next week
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

  const PROGRESS_OPTIONS = [0, 25, 50, 75, 100]

  // Calculate habit performance from Focus tab data
  function getHabitPerformance(kr: RoadmapItem) {
    const krCheckins = thisWeekCheckins.filter(c => c.roadmap_item_id === kr.id && c.status === 'on_track')
    
    // Parse habit frequency from title
    const title = kr.title.toLowerCase()
    
    if (title.includes('daily') || title.includes('every day')) {
      return {
        completed: krCheckins.length,
        target: 7,
        percentage: Math.round((krCheckins.length / 7) * 100),
        type: 'daily' as const
      }
    }
    
    const weeklyMatch = title.match(/(\d+)x?\s*(per\s*week|weekly|times?\s*per\s*week)/i)
    if (weeklyMatch) {
      const target = parseInt(weeklyMatch[1])
      return {
        completed: krCheckins.length,
        target,
        percentage: Math.round((krCheckins.length / target) * 100),
        type: 'weekly' as const
      }
    }
    
    // Default to weekly 1x
    return {
      completed: krCheckins.length,
      target: 1,
      percentage: krCheckins.length >= 1 ? 100 : 0,
      type: 'weekly' as const
    }
  }

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
          {habitKRs.length} habits · {outcomeKRs.length} outcomes · {incompleteActions.length} incomplete actions
        </div>
      </div>

      {/* 1. Habits Review (Auto-Populated) */}
      <div style={{ marginBottom: 32 }}>
        <h3 style={{ fontSize: 14, fontWeight: 600, color: 'var(--navy-200)', marginBottom: 16 }}>
          📊 This Week's Habits
        </h3>
        
        {habitKRs.length === 0 ? (
          <div style={{ 
            color: 'var(--navy-400)', 
            fontSize: 14, 
            textAlign: 'center', 
            padding: '24px 0',
            background: 'var(--navy-700)',
            borderRadius: 8
          }}>
            No habit tracking this week.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {habitKRs.map(kr => {
              const performance = getHabitPerformance(kr)
              const obj = objectives.find(o => o.id === kr.annual_objective_id)
              
              return (
                <div key={kr.id} style={{
                  background: 'var(--navy-700)',
                  border: '1px solid var(--navy-600)',
                  borderRadius: 8,
                  padding: 16
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--navy-50)', marginBottom: 2 }}>
                        {kr.title}
                      </div>
                      {obj && (
                        <div style={{ fontSize: 11, color: 'var(--navy-400)' }}>
                          {obj.name}
                        </div>
                      )}
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ 
                        fontSize: 16, 
                        fontWeight: 600, 
                        color: performance.percentage >= 80 ? 'var(--teal-text)' : 
                               performance.percentage >= 50 ? 'var(--amber-text)' : 'var(--red-text)'
                      }}>
                        {performance.completed}/{performance.target}
                      </div>
                      <div style={{ fontSize: 10, color: 'var(--navy-400)' }}>
                        {performance.percentage}%
                      </div>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* 2. Incomplete Actions Review */}
      {incompleteActions.length > 0 && (
        <div style={{ marginBottom: 32 }}>
          <h3 style={{ fontSize: 14, fontWeight: 600, color: 'var(--navy-200)', marginBottom: 16 }}>
            🔄 Incomplete Actions
          </h3>
          
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {incompleteActions.map(action => {
              const obj = objectives.find(o => o.id === action.annual_objective_id)
              
              return (
                <div key={action.id} style={{
                  background: 'var(--navy-700)',
                  border: '1px solid var(--navy-600)',
                  borderRadius: 8,
                  padding: 16
                }}>
                  <div style={{ marginBottom: 12 }}>
                    <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--navy-50)', marginBottom: 2 }}>
                      {action.title}
                    </div>
                    {obj && (
                      <div style={{ fontSize: 11, color: 'var(--navy-400)' }}>
                        {obj.name}
                      </div>
                    )}
                  </div>
                  
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button
                      onClick={() => handleAction(action.id, 'keep')}
                      style={{
                        flex: 1,
                        padding: '8px 12px',
                        fontSize: 11,
                        borderRadius: 4,
                        border: 'none',
                        cursor: 'pointer',
                        background: 'var(--teal-bg)',
                        color: 'var(--teal-text)',
                        transition: 'all .15s'
                      }}
                    >
                      Keep for next week
                    </button>
                    <button
                      onClick={() => handleAction(action.id, 'park')}
                      style={{
                        flex: 1,
                        padding: '8px 12px',
                        fontSize: 11,
                        borderRadius: 4,
                        border: 'none',
                        cursor: 'pointer',
                        background: 'var(--amber-bg)',
                        color: 'var(--amber-text)',
                        transition: 'all .15s'
                      }}
                    >
                      Move to parking
                    </button>
                    <button
                      onClick={() => handleAction(action.id, 'abandon')}
                      style={{
                        flex: 1,
                        padding: '8px 12px',
                        fontSize: 11,
                        borderRadius: 4,
                        border: 'none',
                        cursor: 'pointer',
                        background: 'var(--red-bg)',
                        color: 'var(--red-text)',
                        transition: 'all .15s'
                      }}
                    >
                      Abandon
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* 3. Outcome Progress (Manual Updates) */}
      {outcomeKRs.length > 0 && (
        <div style={{ marginBottom: 32 }}>
          <h3 style={{ fontSize: 14, fontWeight: 600, color: 'var(--navy-200)', marginBottom: 16 }}>
            📈 Outcome Progress
          </h3>
          
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {outcomeKRs.map(kr => {
              const obj = objectives.find(o => o.id === kr.annual_objective_id)
              
              return (
                <div key={kr.id} style={{
                  background: 'var(--navy-700)',
                  border: '1px solid var(--navy-600)',
                  borderRadius: 8,
                  padding: 16
                }}>
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
                  
                  <div style={{ marginBottom: 8 }}>
                    <div style={{ fontSize: 11, color: 'var(--navy-400)', marginBottom: 6 }}>
                      Progress: {kr.progress}%
                    </div>
                    <div style={{ display: 'flex', gap: 4 }}>
                      {PROGRESS_OPTIONS.map(pct => (
                        <button
                          key={pct}
                          onClick={() => setOutcomeProgress(kr, pct)}
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
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* 4. Update Metrics */}
      {metricKRs.length > 0 && (
        <div style={{ marginBottom: 32 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
            <h3 style={{ fontSize: 14, fontWeight: 600, color: 'var(--navy-200)', margin: 0 }}>
              📊 Update Metrics
            </h3>
            <button
              onClick={saveMetrics}
              disabled={savingMetrics}
              style={{
                padding: '6px 12px',
                fontSize: 11,
                borderRadius: 6,
                border: 'none',
                cursor: 'pointer',
                background: 'var(--accent)',
                color: '#fff',
                opacity: savingMetrics ? 0.6 : 1
              }}
            >
              {savingMetrics ? 'Saving...' : 'Save Metrics'}
            </button>
          </div>
          
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {metricKRs.map(kr => {
              const metricKR = kr as any
              const obj = objectives.find(o => o.id === kr.annual_objective_id)
              const lastCheckin = metricCheckins
                .filter(c => c.roadmap_item_id === kr.id)
                .sort((a, b) => new Date(b.week_start).getTime() - new Date(a.week_start).getTime())[0]
              
              const getPlaceholder = () => {
                if (metricKR.metric_type === 'weight') return '195'
                if (metricKR.metric_type === 'net_worth') return '850000'
                if (metricKR.metric_type === 'revenue') return '2400'
                return ''
              }
              
              const getUnit = () => {
                if (metricKR.metric_type === 'weight') return 'lbs'
                if (metricKR.metric_type === 'net_worth') return '$'
                if (metricKR.metric_type === 'revenue') return '$'
                return ''
              }
              
              return (
                <div key={kr.id} style={{
                  background: 'var(--navy-700)',
                  border: '1px solid var(--navy-600)',
                  borderRadius: 8,
                  padding: 16
                }}>
                  <div style={{ marginBottom: 12 }}>
                    <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--navy-50)', marginBottom: 2 }}>
                      {kr.title}
                    </div>
                    {obj && (
                      <div style={{ fontSize: 11, color: 'var(--navy-400)' }}>
                        {obj.name}
                      </div>
                    )}
                    {lastCheckin && (
                      <div style={{ fontSize: 11, color: 'var(--navy-500)', marginTop: 4 }}>
                        Last: {getUnit()}{lastCheckin.value.toLocaleString()}
                      </div>
                    )}
                  </div>
                  
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 12, color: 'var(--navy-400)' }}>
                      {getUnit()}
                    </span>
                    <input
                      type="number"
                      value={metricValues[kr.id] || ''}
                      onChange={e => setMetricValues(prev => ({ ...prev, [kr.id]: e.target.value }))}
                      placeholder={getPlaceholder()}
                      style={{
                        flex: 1,
                        padding: '8px 12px',
                        fontSize: 13,
                        borderRadius: 6,
                        border: '1px solid var(--navy-600)',
                        background: 'var(--navy-800)',
                        color: 'var(--navy-50)',
                        outline: 'none'
                      }}
                    />
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* 5. Weekly Reflection */}
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
