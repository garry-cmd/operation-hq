'use client'
import { useState } from 'react'
import * as reviewsDb from '@/lib/db/reviews'
import { WeeklyReview, ReviewRating } from '@/lib/types'
import { formatWeek } from '@/lib/utils'

// --- Rating icons (kept from the old Reflect for visual continuity) -------
const StrongIcon = ({ size = 12 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <path d="M6 2v6h4v6h4v6h4" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
    <path d="M4 8h8" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
    <path d="M14 14h6" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
  </svg>
)
const BalanceIcon = ({ size = 12 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <path d="M12 3v18" stroke="currentColor" strokeWidth="2"/>
    <path d="M8 21h8" stroke="currentColor" strokeWidth="2"/>
    <path d="M8 5h8" stroke="currentColor" strokeWidth="2"/>
    <path d="M12 5L8 2v6l4-1 4 1V2l-4 3Z" stroke="currentColor" strokeWidth="2"/>
  </svg>
)
const PoorIcon = ({ size = 12 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2"/>
    <path d="M16 16s-1.5-2-4-2-4 2-4 2" stroke="currentColor" strokeWidth="2"/>
    <line x1="9" y1="9" x2="9.01" y2="9" stroke="currentColor" strokeWidth="2"/>
    <line x1="15" y1="9" x2="15.01" y2="9" stroke="currentColor" strokeWidth="2"/>
  </svg>
)

const RATINGS: { value: ReviewRating; label: string; color: string; Icon: ({ size }: { size?: number }) => React.JSX.Element }[] = [
  { value: 'strong', label: 'Strong', color: 'var(--teal)',  Icon: StrongIcon },
  { value: 'steady', label: 'Steady', color: 'var(--amber)', Icon: BalanceIcon },
  { value: 'rough',  label: 'Rough',  color: 'var(--red)',   Icon: PoorIcon },
]

const ratingMeta = (r: ReviewRating) => RATINGS.find(x => x.value === r) ?? RATINGS[1]

// ==========================================================================

type Props = {
  reviews: WeeklyReview[]
  setReviews: (fn: (p: WeeklyReview[]) => WeeklyReview[]) => void
  toast: (m: string) => void
}

export default function Reflect({ reviews, setReviews, toast }: Props) {
  const sorted = [...reviews].sort((a, b) => b.week_start.localeCompare(a.week_start))

  return (
    <div>
      <h1 style={{ fontSize: 18, fontWeight: 700, color: 'var(--navy-50)', marginBottom: 3 }}>Reflect</h1>
      <p style={{ fontSize: 12, color: 'var(--navy-300)', marginBottom: 18 }}>
        Weekly archive — tap a card to read or edit the entry.
      </p>

      {sorted.length === 0 ? (
        <div style={{ background: 'var(--navy-800)', border: '1px solid var(--navy-600)', borderRadius: 14, padding: '40px 24px', textAlign: 'center', color: 'var(--navy-300)' }}>
          <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--navy-100)', marginBottom: 6 }}>No weeks closed yet</div>
          <div style={{ fontSize: 12, lineHeight: 1.6 }}>
            Hit <strong style={{ color: 'var(--accent)' }}>Close week →</strong> on the Focus tab to record your first reflection.
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {sorted.map(review => (
            <ReviewCard
              key={review.id}
              review={review}
              setReviews={setReviews}
              toast={toast}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// ==========================================================================
// Individual review card — collapsed summary, expand to edit
// ==========================================================================
function ReviewCard({
  review, setReviews, toast,
}: {
  review: WeeklyReview
  setReviews: (fn: (p: WeeklyReview[]) => WeeklyReview[]) => void
  toast: (m: string) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const [editing, setEditing] = useState(false)

  // Local editable buffer; only commits on Save.
  const [rating, setRating] = useState<ReviewRating>(review.rating)
  const [win, setWin] = useState(review.win)
  const [slipped, setSlipped] = useState(review.slipped)
  const [adjustNotes, setAdjustNotes] = useState(review.adjust_notes)
  const [saving, setSaving] = useState(false)

  const r = ratingMeta(review.rating)

  function startEdit() {
    setRating(review.rating)
    setWin(review.win)
    setSlipped(review.slipped)
    setAdjustNotes(review.adjust_notes)
    setEditing(true)
  }

  function cancelEdit() {
    setEditing(false)
  }

  async function save() {
    if (saving) return
    setSaving(true)
    const payload = { rating, win, slipped, adjust_notes: adjustNotes }
    try {
      const updated = await reviewsDb.update(review.id, payload)
      setReviews(prev => prev.map(x => x.id === review.id ? updated : x))
      setSaving(false)
      setEditing(false)
      toast('Review updated.')
    } catch (err) {
      console.error('Reflect save failed:', err)
      toast('Could not save changes.')
      setSaving(false)
    }
  }

  return (
    <div style={{ background: 'var(--navy-800)', border: '1px solid var(--navy-600)', borderRadius: 12, overflow: 'hidden' }}>
      {/* Header — always visible, taps toggle expand */}
      <button onClick={() => setExpanded(v => !v)}
        style={{ width: '100%', padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 12, background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--navy-50)' }}>Week of {formatWeek(review.week_start)}</div>
          <div style={{ fontSize: 11, color: 'var(--navy-400)', marginTop: 2 }}>
            {review.krs_hit}/{review.krs_total} KRs hit
          </div>
        </div>
        <span style={{
          fontSize: 11, padding: '3px 10px', borderRadius: 99, background: r.color, color: '#fff',
          fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 5, flexShrink: 0,
        }}>
          <r.Icon size={11} />
          {r.label}
        </span>
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none"
          style={{ flexShrink: 0, transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform .15s' }}>
          <path d="M3 4.5L6 7.5L9 4.5" stroke="var(--navy-400)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {/* Body — read or edit */}
      {expanded && (
        <div style={{ padding: '0 16px 14px', borderTop: '1px solid var(--navy-700)' }}>
          {editing ? (
            <EditForm
              rating={rating} win={win} slipped={slipped} adjustNotes={adjustNotes}
              onRating={setRating} onWin={setWin} onSlipped={setSlipped} onAdjust={setAdjustNotes}
              saving={saving} onSave={save} onCancel={cancelEdit}
            />
          ) : (
            <ReadView review={review} onEdit={startEdit} />
          )}
        </div>
      )}
    </div>
  )
}

// --- Read view inside an expanded card -----------------------------------
function ReadView({ review, onEdit }: { review: WeeklyReview; onEdit: () => void }) {
  const has = (s: string) => s && s.trim().length > 0
  const empty = !has(review.win) && !has(review.slipped) && !has(review.adjust_notes)

  return (
    <div style={{ paddingTop: 12 }}>
      {empty ? (
        <div style={{ fontSize: 12, color: 'var(--navy-400)', fontStyle: 'italic', marginBottom: 12 }}>
          No notes recorded for this week.
        </div>
      ) : (
        <>
          {has(review.win) && <ReadField label="Win" value={review.win} />}
          {has(review.slipped) && <ReadField label="Slipped" value={review.slipped} />}
          {has(review.adjust_notes) && <ReadField label="Adjust" value={review.adjust_notes} />}
        </>
      )}
      <button onClick={onEdit} className="btn"
        style={{ fontSize: 12, padding: '6px 12px', background: 'var(--navy-700)', border: '1px solid var(--navy-500)', color: 'var(--navy-100)', borderRadius: 8, cursor: 'pointer' }}>
        Edit entry
      </button>
    </div>
  )
}

function ReadField({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--navy-400)', textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 3 }}>{label}</div>
      <div style={{ fontSize: 13, color: 'var(--navy-100)', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{value}</div>
    </div>
  )
}

// --- Editable form inside an expanded card -------------------------------
function EditForm({
  rating, win, slipped, adjustNotes,
  onRating, onWin, onSlipped, onAdjust,
  saving, onSave, onCancel,
}: {
  rating: ReviewRating; win: string; slipped: string; adjustNotes: string
  onRating: (r: ReviewRating) => void
  onWin: (v: string) => void; onSlipped: (v: string) => void; onAdjust: (v: string) => void
  saving: boolean; onSave: () => void; onCancel: () => void
}) {
  return (
    <div style={{ paddingTop: 12 }}>
      <EditField label="Rating">
        <div style={{ display: 'flex', gap: 6 }}>
          {RATINGS.map(opt => (
            <button key={opt.value} onClick={() => onRating(opt.value)}
              style={{
                flex: 1, padding: '8px 10px', borderRadius: 8, border: 'none', cursor: 'pointer',
                background: rating === opt.value ? opt.color : 'var(--navy-700)',
                color: rating === opt.value ? '#fff' : 'var(--navy-300)',
                fontSize: 12, fontWeight: 600,
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 5,
              }}>
              <opt.Icon size={11} />
              {opt.label}
            </button>
          ))}
        </div>
      </EditField>

      <EditField label="What was the win?">
        <textarea className="input" rows={2} value={win} onChange={e => onWin(e.target.value)} />
      </EditField>

      <EditField label="What slipped?">
        <textarea className="input" rows={2} value={slipped} onChange={e => onSlipped(e.target.value)} />
      </EditField>

      <EditField label="What's the adjustment?">
        <textarea className="input" rows={2} value={adjustNotes} onChange={e => onAdjust(e.target.value)} />
      </EditField>

      <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
        <button onClick={onCancel} disabled={saving} className="btn"
          style={{ flex: 1, padding: '9px', fontSize: 12, background: 'var(--navy-700)', border: '1px solid var(--navy-500)', color: 'var(--navy-200)', borderRadius: 8, cursor: 'pointer' }}>
          Cancel
        </button>
        <button onClick={onSave} disabled={saving} className="btn-primary"
          style={{ flex: 1, padding: '9px', fontSize: 12, fontWeight: 600 }}>
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  )
}

function EditField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--navy-300)', marginBottom: 5 }}>{label}</div>
      {children}
    </div>
  )
}
