import { RoadmapItem, MetricCheckin } from './types'

/**
 * Compute progress (0–100) for a metric KR given its current value.
 *
 * Linear interpolation between start_value and target_value, clamped to
 * [0, 100]. The formula (value - start) / (target - start) is direction-
 * agnostic — it works equally for "up" metrics like net worth (start < target)
 * and "down" metrics like weight (start > target), because the signs in
 * numerator and denominator cancel.
 *
 * Returns null when the KR isn't configured enough to compute (missing start,
 * target, or direction; or start === target). Callers should leave the stored
 * `progress` untouched in that case rather than defaulting to 0 — we'd
 * rather show "–" than a misleading zero.
 */
export function computeMetricProgress(
  kr: Pick<RoadmapItem, 'is_metric' | 'metric_direction' | 'start_value' | 'target_value'>,
  value: number,
): number | null {
  if (!kr.is_metric) return null
  if (kr.start_value == null || kr.target_value == null || !kr.metric_direction) return null

  // Supabase returns `numeric` columns as strings; coerce here so callers
  // don't have to. `Number(string)` returns NaN for non-numeric; guard.
  const start = Number(kr.start_value)
  const target = Number(kr.target_value)
  const val = Number(value)
  if (Number.isNaN(start) || Number.isNaN(target) || Number.isNaN(val)) return null
  if (start === target) return null

  const fraction = (val - start) / (target - start)
  return Math.max(0, Math.min(100, Math.round(fraction * 100)))
}

/**
 * Get the last N weeks of check-ins for a KR, newest first.
 * Caller reverses for chronological plotting.
 */
export function recentCheckins(
  checkins: MetricCheckin[],
  krId: string,
  n: number,
): MetricCheckin[] {
  return checkins
    .filter(c => c.roadmap_item_id === krId)
    .sort((a, b) => b.week_start.localeCompare(a.week_start))
    .slice(0, n)
}

/**
 * Compute Y-axis bounds for a sparkline so that the target line is always
 * visible on the chart — the "how far to go" frame. Falls back to a sensible
 * pair when insufficient data.
 *
 * Returns [yMin, yMax] inclusive. Always yMin < yMax.
 */
export function sparklineBounds(
  values: number[],
  start: number | null,
  target: number | null,
): [number, number] {
  const anchors: number[] = [...values]
  if (start != null) anchors.push(start)
  if (target != null) anchors.push(target)
  if (anchors.length === 0) return [0, 1]

  let lo = Math.min(...anchors)
  let hi = Math.max(...anchors)
  if (lo === hi) { lo -= 1; hi += 1 }      // avoid zero-height chart
  const pad = (hi - lo) * 0.1
  return [lo - pad, hi + pad]
}

/**
 * Trend of a series toward a target, direction-aware.
 *  - 'improving': moving toward target
 *  - 'declining': moving away from target
 *  - 'flat': no change or insufficient data
 *
 * Uses first vs last of the provided chronological series. Intended for
 * sparkline line color — simpler and more faithful to what the eye sees
 * on the chart than a 4-week-ago delta.
 */
export function sparklineTrend(
  chronological: number[],
  direction: 'up' | 'down' | null,
): 'improving' | 'declining' | 'flat' {
  if (chronological.length < 2 || !direction) return 'flat'
  const first = chronological[0]
  const last = chronological[chronological.length - 1]
  const delta = last - first
  if (Math.abs(delta) < 0.0001) return 'flat'
  const movingUp = delta > 0
  const wantUp = direction === 'up'
  return movingUp === wantUp ? 'improving' : 'declining'
}

