'use client'
import { useState } from 'react'
import { AnnualObjective } from '@/lib/types'
import { COLORS } from '@/lib/utils'
import Modal from './Modal'

// Objective edit modal with delete. Extracted from OKRs.tsx (Jun 2026) so both
// the OKR tab and Home can open it in-place.
export default function EditObjectiveModal({ objective, onClose, onSave, onDelete, toast }: {
  objective: AnnualObjective
  onClose: () => void
  onSave: (obj: Partial<AnnualObjective>) => void
  onDelete: () => void
  toast: (m: string) => void
}) {
  const [name, setName] = useState(objective.name)
  const [color, setColor] = useState(objective.color)
  const [status, setStatus] = useState(objective.status)
  const [startDate, setStartDate] = useState<string>(objective.start_date ?? '')
  const [endDate, setEndDate] = useState<string>(objective.end_date ?? '')
  const [saving, setSaving] = useState(false)

  async function save() {
    if (!name.trim()) return
    if (startDate && endDate && endDate < startDate) {
      toast('End date can\'t be before start date.')
      return
    }
    setSaving(true)
    try {
      await onSave({
        name: name.trim(),
        color: color,
        status: status,
        start_date: startDate || null,
        end_date: endDate || null,
      })
    } catch (error) {
      console.error('Failed to update objective:', error)
      toast('Failed to update objective')
    }
    setSaving(false)
  }

  return (
    <Modal
      title="Edit Objective"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onDelete} style={{ color: 'var(--red-text)', marginRight: 'auto' }}>
            Delete
          </button>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={save} disabled={saving || !name.trim()}>
            {saving ? 'Saving...' : 'Save Changes'}
          </button>
        </>
      }
    >
      <div className="field">
        <label>Objective Name</label>
        <textarea className="input" rows={3} value={name} onChange={e => setName(e.target.value)} autoFocus
          placeholder="e.g. Get in amazing shape this year" />
      </div>

      <div className="field">
        <label>Color</label>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {COLORS.map(c => (
            <button key={c} onClick={() => setColor(c)}
              style={{ width: 32, height: 32, borderRadius: '50%', background: c,
                border: color === c ? '3px solid var(--navy-50)' : '2px solid transparent',
                cursor: 'pointer', outline: color === c ? '2px solid ' + c : 'none', outlineOffset: 2 }} />
          ))}
        </div>
      </div>

      <div className="field">
        <label>Time window <span style={{ color: 'var(--nw-label-dim)', fontWeight: 400 }}>(optional)</span></label>
        <div style={{ display: 'flex', gap: 10 }}>
          <div style={{ flex: 1 }}>
            <label style={{ display: 'block', marginBottom: 4, fontSize: 11, color: 'var(--nw-label-dim)' }}>Start</label>
            <input className="input" type="date" value={startDate} onChange={e => setStartDate(e.target.value)} />
          </div>
          <div style={{ flex: 1 }}>
            <label style={{ display: 'block', marginBottom: 4, fontSize: 11, color: 'var(--nw-label-dim)' }}>End</label>
            <input className="input" type="date" value={endDate} onChange={e => setEndDate(e.target.value)} />
          </div>
        </div>
      </div>

      <div className="field">
        <label>Status</label>
        <select className="input" value={status} onChange={e => setStatus(e.target.value as AnnualObjective['status'])}>
          <option value="active">Active</option>
          <option value="completed">Completed</option>
          <option value="abandoned">Abandoned</option>
        </select>
      </div>
    </Modal>
  )
}
