'use client'
import type { RoadmapItem, MetricCheckin } from '@/lib/types'
import { formatMetricValue } from './MetricKPICard'

// =========================================================================
// VitalsStrip — a slim horizontal band of metric KR readouts for Home.
// Replaces the flip-card "Key metrics" band; the full MetricKPICard flip
// cards now live in Reflect. This is the glanceable instrument row: current
// value · target · trend · quick-log. Space-filtering happens upstream
// (Home passes already-filtered metricKRs).
// =========================================================================

type Tone = 'ok' | 'alarm' | 'standby'

function readingsFor(kr: RoadmapItem, checkins: MetricCheckin[]) {
  const ck = checkins
    .filter(c => c.roadmap_item_id === kr.id && c.value != null)
    .sort((a, b) => (a.week_start ?? '').localeCompare(b.week_start ?? ''))
  // Supabase numerics arrive as strings — coerce at the boundary.
  const latest = ck.length ? Number(ck[ck.length - 1].value) : null
  const prev = ck.length > 1 ? Number(ck[ck.length - 2].value) : null
  return { latest, prev }
}

export default function VitalsStrip({
  krs, checkins, onLog,
}: {
  krs: RoadmapItem[]
  checkins: MetricCheckin[]
  onLog: (krId: string) => void
}) {
  if (krs.length === 0) return null

  return (
    <div className="vs-wrap">
      <div className="vs-band"><span className="vs-label">Vitals</span><span className="vs-hr" /></div>
      <div className="vs-strip">
        {krs.map(kr => {
          const { latest, prev } = readingsFor(kr, checkins)
          const unit = kr.metric_unit ?? ''
          const target = kr.target_value == null ? null : Number(kr.target_value)
          const dir = kr.metric_direction === 'down' ? 'down' : 'up'
          const hit = latest != null && target != null && (dir === 'up' ? latest >= target : latest <= target)
          const improving = latest != null && prev != null && (dir === 'up' ? latest > prev : latest < prev)
          const tone: Tone = latest == null ? 'standby' : (hit || improving) ? 'ok' : prev == null ? 'standby' : 'alarm'
          const arrow = dir === 'up' ? '↗' : '↘'
          const toneVar = tone === 'ok' ? 'var(--nw-nominal-text)' : tone === 'alarm' ? 'var(--nw-alarm-text)' : 'var(--nw-standby-text)'

          return (
            <div key={kr.id} className="vs-cell" onClick={() => onLog(kr.id)} title="Log a reading">
              <div className="vs-top">
                <span className="vs-name">{kr.title}</span>
                <span className="vs-stat" style={{ background: toneVar }} />
              </div>
              <div className="vs-main">
                <span className="vs-val">{latest == null ? '—' : formatMetricValue(latest, unit)}</span>
              </div>
              <div className="vs-sub">
                <span className="vs-target">
                  {target != null && <span className="vs-arw" style={{ color: toneVar }}>{latest == null ? '•' : arrow}</span>}
                  {target == null ? 'no target' : hit ? `→ ${formatMetricValue(target, unit)} ✓` : `→ ${formatMetricValue(target, unit)}`}
                </span>
                <button className="vs-log" onClick={e => { e.stopPropagation(); onLog(kr.id) }}>+ Log</button>
              </div>
            </div>
          )
        })}
      </div>

      <style>{`
        .vs-wrap{margin-bottom:14px;}
        .vs-band{display:flex;align-items:center;gap:12px;margin:4px 0 11px;}
        .vs-label{font-family:var(--font-mono);font-size:10px;font-weight:600;letter-spacing:.18em;text-transform:uppercase;color:var(--nw-label);white-space:nowrap;}
        .vs-hr{flex:1;height:1px;background:var(--line);}
        .vs-strip{display:flex;gap:10px;flex-wrap:wrap;}
        .vs-cell{flex:1 1 180px;min-width:170px;border:1px solid var(--line-2);border-radius:12px;
          background:linear-gradient(180deg,var(--surface),var(--surface-2));padding:11px 15px;cursor:pointer;}
        .vs-cell:hover{border-color:var(--line-strong);}
        .vs-top{display:flex;align-items:center;justify-content:space-between;gap:8px;}
        .vs-name{font-family:var(--font-mono);font-size:9px;font-weight:600;letter-spacing:.12em;text-transform:uppercase;
          color:var(--nw-label);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
        .vs-stat{width:7px;height:7px;border-radius:50%;flex:none;}
        .vs-main{margin-top:7px;}
        .vs-val{font-family:var(--font-mono);font-weight:600;font-size:23px;line-height:1;color:var(--nw-hero-amber);font-variant-numeric:tabular-nums;}
        .vs-sub{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:8px;}
        .vs-target{font-family:var(--font-mono);font-size:10px;color:var(--t-2,var(--navy-300));white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
        .vs-arw{font-weight:600;margin-right:4px;}
        .vs-log{font-family:var(--font-mono);font-size:9px;color:var(--accent-2,var(--accent));border:1px solid var(--accent-line,var(--accent));
          background:var(--accent-bg,var(--accent-dim));border-radius:5px;padding:3px 8px;cursor:pointer;flex:none;}
        .vs-log:hover{filter:brightness(1.15);}
      `}</style>
    </div>
  )
}
