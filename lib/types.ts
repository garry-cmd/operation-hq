export type ItemStatus = 'planned' | 'active' | 'done' | 'abandoned'
export type KRStatus = 'not_started' | 'on_track' | 'off_track' | 'blocked' | 'done'
export type CheckinStatus = 'on_track' | 'off_track' | 'blocked'
export type ReviewRating = 'strong' | 'steady' | 'rough'
export type HealthStatus = 'not_started' | 'backlog' | 'on_track' | 'off_track' | 'blocked' | 'done'

export interface Space {
  id: string
  name: string
  color: string
  sort_order: number
  created_at: string
}

export interface AnnualObjective {
  id: string
  name: string
  color: string
  sort_order: number
  status: 'active' | 'abandoned'
  notes: string
  space_id: string
  created_at: string
}

export interface ObjectiveLog {
  id: string
  objective_id: string
  // Optional human-set title; null means the entry is shown labeled by date alone.
  // Body content (`content`) is markdown; rendered with `marked` at display time
  // via <MarkdownBody>. New notes default to edit mode in the panel; existing
  // notes default to read mode (rendered) and gain a pencil to switch.
  title: string | null
  content: string
  log_date: string
  created_at: string
}

// 'link' is a pasted URL (existing behavior). 'file' is a pasted URL that the
// user wants surfaced as a file — usually a Google Drive URL with a friendly
// filename in `title`. Same table, different chrome in the panel. Adding new
// kinds (e.g. 'image' for inline-paste later) won't need a DB migration since
// the column has no CHECK constraint.
export type LinkKind = 'link' | 'file'

export interface ObjectiveLink {
  id: string
  objective_id: string
  url: string
  title: string
  kind: LinkKind
  sort_order: number
  created_at: string
}

export type MetricDirection = 'up' | 'down'

export interface RoadmapItem {
  id: string
  space_id: string
  annual_objective_id: string | null
  title: string
  quarter: string | null
  sort_order: number
  status: ItemStatus
  health_status: HealthStatus
  progress: number
  is_parked: boolean
  is_habit: boolean
  // Metric KR fields — populated only when is_metric = true.
  // A KR is either a metric, a habit, or a plain outcome; the app enforces
  // single-flavor via UI, not a DB constraint.
  is_metric: boolean
  metric_unit: string | null
  metric_direction: MetricDirection | null
  start_value: number | null
  target_value: number | null
  target_date: string | null
  created_at: string
}

// User-set workflow state on actions. Distinct from `carried_over`, which is
// system-flagged when an incomplete action rolls over at week-close. New tags
// can be added here without a DB migration since the column has no CHECK.
export type ActionTag = 'backlog' | 'waiting' | 'doing'

export interface WeeklyAction {
  id: string
  roadmap_item_id: string
  quarterly_kr_id?: string | null
  title: string
  week_start: string
  completed: boolean
  carried_over: boolean
  is_recurring: boolean
  tag: ActionTag | null
  created_at: string
}

export interface DailyCheckin {
  id: string
  checkin_date: string
  roadmap_item_id: string
  quarterly_kr_id?: string | null
  status: CheckinStatus
}

export interface WeeklyReview {
  id: string
  week_start: string
  rating: ReviewRating
  win: string
  slipped: string
  adjust_notes: string
  krs_hit: number
  krs_total: number
  space_id: string
  // Set by the wizard's commitFinish (after Step 2 → celebrating → Open the
  // week) or by skipWeek. NULL means the review row is a draft — Step 1 was
  // saved but the user bailed before fully committing. Forced-launch in
  // app/hq/page.tsx uses this to re-prompt drafts; the old "row exists ⇒
  // closed" contract trapped users mid-flow.
  closed_at: string | null
}

export interface HabitCheckin {
  id: string
  roadmap_item_id: string
  date: string
  completed: boolean
  notes?: string
  created_at: string
}

export interface MetricCheckin {
  id: string
  roadmap_item_id: string
  week_start: string
  value: number
  created_at: string
  updated_at: string
}

// Minimal — the share_tokens table has more columns (id, label, active,
// created_at) but the app only reads token + space_id, so the type stays
// narrow. Expand if a write path is ever added.
export interface ShareToken {
  token: string
  space_id: string
}

// ── Tasks ─────────────────────────────────────────────────────────────
// Free-floating per-space todos with priorities, recurrence, tags,
// subtasks, and an optional KR link. Separate from weekly_actions
// (which is KR-coupled and week-scoped); the two coexist.
//
// Recurrence model: rolling. A recurring task keeps a single row across
// occurrences — completing it advances due_date instead of spawning a
// new row. completed_at therefore stays NULL on recurring tasks.

export type Priority = 1 | 2 | 3 | 4

export interface RecurrenceRule {
  freq: 'daily' | 'weekly' | 'monthly' | 'yearly'
  interval?: number                                              // every N (default 1)
  byday?: ('MO' | 'TU' | 'WE' | 'TH' | 'FR' | 'SA' | 'SU')[]    // weekly only
  bymonthday?: number                                            // monthly only (1–31)
}

export interface Task {
  id: string
  space_id: string | null
  list_id: string | null
  roadmap_item_id: string | null
  parent_task_id: string | null
  title: string
  description: string | null
  priority: Priority
  due_date: string | null
  due_time: string | null
  recurrence_text: string | null
  recurrence_rule: RecurrenceRule | null
  completed_at: string | null
  sort_order: number
  created_at: string
  updated_at: string
}

export interface NewTaskInput {
  title: string
  space_id?: string | null
  list_id?: string | null
  roadmap_item_id?: string | null
  parent_task_id?: string | null
  description?: string | null
  priority?: Priority
  due_date?: string | null
  due_time?: string | null
  recurrence_text?: string | null
  recurrence_rule?: RecurrenceRule | null
}

export interface TaskTag {
  task_id: string
  tag: string
}

export interface TaskList {
  id: string
  name: string
  sort_order: number
  created_at: string
  updated_at: string
}

export interface NewTaskListInput {
  name: string
  sort_order?: number
}
