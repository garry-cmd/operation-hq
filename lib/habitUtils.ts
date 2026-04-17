import { HabitCheckin, RoadmapItem } from './types'

export interface HabitProgress {
  currentPercentage: number
  targetPercentage?: number
  successCount: number
  totalDays: number
  status: 'on_track' | 'off_track' | 'ahead'
  displayText: string
}

/**
 * Parse habit pattern from KR title to determine tracking mode
 */
export function parseHabitPattern(title: string): {
  mode: 'weekly_percentage' | 'weekly_count' | 'monthly_count' | 'daily'
  target?: number
  period: 'week' | 'month' | 'day'
} {
  const titleLower = title.toLowerCase()
  
  // Weekly percentage: "eat clean 80% each week" or "exercise 90% weekly"
  const weeklyPercentMatch = titleLower.match(/(\d+)%\s*(each\s*week|weekly|per\s*week)/)
  if (weeklyPercentMatch) {
    return {
      mode: 'weekly_percentage',
      target: parseInt(weeklyPercentMatch[1]),
      period: 'week'
    }
  }
  
  // Weekly count: "exercise 4x per week" or "post 3 times per week"
  const weeklyCountMatch = titleLower.match(/(\d+)x?\s*(per\s*week|weekly|times?\s*per\s*week)/)
  if (weeklyCountMatch) {
    return {
      mode: 'weekly_count',
      target: parseInt(weeklyCountMatch[1]),
      period: 'week'
    }
  }
  
  // Monthly count: "write 3 articles per month"
  const monthlyCountMatch = titleLower.match(/(\d+)\s*(per\s*month|monthly|times?\s*per\s*month)/)
  if (monthlyCountMatch) {
    return {
      mode: 'monthly_count',
      target: parseInt(monthlyCountMatch[1]),
      period: 'month'
    }
  }
  
  // Default to daily habit
  return {
    mode: 'daily',
    period: 'day'
  }
}

/**
 * Calculate habit progress based on checkins and pattern
 */
export function calculateHabitProgress(
  kr: RoadmapItem,
  checkins: HabitCheckin[],
  referenceDate: Date = new Date()
): HabitProgress {
  const pattern = parseHabitPattern(kr.title)
  
  switch (pattern.mode) {
    case 'weekly_percentage':
      return calculateWeeklyPercentage(checkins, pattern.target!, referenceDate)
    
    case 'weekly_count':
      return calculateWeeklyCount(checkins, pattern.target!, referenceDate)
    
    case 'monthly_count':
      return calculateMonthlyCount(checkins, pattern.target!, referenceDate)
    
    case 'daily':
    default:
      return calculateDailyProgress(checkins, referenceDate)
  }
}

function calculateWeeklyPercentage(
  checkins: HabitCheckin[],
  targetPercentage: number,
  referenceDate: Date
): HabitProgress {
  const weekStart = getWeekStart(referenceDate)
  const weekEnd = new Date(weekStart)
  weekEnd.setDate(weekEnd.getDate() + 6)
  
  const weekCheckins = checkins.filter(c => {
    const checkinDate = new Date(c.date)
    return checkinDate >= weekStart && checkinDate <= weekEnd
  })
  
  const daysElapsed = Math.min(
    Math.floor((referenceDate.getTime() - weekStart.getTime()) / (1000 * 60 * 60 * 24)) + 1,
    7
  )
  
  const successCount = weekCheckins.filter(c => c.completed).length
  const currentPercentage = daysElapsed > 0 ? Math.round((successCount / daysElapsed) * 100) : 0
  
  let status: 'on_track' | 'off_track' | 'ahead' = 'on_track'
  if (currentPercentage >= targetPercentage + 10) {
    status = 'ahead'
  } else if (currentPercentage < targetPercentage - 15) {
    status = 'off_track'
  }
  
  return {
    currentPercentage,
    targetPercentage,
    successCount,
    totalDays: daysElapsed,
    status,
    displayText: `${successCount}/${daysElapsed} days this week`
  }
}

function calculateWeeklyCount(
  checkins: HabitCheckin[],
  targetCount: number,
  referenceDate: Date
): HabitProgress {
  const weekStart = getWeekStart(referenceDate)
  const weekEnd = new Date(weekStart)
  weekEnd.setDate(weekEnd.getDate() + 6)
  
  const weekCheckins = checkins.filter(c => {
    const checkinDate = new Date(c.date)
    return checkinDate >= weekStart && checkinDate <= weekEnd
  })
  
  const successCount = weekCheckins.filter(c => c.completed).length
  const currentPercentage = Math.round((successCount / targetCount) * 100)
  
  const daysElapsed = Math.floor((referenceDate.getTime() - weekStart.getTime()) / (1000 * 60 * 60 * 24)) + 1
  const daysRemaining = 7 - daysElapsed
  const neededToSucceed = targetCount - successCount
  
  let status: 'on_track' | 'off_track' | 'ahead' = 'on_track'
  if (successCount >= targetCount) {
    status = 'ahead'
  } else if (neededToSucceed > daysRemaining) {
    status = 'off_track'
  }
  
  return {
    currentPercentage,
    successCount,
    totalDays: targetCount,
    status,
    displayText: `${successCount}/${targetCount} this week`
  }
}

function calculateMonthlyCount(
  checkins: HabitCheckin[],
  targetCount: number,
  referenceDate: Date
): HabitProgress {
  const monthStart = new Date(referenceDate.getFullYear(), referenceDate.getMonth(), 1)
  const monthEnd = new Date(referenceDate.getFullYear(), referenceDate.getMonth() + 1, 0)
  
  const monthCheckins = checkins.filter(c => {
    const checkinDate = new Date(c.date)
    return checkinDate >= monthStart && checkinDate <= monthEnd
  })
  
  const successCount = monthCheckins.filter(c => c.completed).length
  const currentPercentage = Math.round((successCount / targetCount) * 100)
  
  const daysInMonth = monthEnd.getDate()
  const daysElapsed = referenceDate.getDate()
  const daysRemaining = daysInMonth - daysElapsed
  
  // Check if on pace
  const expectedByNow = (targetCount * daysElapsed) / daysInMonth
  let status: 'on_track' | 'off_track' | 'ahead' = 'on_track'
  
  if (successCount >= targetCount) {
    status = 'ahead'
  } else if (successCount < expectedByNow - 0.5) {
    status = 'off_track'
  }
  
  return {
    currentPercentage,
    successCount,
    totalDays: targetCount,
    status,
    displayText: `${successCount}/${targetCount} this month`
  }
}

function calculateDailyProgress(
  checkins: HabitCheckin[],
  referenceDate: Date
): HabitProgress {
  const today = referenceDate.toISOString().split('T')[0]
  const todayCheckin = checkins.find(c => c.date === today)
  
  const successCount = todayCheckin?.completed ? 1 : 0
  
  return {
    currentPercentage: successCount * 100,
    successCount,
    totalDays: 1,
    status: successCount ? 'on_track' : 'off_track',
    displayText: successCount ? 'Done today' : 'Pending today'
  }
}

function getWeekStart(date: Date): Date {
  const d = new Date(date)
  const day = d.getDay()
  const diff = d.getDate() - day // Monday = 1, so adjust for Monday start
  const monday = new Date(d.setDate(diff))
  monday.setHours(0, 0, 0, 0)
  return monday
}

/**
 * Format date as YYYY-MM-DD for database storage
 */
export function formatDate(date: Date): string {
  return date.toISOString().split('T')[0]
}

/**
 * Get today's date as YYYY-MM-DD string
 */
export function getToday(): string {
  return formatDate(new Date())
}
