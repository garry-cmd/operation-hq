'use client'
import { useState } from 'react'
import type { RoadmapItem } from '@/lib/types'
import { getQuarterRange } from '@/lib/dateBuckets'
import Modal from './Modal'

/**
 * EditKRModal — KR edit modal with delete functionality.
 *
 * Extracted from OKRs.tsx in Chunk 4 (May 21) so Summary can open it in-place
 * on the All Spaces dashboard (click a KR card → modal opens directly, no
 * tab switch). The existing OKRs.tsx call site stays unchanged; only the
 * source file moved.
 *
 * Changes vs. the prior inline version:
 *  - Adds "Quarter-bound goal — no specific deadline" checkbox above the
 *    date fields. Checked → auto-sets dates to the KR's quarter range and
 *    disables the date inputs. Unchecked → date inputs return to editable.
 *  - Removes the duplicate "Health Status" dropdown that shipped in Chunk 1
 *    (the first one was missing 'not_started' and 'done'; both bound to the
 *    same state, so saving silently lost those options). The kept dropdown
 *    has the complete option set.
 */
export default function EditKRModal({ kr, onClose, onSave, onDelete, toast }: {
  kr: RoadmapItem
  onClose: () => void
  onSave: (kr: Partial<RoadmapItem>) => void
  onDelete: () => void
  toast: (m: string) => void
}) {
  const [title, setTitle] = useState(kr.title)
  const [healthStatus, setHealthStatus] = useState(kr.health_status)
  const [saving, setSaving] = useState(false)

  // Metric fields. All stored as strings so inputs stay controlled even when
  // empty; parsed on save. A KR is either a metric, a habit, or neither —
  // turning is_metric on forces is_habit off.
  const [isMetric, setIsMetric] = useState(kr.is_metric)
  const [metricUnit, setMetricUnit] = useState(kr.metric_unit ?? '')
  const [metricDirection, setMetricDirection] = useState<'up' | 'down'>(kr.metric_direction ?? 'up')
  const [startValue, setStartValue] = useState<string>(kr.start_value != null ? String(kr.start_value) : '')
  const [targetValue, setTargetValue] = useState<string>(kr.target_value != null ? String(kr.target_value) : '')

  // Time window. Required for non-habit KRs per the dated-KR rollout.
  // Habits don't surface these fields (they're ongoing, not bounded). Stored
  // as YYYY-MM-DD strings to match the DB and avoid TZ drift; empty string
  // = unset.
  const [startDate, setStartDate] = useState<string>(kr.start_date ?? '')
  const [endDate, setEndDate] = useState<string>(kr.end_date ?? '')

  // Quarter-bound flag (Chunk 4). When true, dates auto-set to the quarter
  // range and the date inputs are disabled. Hidden when kr.quarter is null
  // since there's no quarter to bind to.
  const [isQuarterBound, setIsQuarterBound] = useState(kr.is_quarter_bound)

  function toggleQuarterBound(checked: boolean) {
    setIsQuarterBound(checked)
    if (checked && kr.quarter) {
      const qRange = getQuarterRange(kr.quarter)
      if (qRange) {
        setStartDate(qRange.start)
        setEndDate(qRange.end)
      }
    }
    // When unchecked, leave dates as they are — user can edit them next.
  }

  async function save() {
    if (!title.trim()) return
    if (isMetric) {
      // Require enough config to make the metric meaningful. These power the
      // auto-compute + dashboard; a metric KR without them is inert.
      if (!metricUnit.trim() || startValue === '' || targetValue === '') {
        toast('Metric KRs need a unit, start, and target.')
        return
      }
      const s = Number(startValue), t = Number(targetValue)
      if (Number.isNaN(s) || Number.isNaN(t)) { toast('Start and target must be numbers.'); return }
      if (s === t) { toast('Start and target can\'t be the same value.'); return }
    }
    // Non-habit KRs require both dates. The All Spaces dashboard relies on
    // every non-habit KR having a window; missing dates would make it
    // invisible there.
    if (!kr.is_habit) {
      if (!startDate || !endDate) {
        toast('Start and end dates are required.')
        return
      }
      if (endDate < startDate) {
        toast('End date can\'t be before start date.')
        return
      }
    }
    setSaving(true)

    try {
      const updatedKR: Partial<RoadmapItem> = {
        title: title.trim(),
        health_status: healthStatus,
        is_metric: isMetric,
        // When metric is off, null out the metric-specific fields so stale
        // data doesn't resurface if the toggle gets flipped back on later.
        metric_unit:      isMetric ? metricUnit.trim() : null,
        metric_direction: isMetric ? metricDirection : null,
        start_value:      isMetric ? Number(startValue) : null,
        target_value:     isMetric ? Number(targetValue) : null,
        // Time window. Habits stay null (their fields aren't editable here);
        // every other KR gets the values from the inputs.
        start_date: kr.is_habit ? null : (startDate || null),
        end_date:   kr.is_habit ? null : (endDate || null),
        // Chunk 4: explicit quarter-level goal flag.
        is_quarter_bound: kr.is_habit ? false : isQuarterBound,
      }
      // Metric and habit are mutually exclusive — if we're turning metric on,
      // force is_habit off so the KR doesn't show up in Focus bubbles.
      if (isMetric && kr.is_habit) {
        updatedKR.is_habit = false
      }

      await onSave(updatedKR)
    } catch (error) {
      console.error('Failed to update KR:', error)
      toast('Failed to update KR')
    }

    setSaving(false)
  }

  // Show the quarter-bound checkbox only when the KR has a quarter to bind
  // to (and isn't a habit, which has no dates at all).
  const showQuarterBoundToggle = !kr.is_habit && !!kr.quarter

  return (
    <Modal
      title="Edit Key Result"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onDelete}
            style={{ color: 'var(--red-text)', marginRight: 'auto' }}
          >
            Delete
          </button>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button
            className="btn-primary"
            onClick={save}
            disabled={saving || !title.trim()}
          >
            {saving ? 'Saving...' : 'Save Changes'}
          </button>
        </>
      }
    >
      <div className="field">
        <label>Title</label>
        <input
          className="input"
          value={title}
          onChange={e => setTitle(e.target.value)}
          autoFocus
          placeholder="e.g. Lose 20 lbs"
        />
      </div>

      {/* Status — single dropdown with the complete option set. The Chunk 1
          editor had two dropdowns bound to the same state with partial option
          lists; consolidated here. */}
      <div className="field">
        <label>Status</label>
        <select
          className="input"
          value={healthStatus}
          onChange={e => setHealthStatus(e.target.value as RoadmapItem['health_status'])}
        >
          <option value="not_started">Not started</option>
          <option value="backlog">Backlog</option>
          <option value="on_track">On track</option>
          <option value="off_track">Off track</option>
          <option value="waiting">Waiting</option>
          <option value="blocked">Blocked</option>
          <option value="done">Done</option>
        </select>
      </div>

      {/* Quarter-bound toggle — only for non-habits with a quarter. Checking
          it locks dates to the quarter range and disables the date inputs;
          unchecking returns the user to date-editing. */}
      {showQuarterBoundToggle && (
        <div className="field">
          <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', marginBottom: 4 }}>
            <input
              type="checkbox"
              checked={isQuarterBound}
              onChange={e => toggleQuarterBound(e.target.checked)}
              style={{ width: 16, height: 16 }}
            />
            <span style={{ fontWeight: 600, color: 'var(--navy-100)' }}>Quarter-bound goal — no specific deadline</span>
          </label>
          <div style={{ fontSize: 12, color: 'var(--navy-400)', marginLeft: 26 }}>
            Locks the range to the full quarter. Use for goals that genuinely
            span the whole period (&ldquo;Learn 10 verbs this quarter&rdquo;).
          </div>
        </div>
      )}

      {/* Time window — required for non-habit KRs. Habits don't get these
          fields; they're ongoing, not bounded by a window. The All Spaces
          dashboard buckets KRs by end_date, so missing dates = invisible.
          Disabled when isQuarterBound is on. */}
      {!kr.is_habit && (
        <div className="field" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <div>
            <label style={{ display: 'block', marginBottom: 4 }}>Start date</label>
            <input
              className="input"
              type="date"
              value={startDate}
              onChange={e => setStartDate(e.target.value)}
              disabled={isQuarterBound}
              style={isQuarterBound ? { opacity: 0.6, cursor: 'not-allowed' } : undefined}
            />
          </div>
          <div>
            <label style={{ display: 'block', marginBottom: 4 }}>End date</label>
            <input
              className="input"
              type="date"
              value={endDate}
              onChange={e => setEndDate(e.target.value)}
              disabled={isQuarterBound}
              style={isQuarterBound ? { opacity: 0.6, cursor: 'not-allowed' } : undefined}
            />
          </div>
        </div>
      )}

      {/* Metric KR config — collapsed behind a toggle to keep the modal light
          for normal outcome KRs. Only shows the detail fields when on. */}
      <div className="field" style={{ borderTop: '1px solid var(--navy-600)', paddingTop: 14, marginTop: 6 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', marginBottom: 4 }}>
          <input
            type="checkbox"
            checked={isMetric}
            onChange={e => setIsMetric(e.target.checked)}
            style={{ width: 16, height: 16 }}
          />
          <span style={{ fontWeight: 600, color: 'var(--navy-100)' }}>Track as a metric</span>
        </label>
        <div style={{ fontSize: 12, color: 'var(--navy-400)', marginLeft: 26 }}>
          Log a number each week (weight, net worth, revenue, etc.). Progress auto-computes.
        </div>
      </div>

      {isMetric && (
        <div style={{ background: 'var(--navy-800)', border: '1px solid var(--navy-600)', borderRadius: 10, padding: '12px 14px', marginTop: 4 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--navy-300)', display: 'block', marginBottom: 4 }}>Unit</label>
              <input className="input" value={metricUnit} onChange={e => setMetricUnit(e.target.value)} placeholder="lbs, $, %" />
            </div>
            <div>
              <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--navy-300)', display: 'block', marginBottom: 4 }}>Direction</label>
              <select className="input" value={metricDirection} onChange={e => setMetricDirection(e.target.value as 'up' | 'down')}>
                <option value="up">Up is better</option>
                <option value="down">Down is better</option>
              </select>
            </div>
            <div>
              <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--navy-300)', display: 'block', marginBottom: 4 }}>Start value</label>
              <input className="input" type="number" inputMode="decimal" value={startValue} onChange={e => setStartValue(e.target.value)} placeholder="e.g. 215" />
            </div>
            <div>
              <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--navy-300)', display: 'block', marginBottom: 4 }}>Target value</label>
              <input className="input" type="number" inputMode="decimal" value={targetValue} onChange={e => setTargetValue(e.target.value)} placeholder="e.g. 190" />
            </div>
          </div>
          {/* Target date moved up to the top-level Start/End date fields
              shared with every non-habit KR. The "by Jun 30" displayed on
              metric cards now reads from end_date. */}
        </div>
      )}
    </Modal>
  )
}
