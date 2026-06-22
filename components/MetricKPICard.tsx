'use client'
import { useState, type CSSProperties } from 'react'
import type { RoadmapItem, MetricCheckin } from '@/lib/types'
import { ACTIVE_Q, parseDateLocal } from '@/lib/utils'
import { recentCheckins, sparklineTrend } from '@/lib/metricUtils'
import { getQuarterRange } from '@/lib/dateBuckets'

// =========================================================================
// MetricKPICard — tinted card summarizing a metric KR, with a quarter
// sparkline on the front and a flip-to-readings list on the back. Tapping
// the body flips; "+ Log" (on the back) fires onTap. Shared by the OKRs tab
// and the Home "Key metrics" band so both render identically.
// =========================================================================

// Symbol-form currencies render before the number; everything else (kg, lb,
// sessions, %, USD, etc.) renders after. Numbers always get thousand separators.
// '#' is treated as "no unit" — a placeholder users sometimes type.
const PREFIX_CURRENCY_SYMBOLS = new Set(['$', '€', '£', '¥', '₹', '₩', '₽', '¢'])

function isMeaningfulUnit(unit: string): boolean {
  const trimmed = unit.trim()
  return trimmed.length > 0 && trimmed !== '#'
}
function isPrefixCurrency(unit: string): boolean {
  return PREFIX_CURRENCY_SYMBOLS.has(unit.trim())
}
function formatMetricNumber(n: number): string {
  return n.toLocaleString('en-US')
}
export function formatMetricValue(n: number, unit: string): string {
  const num = formatMetricNumber(n)
  if (!isMeaningfulUnit(unit)) return num
  if (isPrefixCurrency(unit)) return `${unit.trim()}${num}`
  return `${num} ${unit.trim()}`
}

export default function MetricKPICard({
  kr, checkins, onTap,
}: {
  kr: RoadmapItem
  checkins: MetricCheckin[]
  onTap: () => void
}) {
  const unit = kr.metric_unit ?? ''

  // Supabase returns `numeric` columns as strings — coerce at the boundary.
  const startNum  = kr.start_value  == null ? null : Number(kr.start_value)
  const targetNum = kr.target_value == null ? null : Number(kr.target_value)
  const progressNum = kr.progress == null ? null : Number(kr.progress)

  // Last 12 checkins, descending. Used for current + delta only.
  const latest12Desc = recentCheckins(checkins, kr.id, 12)

  // Quarter-scoped readings, oldest → newest. Drives the sparkline (scaled to
  // own min/max so movement is legible) and the flip-side list.
  const qRange = getQuarterRange(ACTIVE_Q)
  const qReadingsAsc = checkins
    .filter(c => c.roadmap_item_id === kr.id && (!qRange || (c.week_start >= qRange.start && c.week_start <= qRange.end)))
    .map(c => ({ week_start: c.week_start, value: Number(c.value) }))
    .filter(r => !Number.isNaN(r.value))
    .sort((a, b) => a.week_start.localeCompare(b.week_start))
  const quarterSeries = qReadingsAsc.map(r => r.value)
  const readingsDesc = [...qReadingsAsc].reverse()

  const current = latest12Desc[0]?.value != null ? Number(latest12Desc[0].value) : null
  const previous = latest12Desc[1]?.value != null ? Number(latest12Desc[1].value) : null
  const delta = current != null && previous != null ? current - previous : null

  const deltaIsGood = delta == null || Math.abs(delta) < 0.0001
    ? null
    : kr.metric_direction === 'up' ? delta > 0 : delta < 0

  const hasNoCheckins = latest12Desc.length === 0
  const tone: 'nominal' | 'caution' | 'alarm' | 'standby' =
    (progressNum == null || hasNoCheckins) ? 'standby'
    : progressNum >= 80 ? 'nominal'
    : progressNum >= 50 ? 'caution'
    : 'alarm'

  const heroColor = tone === 'nominal' ? 'var(--nw-nominal-text)'
                  : tone === 'caution' ? 'var(--nw-hero-amber)'
                  : tone === 'alarm'   ? 'var(--nw-alarm-text)'
                  : 'var(--nw-standby-text)'
  const borderAccent = tone === 'nominal' ? 'var(--nw-nominal-text)'
                     : tone === 'caution' ? 'var(--nw-caution-text)'
                     : tone === 'alarm'   ? 'var(--nw-alarm-text)'
                     : 'var(--nw-standby-text)'

  const tooltipParts: string[] = []
  if (startNum != null) tooltipParts.push(`Start ${formatMetricValue(startNum, unit)}`)
  if (targetNum != null) tooltipParts.push(`Target ${formatMetricValue(targetNum, unit)}`)
  const tooltip = tooltipParts.join(' → ') || undefined

  const [flipped, setFlipped] = useState(false)
  const faceBase: CSSProperties = {
    position: 'absolute', inset: 0, backfaceVisibility: 'hidden', WebkitBackfaceVisibility: 'hidden',
    background: 'var(--surface)', border: '1px solid var(--line)',
    borderLeft: `3px solid ${borderAccent}`, borderRadius: 14, boxShadow: 'var(--card-shadow)', display: 'flex', flexDirection: 'column',
  }
  const fmtRowVal = (v: number) => `${isPrefixCurrency(unit) ? unit.trim() : ''}${formatMetricNumber(v)}`
  const fmtShortDate = (d: string) => {
    const dt = parseDateLocal(d)
    return `${dt.toLocaleDateString('en-US', { month: 'short' })} ${dt.getDate()}`
  }

  return (
    <div style={{ perspective: 1200 }}>
      <div
        onClick={() => setFlipped(f => !f)}
        style={{
          position: 'relative', height: 168, cursor: 'pointer',
          transformStyle: 'preserve-3d', transition: 'transform .5s cubic-bezier(.4,0,.2,1)',
          transform: flipped ? 'rotateY(180deg)' : 'none',
        }}>

        {/* ── FRONT ── */}
        <div title={tooltip} style={{ ...faceBase, padding: '14px 16px', gap: 8 }}>
          <div style={{ fontSize: 12, color: 'var(--nw-cream)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', fontWeight: 500 }}>
            {kr.title}
          </div>

          <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, flexWrap: 'wrap' }}>
            {current != null ? (
              <>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 28, fontWeight: 600, color: heroColor, lineHeight: 1, letterSpacing: '-.01em', fontVariantNumeric: 'tabular-nums' }}>
                  {isPrefixCurrency(unit) && unit.trim()}{formatMetricNumber(current)}
                </span>
                {isMeaningfulUnit(unit) && !isPrefixCurrency(unit) && <span style={{ fontSize: 13, color: 'var(--nw-label-dim)' }}>{unit.trim()}</span>}
                {delta != null && (
                  <span style={{
                    fontSize: 11, fontWeight: 700, marginLeft: 4,
                    color: deltaIsGood == null ? 'var(--nw-label-dim)' : (deltaIsGood ? 'var(--nw-nominal-text)' : 'var(--nw-alarm-text)'),
                  }}>
                    {delta > 0 ? '↑ +' : delta < 0 ? '↓ ' : ''}
                    {formatMetricNumber(Number(delta.toFixed(2)))}
                  </span>
                )}
              </>
            ) : (
              <span style={{ fontSize: 14, fontStyle: 'italic', color: 'var(--nw-label-dim)' }}>
                No readings yet
              </span>
            )}
          </div>

          {quarterSeries.length >= 2 && (
            <MetricSparkline id={kr.id} values={quarterSeries} direction={kr.metric_direction} />
          )}

          <div style={{ position: 'absolute', right: 12, bottom: 9, display: 'flex', alignItems: 'center', gap: 4, fontSize: 9.5, fontWeight: 600, letterSpacing: '.04em', textTransform: 'uppercase', color: 'var(--navy-400)' }}>
            ⟲ readings
          </div>
        </div>

        {/* ── BACK ── */}
        <div style={{ ...faceBase, transform: 'rotateY(180deg)', padding: '11px 12px 10px', gap: 6 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 9.5, fontWeight: 500, letterSpacing: '.14em', textTransform: 'uppercase', color: 'var(--nw-label)' }}>Readings</span>
            <span style={{ fontSize: 9.5, color: 'var(--navy-400)', fontVariantNumeric: 'tabular-nums' }}>
              {qReadingsAsc.length === 0 ? 'none yet' : `${qReadingsAsc.length} this quarter`}
            </span>
          </div>

          <div style={{ flex: 1, overflowY: 'auto', margin: '2px -4px 0', padding: '0 4px' }}>
            {readingsDesc.length === 0 ? (
              <div style={{ fontSize: 12, fontStyle: 'italic', color: 'var(--nw-label-dim)', paddingTop: 8 }}>
                No readings logged yet.
              </div>
            ) : readingsDesc.map((r, i) => {
              const older = readingsDesc[i + 1]
              const d = older ? r.value - older.value : null
              const rtone = d == null || Math.abs(d) < 1e-9 ? 'flat'
                         : ((d > 0) === (kr.metric_direction === 'up') ? 'good' : 'bad')
              const dColor = rtone === 'good' ? 'var(--nw-nominal-text)' : rtone === 'bad' ? 'var(--nw-alarm-text)' : 'var(--navy-400)'
              return (
                <div key={r.week_start} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '3px 0', borderBottom: i === readingsDesc.length - 1 ? 'none' : '1px solid var(--navy-700)' }}>
                  <span style={{ fontSize: 11, color: 'var(--navy-300)', fontVariantNumeric: 'tabular-nums' }}>{fmtShortDate(r.week_start)}</span>
                  <span style={{ display: 'flex', alignItems: 'baseline', gap: 7 }}>
                    <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--nw-cream)', fontVariantNumeric: 'tabular-nums' }}>{fmtRowVal(r.value)}</span>
                    <span style={{ fontSize: 10, fontWeight: 700, color: dColor, fontVariantNumeric: 'tabular-nums', minWidth: 30, textAlign: 'right' }}>
                      {d == null ? 'start' : `${d > 0 ? '↑' : '↓'}${formatMetricNumber(Math.abs(Number(d.toFixed(2))))}`}
                    </span>
                  </span>
                </div>
              )
            })}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: 6, borderTop: '1px solid var(--navy-700)' }}>
            <button
              onClick={e => { e.stopPropagation(); onTap() }}
              style={{ fontSize: 11, fontWeight: 700, color: '#fff', background: 'var(--accent)', border: 'none', borderRadius: 6, padding: '4px 10px', cursor: 'pointer' }}>
              + Log
            </button>
            <button
              onClick={e => { e.stopPropagation(); setFlipped(false) }}
              style={{ fontSize: 10, fontWeight: 600, color: 'var(--navy-400)', background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, letterSpacing: '.04em', textTransform: 'uppercase' }}>
              ↩ back
            </button>
          </div>
        </div>

      </div>
    </div>
  )
}

// MetricSparkline — quarter-trend line for a metric KPI card. Scaled to the
// series' own min/max so movement is visible; line + soft area fill, colored
// by whether the trend moves toward the KR's target (green) or away (red).
function MetricSparkline({ id, values, direction }: {
  id: string
  values: number[]
  direction: 'up' | 'down' | null
}) {
  const W = 100, H = 26, PAD = 3
  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = max - min || 1
  const n = values.length
  const xAt = (i: number) => (i / (n - 1)) * W
  const yAt = (v: number) => H - PAD - ((v - min) / span) * (H - PAD * 2)
  const pts = values.map((v, i) => `${xAt(i).toFixed(2)},${yAt(v).toFixed(2)}`)
  const line = `M ${pts.join(' L ')}`
  const area = `${line} L ${W.toFixed(2)},${H} L 0,${H} Z`

  const trend = sparklineTrend(values, direction)
  const color = trend === 'improving' ? 'var(--nw-nominal-text)'
              : trend === 'declining' ? 'var(--nw-alarm-text)'
              : 'var(--nw-standby-text)'
  const gradId = `spark-${id}`

  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" width="100%" height={H}
      style={{ display: 'block', marginTop: 2 }} aria-hidden="true">
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.2" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${gradId})`} stroke="none" />
      <path d={line} fill="none" stroke={color} strokeWidth="1.5"
        strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  )
}
