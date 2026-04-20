import { RoadmapItem } from './types'

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
  if (kr.start_value === kr.target_value) return null

  const fraction = (value - kr.start_value) / (kr.target_value - kr.start_value)
  return Math.max(0, Math.min(100, Math.round(fraction * 100)))
}
