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
  content: string
  log_date: string
  created_at: string
}

export interface ObjectiveLink {
  id: string
  objective_id: string
  url: string
  title: string
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

export interface WeeklyAction {
  id: string
  roadmap_item_id: string
  quarterly_kr_id?: string | null
  title: string
  week_start: string
  completed: boolean
  carried_over: boolean
  is_recurring: boolean
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
