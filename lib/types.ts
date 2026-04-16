export type ObjStatus = 'active' | 'abandoned'
export type ItemStatus = 'planned' | 'active' | 'done' | 'abandoned'
export type KRStatus = 'not_started' | 'on_track' | 'off_track' | 'blocked' | 'done'
export type CheckinStatus = 'on_track' | 'off_track' | 'blocked'
export type ReviewRating = 'strong' | 'steady' | 'rough'

export interface AnnualObjective {
  id: string
  name: string
  color: string
  year: number
  sort_order: number
  status: ObjStatus
  created_at: string
}

export interface RoadmapItem {
  id: string
  annual_objective_id: string
  title: string
  quarter: string | null
  sort_order: number
  status: ItemStatus
  is_parked: boolean
  created_at: string
}

export interface QuarterlyKR {
  id: string
  roadmap_item_id: string
  title: string
  tag: string | null
  sort_order: number
  status: KRStatus
  pinned_to_checkin: boolean
  created_at: string
}

export interface WeeklyAction {
  id: string
  quarterly_kr_id: string
  title: string
  week_start: string
  completed: boolean
  carried_over: boolean
  sort_order: number
}

export interface DailyCheckin {
  id: string
  checkin_date: string
  quarterly_kr_id: string
  status: CheckinStatus
}

export interface WeeklyReview {
  id: string
  week_start: string
  rating: ReviewRating
  win: string | null
  slipped: string | null
  adjust_notes: string | null
  krs_hit: number
  krs_total: number
}
