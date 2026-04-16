'use client'
import { useState, useRef, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import { AnnualObjective, RoadmapItem, QuarterlyKR, WeeklyAction, KRStatus } from '@/lib/types'
import { ACTIVE_Q, addWeeks, formatWeek } from '@/lib/utils'
import StatusPill from './StatusPill'
import Modal from './Modal'

interface Props {
  objectives: AnnualObjective[]
  roadmapItems: RoadmapItem[]
  krs: QuarterlyKR[]
  setKrs: (fn: (p: QuarterlyKR[]) => QuarterlyKR[]) => void
  actions: WeeklyAction[]
  setActions: (fn: (p: WeeklyAction[]) => WeeklyAction[]) => void
  weekStart: string
  setWeekStart: (fn: (s: string) => string) => void
  toast: (m: string) => void
}

const N = {
  bg:     'var(--navy-700)',
  bg2:    'var(--navy-800)',
  bg3:    'var(--navy-600)',
  border: '1px solid var(--navy-600)',
  border2:'1px solid var(--navy-500)',
  t1:     'var(--navy-50)',
  t2:     'var(--navy-200)',
  t3:     'var(--navy-300)',
  t4:     'var(--navy-400)',
  t5:     'var(--navy-500)',
  acc:    'var(--accent)',
  accDim: 'var(--accent-dim)',
  teal:   'var(--teal)',
  tealBg: 'var(--teal-bg)',
  tealT:  'var(--teal-text)',
}

export default function OKRs({ objectives, roadmapItems, krs, setKrs, actions, setActions, weekStart, setWeekStart, toast }: Props) {
  const [addKRModal, setAddKRModal] = useState<null | { roadmapItemId: string }>(null)

  const activeItems = roadmapItems.filter(i => i.quarter === ACTIVE_Q && i.status !== 'abandoned')
  const allKrs = krs.filter(k => activeItems.some(i => i.id === k.roadmap_item_id))
  const weekActions = actions.filter(a => a.week_start === weekStart)
  const doneCount = allKrs.filter(k => k.status === 'done').length
  const onTrack = allKrs.filter(k => k.status === 'on_track').length
  const offTrack = allKrs.filter(k => k.status === 'off_track').length
  const taskTotal = weekActions.length
  const taskDone = weekActions.filter(a => a.completed).length
  const taskPct = taskTotal > 0 ? Math.round(taskDone / taskTotal * 100) : 0

  async function setKRStatus(kr: QuarterlyKR, status: KRStatus) {
    await supabase.from('quarterly_krs').update({ status }).eq('id', kr.id)
    setKrs(prev => prev.map(k => k.id === kr.id ? { ...k, status } : k))
  }

  async function toggleAction(action: WeeklyAction) {
    const next = !action.completed
    await supabase.from('weekly_actions').update({ completed: next }).eq('id', action.id)
    setActions(prev => prev.map(a => a.id === action.id ? { ...a, completed: next } : a))
  }

  async function addAction(krId: string, title: string) {
    if (!title.trim()) return
    const { data } = await supabase.from('weekly_actions')
      .insert({ quarterly_kr_id: krId, title, week_start: weekStart }).select().single()
    if (data) setActions(prev => [...prev, data])
  }

  async function carryForward() {
    const nextWeek = addWeeks(weekStart, 1)
    const incomplete = weekActions.filter(a => !a.completed)
    if (!incomplete.length) { toast('No incomplete actions to carry forward.'); return }
    const { data } = await supabase.from('weekly_actions')
      .insert(incomplete.map(a => ({ quarterly_kr_id: a.quarterly_kr_id, title: a.title, week_start: nextWeek, carried_over: true })))
      .select()
    if (data) { setActions(prev => [...prev, ...data]); toast(`${data.length} action${data.length > 1 ? 's' : ''} carried to next week.`) }
  }

  const navBtnStyle: React.CSSProperties = {
    width: 26, height: 26, borderRadius: '50%', background: N.bg2,
    border: N.border2, color: N.t3, fontSize: 15, display: 'flex',
    alignItems: 'center', justifyContent: 'center', cursor: 'pointer', lineHeight: '1',
  }

  return (
    <div>
      {/* Page header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <div>
          <h1 style={{ fontSize: 14, fontWeight: 600, color: N.t1 }}>{ACTIVE_Q} Objectives &amp; Key Results</h1>
          <p style={{ fontSize: 11, color: N.t4, marginTop: 2 }}>Sourced from your {ACTIVE_Q} roadmap milestones</p>
        </div>
        <span style={{ fontSize: 11, fontWeight: 600, padding: '4px 12px', borderRadius: 99, background: N.accDim, color: N.acc }}>
          Apr 1 – Jun 30
        </span>
      </div>

      {/* Summary row — 5 cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', gap: 8, marginBottom: 18 }}>
        {[
          ['Objectives', activeItems.length, N.acc, null],
          ['KRs complete', `${doneCount}/${allKrs.length}`, N.tealT, null],
          ['On track', onTrack, N.tealT, null],
          ['Off track', offTrack, 'var(--red-text)', null],
        ].map(([label, val, color]) => (
          <div key={label as string} style={{ background: N.bg, border: N.border, borderRadius: 12, padding: '10px 12px' }}>
            <div style={{ fontSize: 10, color: N.t4, marginBottom: 3, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '.4px' }}>{label}</div>
            <div style={{ fontSize: 22, fontWeight: 700, color: color as string }}>{val}</div>
          </div>
        ))}
        {/* Live tasks KPI */}
        <div style={{ background: N.bg, border: `1px solid ${taskDone === taskTotal && taskTotal > 0 ? N.teal : N.bg3}`, borderRadius: 12, padding: '10px 12px', position: 'relative', overflow: 'hidden', transition: 'border-color .3s' }}>
          <div style={{ fontSize: 10, color: N.t4, marginBottom: 3, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '.4px' }}>Tasks this week</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: N.t1 }}>{taskTotal}</div>
          <div style={{ fontSize: 10, color: N.t5, marginTop: 2 }}>{taskDone} done</div>
          <div style={{ position: 'absolute', bottom: 0, left: 0, height: 2, background: taskDone === taskTotal && taskTotal > 0 ? N.teal : N.acc, width: `${taskPct}%`, transition: 'width .3s, background .3s' }} />
        </div>
      </div>

      {/* Objective groups */}
      {activeItems.length === 0 && (
        <div style={{ textAlign: 'center', padding: '48px 0', color: N.t4, fontSize: 13 }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>📋</div>
          No active roadmap items for {ACTIVE_Q}. Add milestones on the Roadmap tab.
        </div>
      )}

      {activeItems.map(item => {
        const obj = objectives.find(o => o.id === item.annual_objective_id)
        const itemKrs = krs.filter(k => k.roadmap_item_id === item.id)
        const done = itemKrs.filter(k => k.status === 'done').length
        const pct = itemKrs.length ? Math.round(done / itemKrs.length * 100) : 0

        return (
          <div key={item.id} style={{ marginBottom: 10 }}>
            {/* Annual objective header */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 6, padding: '0 2px' }}>
              <div style={{ width: 8, height: 8, borderRadius: '50%', background: obj?.color ?? '#888', flexShrink: 0 }} />
              <div style={{ fontSize: 10, fontWeight: 700, color: N.t3, textTransform: 'uppercase', letterSpacing: '.6px', whiteSpace: 'nowrap' }}>
                {obj?.name ?? ''}
              </div>
              <div style={{ flex: 1, height: 1, background: N.bg3 }} />
            </div>

            {/* Objective card */}
            <div style={{ background: N.bg, border: N.border, borderRadius: 14, overflow: 'hidden' }}>
              {/* Objective header */}
              <div style={{ padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 10, borderBottom: N.border }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: N.t1, flex: 1 }}>{item.title}</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                  <div style={{ width: 64, height: 3, borderRadius: 2, background: N.bg3 }}>
                    <div style={{ height: 3, borderRadius: 2, background: obj?.color ?? N.teal, width: `${pct}%`, transition: 'width .3s' }} />
                  </div>
                  <span style={{ fontSize: 10, color: N.t4, minWidth: 24, textAlign: 'right' }}>{pct}%</span>
                </div>
              </div>

              {/* KR rows */}
              {itemKrs.map(kr => (
                <div key={kr.id} style={{ padding: '7px 14px 7px 36px', display: 'flex', alignItems: 'flex-start', gap: 8, borderBottom: `1px solid var(--navy-800)` }}>
                  <button onClick={() => setKRStatus(kr, kr.status === 'done' ? 'not_started' : 'done')}
                    style={{ width: 13, height: 13, borderRadius: 3, border: `1.5px solid ${kr.status === 'done' ? N.teal : N.bg3}`, background: kr.status === 'done' ? N.teal : 'transparent', flexShrink: 0, marginTop: 2, marginLeft: -22, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', transition: 'all .12s' }}>
                    {kr.status === 'done' && <svg width="8" height="6" viewBox="0 0 8 6" fill="none"><path d="M1 3L3 5L7 1" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                  </button>
                  <span style={{ fontSize: 11, flex: 1, lineHeight: 1.4, color: kr.status === 'done' ? N.t5 : N.t2, textDecoration: kr.status === 'done' ? 'line-through' : 'none' }}>
                    {kr.title}
                  </span>
                  {kr.tag && <span style={{ fontSize: 9, padding: '2px 6px', borderRadius: 6, background: N.bg3, color: N.t4, flexShrink: 0 }}>{kr.tag}</span>}
                  <select value={kr.status} onChange={e => setKRStatus(kr, e.target.value as KRStatus)}
                    style={{ fontSize: 10, border: N.border2, borderRadius: 8, padding: '2px 6px', background: N.bg2, color: N.t2, flexShrink: 0 }}>
                    <option value="not_started">Not started</option>
                    <option value="on_track">On track</option>
                    <option value="off_track">Off track</option>
                    <option value="blocked">Blocked</option>
                    <option value="done">Done</option>
                  </select>
                </div>
              ))}

              <div style={{ padding: '7px 14px', borderTop: `1px solid var(--navy-800)` }}>
                <button style={{ fontSize: 11, background: 'none', border: 'none', cursor: 'pointer', color: N.t5 }}
                  onMouseEnter={e => (e.currentTarget.style.color = N.acc)}
                  onMouseLeave={e => (e.currentTarget.style.color = N.t5)}
                  onClick={() => setAddKRModal({ roadmapItemId: item.id })}>+ add key result</button>
              </div>
            </div>
          </div>
        )
      })}

      {/* Divider */}
      {activeItems.length > 0 && (
        <div style={{ margin: '20px 0 14px', display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ flex: 1, height: 1, background: N.bg3 }} />
          <div style={{ fontSize: 10, fontWeight: 700, color: N.t4, textTransform: 'uppercase', letterSpacing: '.6px', whiteSpace: 'nowrap' }}>
            Focus this week
          </div>
          <div style={{ flex: 1, height: 1, background: N.bg3 }} />
        </div>
      )}

      {/* Focus This Week panel */}
      {activeItems.length > 0 && (
        <div style={{ background: N.bg, border: `1px solid ${N.bg3}`, borderRadius: 16, overflow: 'hidden' }}>
          {/* Panel header */}
          <div style={{ padding: '14px 16px', borderBottom: N.border, display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: N.t1 }}>Focus this week</div>
              <div style={{ fontSize: 11, color: N.t4, marginTop: 1 }}>Actions driving your active KRs</div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
              <button style={navBtnStyle} onClick={() => setWeekStart(s => addWeeks(s, -1))}>‹</button>
              <span style={{ fontSize: 12, fontWeight: 600, color: N.t2, minWidth: 56, textAlign: 'center' }}>{formatWeek(weekStart)}</span>
              <button style={navBtnStyle} onClick={() => setWeekStart(s => addWeeks(s, 1))}>›</button>
            </div>
          </div>

          {/* Action groups — one per active objective */}
          {activeItems.map((item, idx) => {
            const obj = objectives.find(o => o.id === item.annual_objective_id)
            const itemKrs = krs.filter(k => k.roadmap_item_id === item.id)
            const itemActions = weekActions.filter(a => itemKrs.some(k => k.id === a.quarterly_kr_id))
            const groupDone = itemActions.filter(a => a.completed).length

            return (
              <div key={item.id} style={{ padding: '12px 16px', borderBottom: idx < activeItems.length - 1 ? `1px solid var(--navy-800)` : 'none' }}>
                {/* Group header */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 8 }}>
                  <div style={{ width: 8, height: 8, borderRadius: '50%', background: obj?.color ?? '#888', flexShrink: 0 }} />
                  <div style={{ fontSize: 10, fontWeight: 700, color: N.t3, textTransform: 'uppercase', letterSpacing: '.5px', flex: 1 }}>
                    {obj?.name ?? item.title}
                  </div>
                  <div style={{ fontSize: 10, color: N.t5 }}>{groupDone}/{itemActions.length} done</div>
                </div>

                {/* Actions */}
                {itemActions.map(action => {
                  const kr = krs.find(k => k.id === action.quarterly_kr_id)
                  return (
                    <div key={action.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '5px 0' }}>
                      <button onClick={() => toggleAction(action)}
                        style={{ width: 16, height: 16, borderRadius: '50%', border: `1.5px solid ${action.completed ? N.teal : N.bg3}`, background: action.completed ? N.teal : 'transparent', flexShrink: 0, marginTop: 1, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all .15s' }}>
                        {action.completed && <svg width="8" height="6" viewBox="0 0 8 6" fill="none"><path d="M1 3L3 5L7 1" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                      </button>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 12, color: action.completed ? N.t5 : N.t1, textDecoration: action.completed ? 'line-through' : 'none', lineHeight: 1.35, display: 'flex', alignItems: 'center', gap: 6 }}>
                          {action.title}
                          {action.carried_over && (
                            <span style={{ fontSize: 9, fontWeight: 600, padding: '1px 6px', borderRadius: 99, background: 'var(--amber-bg)', color: 'var(--amber-text)', flexShrink: 0 }}>carried</span>
                          )}
                        </div>
                        {kr && <div style={{ fontSize: 10, color: N.t5, marginTop: 2 }}>↑ {kr.title}</div>}
                      </div>
                    </div>
                  )
                })}

                <InlineAddAction
                  krs={itemKrs}
                  onAdd={(krId, title) => addAction(krId, title)}
                />
              </div>
            )
          })}

          {/* Footer */}
          <div style={{ padding: '12px 16px', borderTop: N.border, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <button
              style={{ fontSize: 11, fontWeight: 600, color: N.acc, background: 'none', border: `1px solid ${N.accDim}`, borderRadius: 10, padding: '6px 14px', cursor: 'pointer' }}
              onClick={carryForward}>
              Carry incomplete to next week →
            </button>
            <span style={{ fontSize: 11, color: N.t5 }}>{taskDone} of {taskTotal} done</span>
          </div>
        </div>
      )}

      {/* Add KR modal */}
      {addKRModal && (
        <AddKRModal
          roadmapItemId={addKRModal.roadmapItemId}
          krs={krs}
          onClose={() => setAddKRModal(null)}
          onSave={(kr) => { setKrs(prev => [...prev, kr]); setAddKRModal(null); toast('Key result added!') }}
        />
      )}
    </div>
  )
}

/* Inline add action with KR picker */
function InlineAddAction({ krs, onAdd }: { krs: QuarterlyKR[]; onAdd: (krId: string, title: string) => void }) {
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [krId, setKrId] = useState(krs[0]?.id ?? '')
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => { if (open) inputRef.current?.focus() }, [open])

  function save(e: React.FormEvent) {
    e.preventDefault()
    if (!title.trim() || !krId) return
    onAdd(krId, title)
    setTitle('')
    setOpen(false)
  }

  if (!open) return (
    <div style={{ marginTop: 6 }}>
      <button style={{ fontSize: 11, color: 'var(--navy-500)', background: 'none', border: 'none', cursor: 'pointer', padding: '3px 0' }}
        onMouseEnter={e => (e.currentTarget.style.color = 'var(--accent)')}
        onMouseLeave={e => (e.currentTarget.style.color = 'var(--navy-500)')}
        onClick={() => setOpen(true)}>+ add action</button>
    </div>
  )

  return (
    <form onSubmit={save} style={{ marginTop: 8, background: 'var(--navy-800)', border: '1px solid var(--navy-600)', borderRadius: 12, padding: '10px 12px' }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--navy-400)', marginBottom: 8 }}>New action</div>
      <input ref={inputRef} value={title} onChange={e => setTitle(e.target.value)}
        placeholder="What do you need to do?"
        style={{ width: '100%', background: 'var(--navy-700)', border: '1px solid var(--navy-500)', borderRadius: 8, padding: '7px 10px', fontSize: 12, color: 'var(--navy-50)', fontFamily: 'inherit', marginBottom: 8, outline: 'none' }} />
      <select value={krId} onChange={e => setKrId(e.target.value)}
        style={{ width: '100%', background: 'var(--navy-700)', border: '1px solid var(--navy-500)', borderRadius: 8, padding: '7px 10px', fontSize: 12, color: 'var(--navy-200)', fontFamily: 'inherit', marginBottom: 8 }}>
        {krs.map(kr => (
          <option key={kr.id} value={kr.id}>{kr.title}</option>
        ))}
      </select>
      <div style={{ display: 'flex', gap: 8 }}>
        <button type="submit" style={{ fontSize: 12, fontWeight: 600, padding: '6px 14px', borderRadius: 8, background: 'var(--accent)', color: '#fff', border: 'none', cursor: 'pointer' }}>
          Add action
        </button>
        <button type="button" onClick={() => { setOpen(false); setTitle('') }}
          style={{ fontSize: 12, padding: '6px 14px', borderRadius: 8, background: 'transparent', color: 'var(--navy-400)', border: '1px solid var(--navy-600)', cursor: 'pointer' }}>
          Cancel
        </button>
      </div>
    </form>
  )
}

/* Add KR modal */
function AddKRModal({ roadmapItemId, krs, onClose, onSave }: {
  roadmapItemId: string; krs: QuarterlyKR[]
  onClose: () => void; onSave: (kr: QuarterlyKR) => void
}) {
  const [title, setTitle] = useState('')
  const [tag, setTag] = useState('')
  const [saving, setSaving] = useState(false)

  async function save() {
    if (!title.trim()) return
    setSaving(true)
    const count = krs.filter(k => k.roadmap_item_id === roadmapItemId).length
    const { data } = await supabase.from('quarterly_krs')
      .insert({ roadmap_item_id: roadmapItemId, title, tag: tag || null, sort_order: count }).select().single()
    if (data) onSave(data)
    setSaving(false)
  }

  return (
    <Modal title="Add key result" onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Add KR'}</button></>}>
      <div className="field">
        <label>Key result</label>
        <textarea className="input" rows={3} value={title} onChange={e => setTitle(e.target.value)} autoFocus
          placeholder="e.g. Maintain 500–750 kcal deficit, logged 6 days/week" />
      </div>
      <div className="field">
        <label>Tag (optional)</label>
        <input className="input" value={tag} onChange={e => setTag(e.target.value)} placeholder="e.g. Nutrition, Weekly, Content…" />
      </div>
    </Modal>
  )
}
