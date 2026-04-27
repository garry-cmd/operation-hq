import { RoadmapItem } from './types'

/**
 * Canonical KR filter helpers.
 *
 * Before this module existed, the definition of "an active KR" lived in five
 * files with subtly different phrasings — a bug magnet (see the `metric_type`
 * cast regression in CloseWeekWizard, fixed April 2026). All screens that
 * need the baseline "what's in play right now" slice should use these.
 *
 * Screens with deliberately different semantics DO NOT use these:
 *  - Roadmap.tsx shows ALL non-parked KRs, including 'done' and 'planned'
 *    across quarters — it's the cross-quarter planning grid, not the
 *    current working set.
 *  - app/share/[token]/page.tsx shows active-or-done (viewers see completed
 *    work too).
 *  - SpaceSwitcher.tsx uses plain "in-space + not-parked" for its counts.
 *
 * A KR is either a habit, a metric, or a plain outcome. The DB does NOT
 * enforce single-flavor at the schema level; UI enforces it on edit. The
 * helpers below guard defensively (e.g. getMetricKRs excludes is_habit).
 */

/**
 * "Active" KR — the baseline working set. Not parked, not abandoned,
 * not done. Spans ALL quarters. Exported as a primitive because Roadmap
 * compositions that intentionally cross quarters need it.
 *
 * Most UI surfaces should NOT use this directly — use getCurrentQuarterKRs
 * (or one of the flavor helpers below) so future-quarter KRs that are
 * planned but not yet in play don't leak into "right now" views.
 */
export function getActiveKRs(items: RoadmapItem[]): RoadmapItem[] {
  return items.filter(i =>
    !i.is_parked &&
    i.status !== 'abandoned' &&
    i.status !== 'done'
  )
}

/**
 * Active KRs narrowed to a specific quarter. THE canonical helper for
 * "what's currently in play" surfaces (OKRs, Focus, CloseWeekWizard,
 * PlanWeek, FastCapture). Future-quarter KRs live on the Roadmap until
 * their quarter becomes active. Pass ACTIVE_Q from lib/utils.
 */
export function getCurrentQuarterKRs(items: RoadmapItem[], quarter: string): RoadmapItem[] {
  return getActiveKRs(items).filter(i => i.quarter === quarter)
}

/** Habit KRs in the current-quarter active set. */
export function getHabitKRs(items: RoadmapItem[], quarter: string): RoadmapItem[] {
  return getCurrentQuarterKRs(items, quarter).filter(i => i.is_habit)
}

/**
 * Metric KRs in the current-quarter active set. Excludes is_habit
 * defensively — the DB allows both flags simultaneously and the UI
 * should not.
 */
export function getMetricKRs(items: RoadmapItem[], quarter: string): RoadmapItem[] {
  return getCurrentQuarterKRs(items, quarter).filter(i => i.is_metric && !i.is_habit)
}

/**
 * Outcome KRs — current-quarter active KRs that are neither habits
 * nor metrics. These are the classic did-we-hit-it? KRs tracked via
 * health_status + progress % on the row itself.
 */
export function getOutcomeKRs(items: RoadmapItem[], quarter: string): RoadmapItem[] {
  return getCurrentQuarterKRs(items, quarter).filter(i => !i.is_habit && !i.is_metric)
}
