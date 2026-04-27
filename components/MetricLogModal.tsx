'use client'
import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import * as krsDb from '@/lib/db/krs'
import { RoadmapItem, MetricCheckin } from '@/lib/types'
import { getMonday, formatWeek } from '@/lib/utils'
import { computeMetricProgress } from '@/lib/metricUtils'
import Modal from './Modal'

type Props = {
  kr: RoadmapItem
  checkins: MetricCheckin[]   // space-scoped; caller filters before passing in
  setMetricCheckins: (fn: (p: MetricCheckin[]) => MetricCheckin[]) => void
  setRoadmapItems: (fn: (p: RoadmapItem[]) => RoadmapItem[]) => void
  toast: (m: string) => void
  onClose: () => void
}

/**
 * MetricLogModal
 *
 * Canonical surface for logging this week's value for a metric KR. Also
 * renders the last ~10 weeks of history inline for context — no need to
 * navigate anywhere to see the trend while you log.
 *
 * Save path:
 *  1. Upsert the metric_checkin row (unique on roadmap_item_id + week_start,
 *     so this silently overwrites if you revise mid-week).
 *  2. Auto-compute progress from start/target/value and patch the
 *     roadmap_item's progress field in the same round-trip.
 *
 * Edit / delete on past rows are deferred to a later slice — keeping Slice 1
 * tight. You can correct THIS week by just saving a new value.
 */
export default function MetricLogModal({ kr, checkins, setMetricCheckins, setRoadmapItems, toast, onClose }: Props) {
  const thisWeek = getMonday()
  const existingThisWeek = checkins.find(c => c.roadmap_item_id === kr.id && c.week_start === thisWeek)

  const [value, setValue] = useState<string>(existingThisWeek?.value != null ? String(existingThisWeek.value) : '')
  const [saving, setSaving] = useState(false)

  const history = checkins
    .filter(c => c.roadmap_item_id === kr.id)
    .sort((a, b) => b.week_start.localeCompare(a.week_start))
    .slice(0, 10)

  async function save() {
    const num = Number(value)
    if (value === '' || Number.isNaN(num)) { toast('Enter a number first.'); return }
    if (saving) return
    setSaving(true)

    try {
      // Upsert: unique(roadmap_item_id, week_start) means the second insert
      // for the same week overwrites. supabase .upsert() handles this atomically.
      const { data: upserted, error: upsertErr } = await supabase
        .from('metric_checkins')
        .upsert({
          roadmap_item_id: kr.id,
          week_start: thisWeek,
          value: num,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'roadmap_item_id,week_start' })
        .select().single()

      if (upsertErr || !upserted) {
        console.error('metric_checkin upsert error:', upsertErr)
        toast('Could not save value.')
        setSaving(false)
        return
      }

      // Merge into local state — replace existing by (kr, week) key, else prepend.
      setMetricCheckins(prev => {
        const without = prev.filter(c => !(c.roadmap_item_id === kr.id && c.week_start === thisWeek))
        return [upserted, ...without]
      })

      // Auto-compute progress. Skip the write if not enough config or if the
      // value hasn't changed the rounded progress (avoids pointless updates).
      // Coerce kr.progress because Supabase numerics can arrive as strings;
      // a string-vs-number !== will always fire spurious updates.
      const newProgress = computeMetricProgress(kr, num)
      const currentProgress = kr.progress == null ? null : Number(kr.progress)
      if (newProgress != null && newProgress !== currentProgress) {
        try {
          const updated = await krsDb.setProgress(kr.id, newProgress)
          setRoadmapItems(prev => prev.map(i => i.id === kr.id ? updated : i))
        } catch (progressErr) {
          // Value saved but progress didn't — non-fatal, surface it but don't
          // roll back the value write. User will see the right value next load.
          console.error('progress update error:', progressErr)
        }
      }

      toast('Logged!')
      onClose()
    } finally {
      setSaving(false)
    }
  }

  // Inline per-row delta vs the entry below it (one row older). Direction-aware
  // coloring: "good" = moving toward target; "bad" = moving away.
  function deltaLabel(idx: number): { text: string; color: string } | null {
    if (idx >= history.length - 1) return null
    // Numeric columns arrive as strings from supabase — coerce at the boundary.
    const curr = Number(history[idx].value)
    const prev = Number(history[idx + 1].value)
    const d = curr - prev
    if (Math.abs(d) < 0.0001) return { text: '—', color: 'var(--navy-400)' }
    const sign = d > 0 ? '+' : ''
    // "up" direction: positive delta is good. "down" direction: negative delta is good.
    const good = kr.metric_direction === 'up' ? d > 0 : d < 0
    return {
      text: `${sign}${Number(d.toFixed(2))}`,
      color: good ? 'var(--teal)' : 'var(--red)',
    }
  }

  const unit = kr.metric_unit ?? ''

  return (
    <Modal
      title={kr.title}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={save} disabled={saving || value === ''}>
            {saving ? 'Saving…' : existingThisWeek ? 'Update' : 'Log value'}
          </button>
        </>
      }
    >
      {/* Context strip — start → target direction reminder */}
      {kr.start_value != null && kr.target_value != null && (
        <div style={{ fontSize: 12, color: 'var(--navy-400)', marginBottom: 14 }}>
          {kr.start_value}{unit && ` ${unit}`} → <span style={{ color: 'var(--navy-100)', fontWeight: 600 }}>{kr.target_value}{unit && ` ${unit}`}</span>
          {kr.target_date && <span> by {new Date(kr.target_date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>}
        </div>
      )}

      <div className="field">
        <label>Value for week of {formatWeek(thisWeek)}</label>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input
            className="input"
            type="number"
            inputMode="decimal"
            value={value}
            onChange={e => setValue(e.target.value)}
            placeholder={kr.start_value != null ? String(kr.start_value) : ''}
            autoFocus
            style={{ flex: 1 }}
          />
          {unit && <span style={{ fontSize: 13, color: 'var(--navy-300)', fontWeight: 500, minWidth: 30 }}>{unit}</span>}
        </div>
      </div>

      {/* History — read-only for Slice 1 */}
      <div style={{ marginTop: 16 }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--navy-400)', textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 8 }}>
          Recent history
        </div>
        {history.length === 0 ? (
          <div style={{ fontSize: 12, color: 'var(--navy-400)', fontStyle: 'italic', padding: '8px 0' }}>
            No entries yet. This will be your first.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2, background: 'var(--navy-800)', border: '1px solid var(--navy-600)', borderRadius: 8, overflow: 'hidden' }}>
            {history.map((c, i) => {
              const delta = deltaLabel(i)
              return (
                <div key={c.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', fontSize: 12, borderBottom: i < history.length - 1 ? '1px solid var(--navy-700)' : 'none' }}>
                  <span style={{ color: 'var(--navy-300)' }}>Week of {formatWeek(c.week_start)}</span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ color: 'var(--navy-100)', fontWeight: 600 }}>{c.value}{unit && ` ${unit}`}</span>
                    {delta && (
                      <span style={{ fontSize: 11, color: delta.color, fontWeight: 600, minWidth: 44, textAlign: 'right' }}>{delta.text}</span>
                    )}
                  </span>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </Modal>
  )
}
