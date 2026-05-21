'use client'
import React from 'react'
import type { RoadmapItem } from '@/lib/types'
import { getCountdownInfo, type CountdownTier } from '@/lib/dateBuckets'
import { ACTIVE_Q } from '@/lib/utils'

/**
 * KRDateChip — countdown pill + date text shown on KR rows.
 *
 * Used by:
 *   - components/ObjectiveCard.tsx (rows inside an objective card on the OKR tab)
 *   - components/Summary.tsx (cells in the All Spaces swim lane dashboard)
 *
 * Color tier maps 1:1 to the time bucket the KR's end_date falls in
 * (the chip's color IS the bucket the All Spaces dashboard would place it in).
 * Habits and dateless KRs render nothing.
 *
 * Visual contract (May 21 — Chunk 4):
 *   - This week:     cobalt fill, dark text
 *   - Next week:     amber NW fill, amber text
 *   - This quarter:  bordered, subtle
 *   - Quarter-bound: solid navy chip with subtle border — intentional Q-level goal
 *   - Default:       dashed border + dim amber "QN" label, no date text (unplanned)
 *   - Overdue:       alarm red, "+Nd" format
 *
 * The "This Month" tier was removed in Chunk 4 along with the dashboard
 * column; items 2–6 weeks out collapse into This Quarter visually.
 *
 * Defaults to ACTIVE_Q for quarter context; pass `viewedQuarter` when
 * rendering in a quarter-scoped context (e.g. the All Spaces dashboard
 * showing a future quarter via the switcher).
 */
export default function KRDateChip({
  kr,
  viewedQuarter = ACTIVE_Q,
  size = 'sm',
}: {
  kr: RoadmapItem
  viewedQuarter?: string
  /** 'sm' = inline-with-text density (used in objective card rows).
      'md' = standalone-on-card density (used in swim lane cells). */
  size?: 'sm' | 'md'
}) {
  // New signature (Chunk 4): pass the KR shape so getCountdownInfo can
  // read is_quarter_bound alongside the dates.
  const info = getCountdownInfo(kr, viewedQuarter)
  if (!info) return null

  const chipStyle = chipStyleForTier(info.tier)
  const sm = size === 'sm'

  return (
    <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: sm ? 6 : 7 }}>
      <span
        style={{
          ...chipStyle,
          fontSize: sm ? 10 : 11,
          fontWeight: 700,
          padding: sm ? '1px 6px' : '2px 7px',
          borderRadius: 3,
          letterSpacing: '.02em',
          fontVariantNumeric: 'tabular-nums',
          lineHeight: 1.4,
          whiteSpace: 'nowrap',
        }}
        title={
          info.dateText
            ? info.dateText
            : info.tier === 'quarter-bound'
              ? 'Quarter-bound goal — no specific deadline'
              : 'Unplanned — still at quarter default'
        }
      >
        {info.label}
      </span>
      {info.dateText && (
        <span style={{
          fontSize: sm ? 11 : 11,
          color: 'var(--navy-300)',
          fontVariantNumeric: 'tabular-nums',
          fontWeight: sm ? 400 : 500,
        }}>
          {info.dateText}
        </span>
      )}
    </span>
  )
}

function chipStyleForTier(tier: CountdownTier): React.CSSProperties {
  switch (tier) {
    case 'this-week':
      return { background: 'var(--accent)', color: 'var(--navy-900)' }
    case 'next-week':
      return { background: 'rgba(212, 160, 74, 0.2)', color: 'var(--nw-label)' }
    case 'this-quarter':
      return { background: 'transparent', color: 'var(--navy-300)', border: '1px solid var(--navy-500)', padding: '0 5px' }
    case 'quarter-bound':
      // Solid chip — visually distinct from the dashed unplanned variant.
      // Reads as "intentional", not "needs planning".
      return { background: 'var(--navy-700)', color: 'var(--navy-100)', border: '1px solid var(--navy-500)', padding: '0 5px' }
    case 'default':
      return { background: 'transparent', color: 'var(--nw-label-dim)', border: '1px dashed var(--nw-label-dim)', padding: '0 5px' }
    case 'overdue':
      return { background: 'var(--nw-alarm-text)', color: 'var(--navy-900)' }
  }
}
