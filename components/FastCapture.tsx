'use client'
import { useState, useRef, useEffect, useMemo } from 'react'
import * as krsDb from '@/lib/db/krs'
import * as objectivesDb from '@/lib/db/objectives'
import * as actionsDb from '@/lib/db/actions'
import * as tasksDb from '@/lib/db/tasks'
import * as notesDb from '@/lib/db/notes'
import { AnnualObjective, RoadmapItem, WeeklyAction, Space, Task, Note } from '@/lib/types'
import { ACTIVE_Q, COLORS } from '@/lib/utils'
import { getCurrentQuarterKRs } from '@/lib/krFilters'
import { spaceDisplayColorById } from '@/lib/spaceColor'
import { textToTipTapDoc } from '@/lib/notes/textToDoc'

type Props = {
  spaces: Space[]
  objectives: AnnualObjective[]    // ALL spaces (FAB is a global capture surface)
  roadmapItems: RoadmapItem[]      // ALL spaces
  weekStart: string
  activeSpaceId: string
  setObjectives: (fn: (p: AnnualObjective[]) => AnnualObjective[]) => void
  setRoadmapItems: (fn: (p: RoadmapItem[]) => RoadmapItem[]) => void
  setActions: (fn: (p: WeeklyAction[]) => WeeklyAction[]) => void
  setTasks: React.Dispatch<React.SetStateAction<Task[]>>
  setNotes: React.Dispatch<React.SetStateAction<Note[]>>
  toast: (m: string) => void
}

type CaptureType = 'task' | 'note' | 'action' | 'keyresult' | 'parking' | 'objective'

// Order matters: index 0 sits closest to the FAB (first thumb-hit), last index
// highest in the stack. Daily captures (Task, Note) nearest; strategic above.
const TYPES: { id: CaptureType; label: string; color: string; icon: string }[] = [
  { id: 'task',      label: 'Task',        color: 'var(--accent)',      icon: '✓'  },
  { id: 'note',      label: 'Note',        color: 'var(--indigo-text)', icon: '✎'  },
  { id: 'action',    label: 'Action',      color: 'var(--teal-text)',   icon: '◆'  },
  { id: 'keyresult', label: 'Key Result',  color: 'var(--navy-300)',    icon: 'KR' },
  { id: 'parking',   label: 'Parking Lot', color: '#c8a040',            icon: 'P'  },
  { id: 'objective', label: 'Objective',   color: '#5a6a9a',            icon: 'O'  },
]

function ymdLocal(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export default function FastCapture({
  spaces, objectives, roadmapItems, weekStart, activeSpaceId,
  setObjectives, setRoadmapItems, setActions, setTasks, setNotes, toast,
}: Props) {
  const [dialOpen, setDialOpen] = useState(false)
  const [active, setActive] = useState<CaptureType | null>(null)
  const [title, setTitle] = useState('')
  const [secondVal, setSecondVal] = useState('') // KR id (action) / obj id (keyresult) / space id (task/note/parking/objective)
  const [noteBody, setNoteBody] = useState('')
  const [dueChoice, setDueChoice] = useState<'none' | 'today' | 'tomorrow'>('none')
  const [krSearch, setKrSearch] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const orderedSpaces = useMemo(() => [...spaces].sort((a, b) => a.sort_order - b.sort_order), [spaces])
  const activeKRs = useMemo(() => getCurrentQuarterKRs(roadmapItems, ACTIVE_Q), [roadmapItems])
  const activeObjs = useMemo(() => objectives.filter(o => o.status === 'active'), [objectives])

  useEffect(() => {
    if (!active) return
    if (active === 'action')    setSecondVal(activeKRs[0]?.id ?? '')
    else if (active === 'keyresult') setSecondVal(activeObjs[0]?.id ?? '')
    else                        setSecondVal(activeSpaceId) // task / note / parking / objective default to active space
    setNoteBody(''); setDueChoice('none'); setKrSearch('')
    setTimeout(() => inputRef.current?.focus(), 50)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active])

  function openType(type: CaptureType) { setActive(type); setDialOpen(false); setTitle('') }
  function close() { setActive(null); setDialOpen(false); setTitle(''); setSecondVal(''); setNoteBody(''); setDueChoice('none'); setKrSearch('') }

  async function save(e: React.FormEvent) {
    e.preventDefault()
    const hasTitle = !!title.trim()
    // Notes may be body-only; everything else needs a title.
    if (active === 'note' ? (!hasTitle && !noteBody.trim()) : !hasTitle) return
    try {
      if (active === 'task') {
        const due = dueChoice === 'none' ? null
          : dueChoice === 'today' ? ymdLocal(new Date())
          : ymdLocal(new Date(Date.now() + 86_400_000))
        const created = await tasksDb.create({
          title: title.trim(),
          space_id: secondVal || activeSpaceId,
          due_date: due,
        })
        setTasks(prev => [...prev, created])
        toast('Task added!')
      }
      if (active === 'note') {
        const created = await notesDb.create({
          title: title.trim(),
          space_id: secondVal || null, // '' = unified Inbox
          body: noteBody.trim() ? textToTipTapDoc(noteBody) : null,
        })
        setNotes(prev => [...prev, created])
        toast('Note added!')
      }
      if (active === 'objective') {
        const sid = secondVal || activeSpaceId
        const color = COLORS[objectives.length % COLORS.length]
        const created = await objectivesDb.create({
          name: title.trim(), color, sort_order: objectives.length, status: 'active', space_id: sid,
        })
        setObjectives(prev => [...prev, created])
        toast('Objective added!')
      }
      if (active === 'keyresult' && secondVal) {
        const parent = objectives.find(o => o.id === secondVal)
        if (!parent) return
        const count = roadmapItems.filter(i => i.annual_objective_id === secondVal && i.quarter === ACTIVE_Q).length
        const created = await krsDb.create({
          space_id: parent.space_id, annual_objective_id: secondVal, title,
          quarter: ACTIVE_Q, status: 'active', health_status: 'not_started', sort_order: count,
        })
        setRoadmapItems(prev => [...prev, created])
        toast('Key result added!')
      }
      if (active === 'action' && secondVal) {
        const created = await actionsDb.create({ roadmap_item_id: secondVal, title, week_start: weekStart })
        setActions(prev => [...prev, created])
        toast('Action added!')
      }
      if (active === 'parking') {
        const sid = secondVal || activeSpaceId
        const created = await krsDb.create({
          space_id: sid, annual_objective_id: null, title, quarter: null,
          status: 'planned', is_parked: true, sort_order: roadmapItems.filter(i => i.is_parked).length,
        })
        setRoadmapItems(prev => [...prev, created])
        toast('Idea parked!')
      }
      close()
    } catch { toast('Something went wrong.') }
  }

  const typeInfo = TYPES.find(t => t.id === active)

  // Entity picker options (action → KRs, keyresult → objectives), color-coded by space.
  const entityOptions = useMemo(() => {
    if (active === 'action')    return activeKRs.map(k => ({ id: k.id, label: k.title, spaceId: k.space_id }))
    if (active === 'keyresult') return activeObjs.map(o => ({ id: o.id, label: o.name, spaceId: o.space_id }))
    return []
  }, [active, activeKRs, activeObjs])

  const filteredOptions = useMemo(() => {
    const q = krSearch.trim().toLowerCase()
    if (!q) return entityOptions
    return entityOptions.filter(o => o.label.toLowerCase().includes(q))
  }, [entityOptions, krSearch])

  const spaceName = (id: string) => orderedSpaces.find(s => s.id === id)?.name ?? ''

  const canSave =
    active === 'note' ? (!!title.trim() || !!noteBody.trim()) :
    active === 'action' ? (!!title.trim() && !!secondVal) :
    active === 'keyresult' ? (!!title.trim() && !!secondVal) :
    !!title.trim()

  return (
    <>
      {(dialOpen || active) && <div onClick={close} style={{ position: 'fixed', inset: 0, zIndex: 44, background: 'rgba(0,0,0,0.5)' }} />}

      {dialOpen && TYPES.map((t, i) => (
        <button key={t.id} onClick={() => openType(t.id)}
          style={{ position: 'fixed', right: 16, bottom: `${88 + 56 + (i * 52)}px`, zIndex: 46, display: 'flex', alignItems: 'center', gap: 10, background: 'var(--navy-700)', border: `1px solid ${t.color}`, borderRadius: 99, padding: '8px 14px 8px 10px', cursor: 'pointer', color: 'var(--navy-50)', fontSize: 13, fontWeight: 600, animation: `fabIn .15s ease ${i * 0.04}s both` }}>
          <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'var(--navy-600)', border: `1.5px solid ${t.color}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 700, color: t.color, flexShrink: 0 }}>{t.icon}</div>
          {t.label}
        </button>
      ))}

      <button onClick={() => dialOpen ? close() : setDialOpen(true)}
        style={{ position: 'fixed', right: 16, bottom: 88, zIndex: 47, width: 48, height: 48, borderRadius: '50%', background: dialOpen ? 'var(--navy-500)' : 'var(--accent)', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 4px 20px rgba(0,0,0,0.4)', transition: 'background .15s, transform .15s', transform: dialOpen ? 'rotate(45deg)' : 'rotate(0deg)' }}>
        <svg width="22" height="22" viewBox="0 0 22 22" fill="none"><path d="M11 4v14M4 11h14" stroke="white" strokeWidth="2" strokeLinecap="round"/></svg>
      </button>

      {active && (
        <div style={{ position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 48, background: 'var(--navy-700)', borderTop: `2px solid ${typeInfo?.color}`, borderRadius: '20px 20px 0 0', padding: '20px 20px 32px', animation: 'sheetUp .2s ease', maxHeight: '80vh', overflowY: 'auto' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 18 }}>
            <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'var(--navy-600)', border: `1.5px solid ${typeInfo?.color}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, color: typeInfo?.color, flexShrink: 0 }}>{typeInfo?.icon}</div>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 16, fontWeight: 600, color: 'var(--navy-50)', letterSpacing: '-.01em' }}>Add {typeInfo?.label}</div>
            <button onClick={close} style={{ marginLeft: 'auto', fontSize: 20, color: 'var(--navy-400)', background: 'none', border: 'none', cursor: 'pointer', padding: '4px 6px' }}>×</button>
          </div>

          <form onSubmit={save}>
            <input ref={inputRef} value={title} onChange={e => setTitle(e.target.value)}
              placeholder={
                active === 'objective' ? 'e.g. Get in amazing shape this year' :
                active === 'keyresult' ? 'e.g. Lose 40 lbs by June 30' :
                active === 'action'    ? 'e.g. Wednesday strength session' :
                active === 'task'      ? 'e.g. Email the vendor about pricing' :
                active === 'note'      ? 'Note title (optional)' :
                                         'e.g. 200 KB swings sub-15 min'
              }
              style={{ width: '100%', background: 'var(--navy-800)', border: '1px solid var(--navy-500)', borderRadius: 12, padding: '13px 14px', fontSize: 15, color: 'var(--navy-50)', fontFamily: 'inherit', marginBottom: 12, outline: 'none', boxSizing: 'border-box' }} />

            {/* NOTE — body */}
            {active === 'note' && (
              <textarea value={noteBody} onChange={e => setNoteBody(e.target.value)} placeholder="Jot the note… (optional)" rows={4}
                style={{ width: '100%', background: 'var(--navy-800)', border: '1px solid var(--navy-500)', borderRadius: 12, padding: '12px 14px', fontSize: 14, color: 'var(--navy-100)', fontFamily: 'inherit', marginBottom: 12, outline: 'none', boxSizing: 'border-box', resize: 'vertical', lineHeight: 1.5 }} />
            )}

            {/* TASK — due chips */}
            {active === 'task' && (
              <div style={{ marginBottom: 12 }}>
                <div className="fc-lbl">Due</div>
                <div style={{ display: 'flex', gap: 7 }}>
                  {(['none', 'today', 'tomorrow'] as const).map(d => (
                    <button type="button" key={d} onClick={() => setDueChoice(d)}
                      className={`fc-chip${dueChoice === d ? ' on' : ''}`}>
                      {d === 'none' ? 'No date' : d === 'today' ? 'Today' : 'Tomorrow'}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* SPACE chips — task / note / objective / parking */}
            {(active === 'task' || active === 'note' || active === 'objective' || active === 'parking') && (
              <div style={{ marginBottom: 14 }}>
                <div className="fc-lbl">{active === 'note' ? 'Space (optional)' : 'Space'}</div>
                <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
                  {active === 'note' && (
                    <button type="button" onClick={() => setSecondVal('')} className={`fc-chip${secondVal === '' ? ' on' : ''}`}>📥 Inbox</button>
                  )}
                  {orderedSpaces.map(sp => (
                    <button type="button" key={sp.id} onClick={() => setSecondVal(sp.id)} className={`fc-chip${secondVal === sp.id ? ' on' : ''}`}>
                      <span className="fc-dot" style={{ background: spaceDisplayColorById(sp.id, spaces) }} />{sp.name}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* ENTITY picker — action (KRs) / keyresult (objectives), searchable + color-coded */}
            {(active === 'action' || active === 'keyresult') && (
              entityOptions.length === 0 ? (
                <div style={{ fontSize: 12, color: 'var(--amber-text)', background: 'var(--amber-bg)', borderRadius: 10, padding: '10px 12px', marginBottom: 14 }}>
                  {active === 'keyresult' ? 'Add an objective first.' : 'Add key results first on the Roadmap.'}
                </div>
              ) : (
                <div style={{ marginBottom: 14 }}>
                  <div className="fc-lbl">{active === 'action' ? 'Which key result?' : 'For which objective?'}</div>
                  {entityOptions.length > 6 && (
                    <input value={krSearch} onChange={e => setKrSearch(e.target.value)} placeholder="Filter…"
                      style={{ width: '100%', background: 'var(--navy-800)', border: '1px solid var(--navy-500)', borderRadius: 10, padding: '9px 12px', fontSize: 13, color: 'var(--navy-50)', fontFamily: 'inherit', marginBottom: 8, outline: 'none', boxSizing: 'border-box' }} />
                  )}
                  <div style={{ maxHeight: 240, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 5 }}>
                    {filteredOptions.length === 0 && <div style={{ fontSize: 12.5, color: 'var(--navy-400)', padding: '8px 4px' }}>No matches.</div>}
                    {filteredOptions.map(o => {
                      const on = secondVal === o.id
                      return (
                        <button type="button" key={o.id} onClick={() => setSecondVal(o.id)}
                          style={{ display: 'flex', alignItems: 'center', gap: 10, textAlign: 'left', width: '100%', background: on ? 'var(--accent-dim)' : 'var(--navy-800)', border: `1px solid ${on ? 'var(--accent)' : 'var(--navy-600)'}`, borderRadius: 10, padding: '10px 12px', cursor: 'pointer', fontFamily: 'inherit' }}>
                          <span className="fc-dot" style={{ background: spaceDisplayColorById(o.spaceId, spaces), flexShrink: 0 }} />
                          <span style={{ flex: 1, minWidth: 0, fontSize: 13.5, color: on ? 'var(--navy-50)' : 'var(--navy-100)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{o.label}</span>
                          <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--navy-400)', flexShrink: 0, textTransform: 'uppercase', letterSpacing: '.04em' }}>{spaceName(o.spaceId)}</span>
                          {on && <svg width="13" height="13" viewBox="0 0 13 13" fill="none" style={{ flexShrink: 0 }}><path d="M2 7l3 3 6-6" stroke="var(--accent)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                        </button>
                      )
                    })}
                  </div>
                </div>
              )
            )}

            {active === 'objective' && (
              <div style={{ fontSize: 11, color: 'var(--navy-400)', marginBottom: 14, lineHeight: 1.4 }}>
                Color is auto-assigned. Change it later via the Edit link in OKRs or Roadmap.
              </div>
            )}

            <button type="submit" disabled={!canSave}
              style={{ width: '100%', padding: 14, background: 'var(--accent)', color: 'var(--navy-900)', fontSize: 15, fontWeight: 700, border: 'none', borderRadius: 12, cursor: 'pointer', opacity: canSave ? 1 : .5 }}>
              Save
            </button>
          </form>
        </div>
      )}

      <style>{`
        @keyframes fabIn  { from { opacity:0; transform:translateY(12px) scale(.9); } to { opacity:1; transform:translateY(0) scale(1); } }
        @keyframes sheetUp { from { transform:translateY(100%); } to { transform:translateY(0); } }
        .fc-lbl { font-family:var(--font-mono); font-size:10px; font-weight:600; letter-spacing:.1em; text-transform:uppercase; color:var(--navy-400); margin-bottom:7px; }
        .fc-chip { display:inline-flex; align-items:center; gap:7px; padding:7px 12px; border-radius:99px; font-size:12.5px; font-weight:600; font-family:inherit; cursor:pointer; background:var(--navy-800); border:1px solid var(--navy-600); color:var(--navy-200); }
        .fc-chip:hover { border-color:var(--accent); }
        .fc-chip.on { border-color:var(--accent); background:var(--accent-dim); color:var(--navy-50); }
        .fc-dot { width:8px; height:8px; border-radius:50%; flex-shrink:0; }
      `}</style>
    </>
  )
}
