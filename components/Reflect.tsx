'use client'
import { useState } from 'react'
import * as reviewsDb from '@/lib/db/reviews'
import type { QuarterReview } from '@/lib/db/quarterReviews'
import { WeeklyReview, ReviewRating, Space, RoadmapItem, MetricCheckin, HabitCheckin } from '@/lib/types'
import { formatWeek, getMonday, ACTIVE_Q } from '@/lib/utils'
import { spaceDisplayColor } from '@/lib/spaceColor'
import { calculateRollingAggregate } from '@/lib/habitUtils'
import { getMetricKRs } from '@/lib/krFilters'
import MetricKPICard from './MetricKPICard'

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
  reviews: WeeklyReview[]   // all spaces — Reflect is the all-spaces ritual hub
  setReviews: (fn: (p: WeeklyReview[]) => WeeklyReview[]) => void
  quarterReviews: QuarterReview[]
  spaces: Space[]
  weekForSpace: (spaceId: string) => string
  onCloseWeek: (spaceId: string, week: string) => void
  roadmapItems: RoadmapItem[]
  metricCheckins: MetricCheckin[]
  habitCheckins: HabitCheckin[]
  onLogMetric: (krId: string) => void
  toast: (m: string) => void
}

export default function Reflect({ reviews, setReviews, quarterReviews, spaces, weekForSpace, onCloseWeek, roadmapItems, metricCheckins, habitCheckins, onLogMetric, toast }: Props) {
  const orderedSpaces = [...spaces].sort((a, b) => a.sort_order - b.sort_order)
  const spaceById = new Map(spaces.map(s => [s.id, s]))
  const thisMonday = getMonday()
  // Vitals — all-spaces metric + habit KRs (relocated from the OKR tab).
  const habitKRs = roadmapItems.filter(k => k.is_habit && !k.is_parked && k.health_status !== 'done')
  const metricKRs = getMetricKRs(roadmapItems, ACTIVE_Q)
  const isWeekClosed = (spaceId: string, week: string) =>
    reviews.some(r => r.space_id === spaceId && r.week_start === week && r.closed_at != null)
  // Drafts (closed_at = null) don't belong in the archive — they're
  // half-finished ceremonies, not historical entries. The page-level draft
  // banner brings the user back to finish them; the forced-launcher in
  // app/hq/page.tsx fires the wizard on space switch when one's pending.
  const sorted = [...reviews]
    .filter(r => r.closed_at != null)
    .sort((a, b) => b.week_start.localeCompare(a.week_start))

  return (
    <div>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 600, letterSpacing: '.18em', textTransform: 'uppercase', color: 'var(--nw-label)', marginBottom: 5 }}>Archive · Reflect</div>
      <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 26, fontWeight: 600, color: 'var(--navy-50)', letterSpacing: '-.02em', marginBottom: 3 }}>Reflect</h1>
      <p style={{ fontSize: 12, color: 'var(--navy-300)', marginBottom: 18 }}>
        Plan or close a week per space; past entries are below.
      </p>

      {/* Vitals — metric + habit KPI cards, all spaces (relocated from the OKR tab) */}
      {(habitKRs.length > 0 || metricKRs.length > 0) && (
        <div style={{ marginBottom: 22 }}>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 600, letterSpacing: '.18em', textTransform: 'uppercase', color: 'var(--nw-label)', margin: '0 0 12px 0' }}>Vitals</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
            {habitKRs.map(kr => {
              const aggregate = calculateRollingAggregate(kr, habitCheckins, 4)
              const tone = aggregate.sessions === 0 ? 'standby'
                         : aggregate.percent >= 80 ? 'nominal'
                         : aggregate.percent >= 50 ? 'caution'
                         : 'alarm'
              const heroColor = tone === 'nominal' ? 'var(--nw-nominal-text)'
                              : tone === 'caution' ? 'var(--nw-hero-amber)'
                              : tone === 'alarm'   ? 'var(--nw-alarm-text)'
                              : 'var(--nw-standby-text)'
              const borderAccent = tone === 'nominal' ? 'var(--nw-nominal-text)'
                                 : tone === 'caution' ? 'var(--nw-caution-text)'
                                 : tone === 'alarm'   ? 'var(--nw-alarm-text)'
                                 : 'var(--nw-standby-text)'
              return (
                <div key={kr.id} title={`${aggregate.sessions}/${aggregate.expected} sessions`}
                  style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderLeft: `3px solid ${borderAccent}`, borderRadius: 14, boxShadow: 'var(--card-shadow)', padding: '14px 16px' }}>
                  <p style={{ fontSize: 12, color: 'var(--nw-cream)', fontWeight: 500, margin: '0 0 6px 0', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{kr.title}</p>
                  <p style={{ fontFamily: 'var(--font-mono)', fontSize: 28, fontWeight: 600, color: heroColor, margin: 0, letterSpacing: '-.01em', lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>
                    {aggregate.percent}<span style={{ fontSize: 16 }}>%</span>
                  </p>
                </div>
              )
            })}
            {metricKRs.map(kr => (
              <MetricKPICard key={kr.id} kr={kr} checkins={metricCheckins} onTap={() => onLogMetric(kr.id)} />
            ))}
          </div>
        </div>
      )}

      {/* Plan/close launcher — per space, opens the matching wizard for that space's current week */}
      <div style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 14, padding: '14px 16px', marginBottom: 22, boxShadow: 'var(--card-shadow)' }}>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 600, letterSpacing: '.18em', textTransform: 'uppercase', color: 'var(--nw-label)', marginBottom: 10 }}>Plan &amp; close</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {orderedSpaces.map(sp => {
            const wk = weekForSpace(sp.id)
            const closed = isWeekClosed(sp.id, wk)
            // After a close the cursor advances to the next (future) week. Don't
            // re-offer a close for a week that hasn't ended — show caught-up so
            // the just-completed close reads as done, not as a fresh prompt.
            const caughtUp = !closed && wk > thisMonday
            return (
              <div key={sp.id} style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
                <span style={{ width: 9, height: 9, borderRadius: '50%', background: spaceDisplayColor(sp), flexShrink: 0 }} />
                <span style={{ flex: 1, fontSize: 14, color: 'var(--navy-100)' }}>{sp.name}</span>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--navy-400)', fontVariantNumeric: 'tabular-nums' }}>
                  {caughtUp ? `next · week of ${formatWeek(wk)}` : `week of ${formatWeek(wk)}`}
                </span>
                {closed || caughtUp ? (
                  <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--nw-nominal-text, #7fe27a)', padding: '5px 12px' }}>
                    {closed ? '✓ closed' : '✓ up to date'}
                  </span>
                ) : (
                  <button onClick={() => onCloseWeek(sp.id, wk)}
                    style={{ fontSize: 12, fontWeight: 600, padding: '6px 14px', borderRadius: 8, border: '1px solid var(--accent)', background: 'var(--accent-dim)', color: 'var(--navy-50)', cursor: 'pointer' }}>
                    Close week →
                  </button>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* ── Weekly archive ── */}
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 600, letterSpacing: '.18em', textTransform: 'uppercase', color: 'var(--nw-label)', margin: '0 0 10px 0' }}>Weekly</div>
      {sorted.length === 0 ? (
        <div style={{ background: 'var(--navy-800)', border: '1px solid var(--navy-600)', borderRadius: 14, padding: '40px 24px', textAlign: 'center', color: 'var(--navy-300)', marginBottom: 24 }}>
          <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--navy-100)', marginBottom: 6 }}>No weeks closed yet</div>
          <div style={{ fontSize: 12, lineHeight: 1.6 }}>
            Use <strong style={{ color: 'var(--accent)' }}>Close week →</strong> above to record your first reflection.
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 28 }}>
          {sorted.map(review => {
            const sp = spaceById.get(review.space_id)
            return (
              <ReviewCard
                key={review.id}
                review={review}
                spaceName={sp?.name ?? ''}
                spaceColor={sp ? spaceDisplayColor(sp) : 'var(--navy-500)'}
                setReviews={setReviews}
                toast={toast}
              />
            )
          })}
        </div>
      )}

      {/* ── Quarterly close archive ── */}
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 600, letterSpacing: '.18em', textTransform: 'uppercase', color: 'var(--nw-label)', margin: '0 0 10px 0' }}>Quarterly</div>
      {quarterReviews.length === 0 ? (
        <div style={{ background: 'var(--navy-800)', border: '1px solid var(--navy-600)', borderRadius: 14, padding: '40px 24px', textAlign: 'center', color: 'var(--navy-300)' }}>
          <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--navy-100)', marginBottom: 6 }}>No quarters closed yet</div>
          <div style={{ fontSize: 12, lineHeight: 1.6 }}>
            Use <strong style={{ color: 'var(--accent)' }}>Close {ACTIVE_Q} →</strong> on the Home tab to seal a quarter.
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {quarterReviews.map(qr => {
            const sp = qr.space_id ? spaceById.get(qr.space_id) : null
            return (
              <QuarterReviewCard
                key={qr.id}
                review={qr}
                spaceName={sp?.name ?? null}
                spaceColor={sp ? spaceDisplayColor(sp) : null}
              />
            )
          })}
        </div>
      )}
    </div>
  )
}

// ==========================================================================
// Quarterly close card — collapsed summary, expand to read
// ==========================================================================
function QuarterReviewCard({
  review, spaceName, spaceColor,
}: {
  review: QuarterReview
  spaceName: string | null
  spaceColor: string | null
}) {
  const [expanded, setExpanded] = useState(false)
  const has = (s: string | null | undefined) => s && s.trim().length > 0

  return (
    <div style={{ background: 'var(--navy-800)', border: '1px solid var(--navy-600)', borderRadius: 12, overflow: 'hidden' }}>
      <button onClick={() => setExpanded(v => !v)}
        style={{ width: '100%', padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 12, background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left' }}>
        {spaceColor && <span style={{ width: 9, height: 9, borderRadius: '50%', background: spaceColor, flexShrink: 0 }} />}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--navy-50)' }}>
            {review.quarter.replace(/^(\d)Q/, 'Q$1 ')}
          </div>
          {spaceName && <div style={{ fontSize: 11, color: 'var(--navy-400)', marginTop: 2 }}>{spaceName}</div>}
        </div>
        <span style={{
          fontFamily: 'var(--font-mono)', fontSize: 9.5, fontWeight: 700,
          padding: '2px 9px', borderRadius: 99,
          background: 'rgba(127,226,122,.1)', color: 'var(--nw-nominal-text)',
          border: '1px solid rgba(127,226,122,.2)', flexShrink: 0,
        }}>✓ SEALED</span>
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none"
          style={{ flexShrink: 0, transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform .15s' }}>
          <path d="M3 4.5L6 7.5L9 4.5" stroke="var(--navy-400)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {expanded && (
        <div style={{ padding: '0 16px 16px', borderTop: '1px solid var(--navy-700)' }}>
          <div style={{ paddingTop: 12, display: 'flex', flexDirection: 'column', gap: 12 }}>
            {has(review.proud_of) && <QReadField label="Proud of" value={review.proud_of!} />}
            {has(review.didnt_go) && <QReadField label="Didn't go as planned" value={review.didnt_go!} />}
            {has(review.next_quarter) && <QReadField label="Next quarter focus" value={review.next_quarter!} />}
            {has(review.overall_note) && <QReadField label="Overall note" value={review.overall_note!} />}
            {!has(review.proud_of) && !has(review.didnt_go) && !has(review.next_quarter) && !has(review.overall_note) && (
              <div style={{ fontSize: 12, color: 'var(--navy-400)', fontStyle: 'italic' }}>No notes recorded for this quarter.</div>
            )}
            {review.closed_at && (
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--navy-500)', marginTop: 4 }}>
                Sealed {new Date(review.closed_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function QReadField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 600, color: 'var(--nw-label)', textTransform: 'uppercase', letterSpacing: '.18em', marginBottom: 3 }}>{label}</div>
      <div style={{ fontSize: 13, color: 'var(--navy-100)', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{value}</div>
    </div>
  )
}

// ==========================================================================
// Individual review card — collapsed summary, expand to edit
// ==========================================================================
function ReviewCard({
  review, spaceName, spaceColor, setReviews, toast,
}: {
  review: WeeklyReview
  spaceName: string
  spaceColor: string
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
        <span style={{ width: 9, height: 9, borderRadius: '50%', background: spaceColor, flexShrink: 0 }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--navy-50)' }}>Week of {formatWeek(review.week_start)}</div>
          <div style={{ fontSize: 11, color: 'var(--navy-400)', marginTop: 2 }}>
            {spaceName ? `${spaceName} · ` : ''}{review.krs_hit}/{review.krs_total} KRs hit
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
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 600, color: 'var(--nw-label)', textTransform: 'uppercase', letterSpacing: '.18em', marginBottom: 3 }}>{label}</div>
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
