export type ItemStatus = 'planned' | 'active' | 'done' | 'abandoned'
export type KRStatus = 'not_started' | 'on_track' | 'off_track' | 'blocked' | 'done'
export type CheckinStatus = 'on_track' | 'off_track' | 'blocked'
export type ReviewRating = 'strong' | 'steady' | 'rough'
export type HealthStatus = 'not_started' | 'on_track' | 'off_track' | 'blocked' | 'done'

export interface AnnualObjective {
  id: string
  name: string
  color: string
  sort_order: number
  status: 'active' | 'abandoned'
  notes: string
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

export interface RoadmapItem {
  id: string
  annual_objective_id: string
  title: string
  quarter: string | null
  sort_order: number
  status: ItemStatus
  health_status: HealthStatus
  progress: number
  is_parked: boolean
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
}
