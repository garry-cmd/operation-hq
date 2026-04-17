import { HabitCheckin, RoadmapItem } from './types'

export interface HabitProgress {
  currentCount: number
  targetCount: number
  completedSessions: HabitCheckin[]
  status: 'on_track' | 'off_track' | 'ahead'
  displayText: string
  showInFocus: boolean // Only daily/weekly habits
}

/**
 * Parse habit pattern from KR title to determine tracking mode
 */
export function parseHabitPattern(title: string): {
  mode: 'daily' | 'weekly_count' | 'weekly_percentage' | 'monthly_count'
  target?: number
  showInFocus: boolean
} {
  const titleLower = title.toLowerCase()
  
  // Daily habits: "exercise daily", "babel every day"
  const dailyMatch = titleLower.match(/(daily|every day|each day)/i)
  if (dailyMatch) {
    return {
      mode: 'daily',
      target: 1,
      showInFocus: true
    }
  }
  
  // Weekly count: "exercise 4x per week", "gym 3 times per week"
  const weeklyCountMatch = titleLower.match(/(\d+)x?\s*(per\s*week|weekly|times?\s*per\s*week)/i)
  if (weeklyCountMatch) {
    return {
      mode: 'weekly_count',
      target: parseInt(weeklyCountMatch[1]),
      showInFocus: true
    }
  }
  
  // Weekly percentage: "eat clean 80% each week"
  const weeklyPercentMatch = titleLower.match(/(\d+)%\s*(each\s*week|weekly|per\s*week)/i)
  if (weeklyPercentMatch) {
    return {
      mode: 'weekly_percentage',
      target: parseInt(weeklyPercentMatch[1]),
      showInFocus: true
    }
  }
  
  // Monthly count: "write 3 articles per month" - NOT shown in Focus
  const monthlyCountMatch = titleLower.match(/(\d+)\s*(per\s*month|monthly|times?\s*per\s*month)/i)
  if (monthlyCountMatch) {
    return {
      mode: 'monthly_count',
      target: parseInt(monthlyCountMatch[1]),
      showInFocus: false
    }
  }
  
  // Default: if marked as habit but no pattern, treat as daily
  return {
    mode: 'daily',
    target: 1,
    showInFocus: true
  }
}

/**
 * Calculate habit progress based on checkins and pattern
 */
export function calculateHabitProgress(
  kr: RoadmapItem,
  checkins: HabitCheckin[],
  weekStart: string
): HabitProgress {
  const pattern = parseHabitPattern(kr.title)
  
  // Filter checkins to current week
  const weekStartDate = new Date(weekStart)
  const weekEndDate = new Date(weekStart)
  weekEndDate.setDate(weekEndDate.getDate() + 6)
  
  const weekCheckins = checkins.filter(c => {
    const checkinDate = new Date(c.date)
    return checkinDate >= weekStartDate && checkinDate <= weekEndDate
  })
  
  const currentCount = weekCheckins.length
  const targetCount = pattern.target || 1
  
  let status: 'on_track' | 'off_track' | 'ahead' = 'on_track'
  let displayText = ''
  
  switch (pattern.mode) {
    case 'daily':
      // For daily habits, check if completed today
      const today = new Date().toISOString().split('T')[0]
      const completedToday = weekCheckins.some(c => c.date === today)
      status = completedToday ? 'on_track' : 'off_track'
      displayText = completedToday ? 'Done today' : 'Pending today'
      return {
        currentCount: completedToday ? 1 : 0,
        targetCount: 1,
        completedSessions: weekCheckins,
        status,
        displayText,
        showInFocus: true
      }
      
    case 'weekly_count':
      if (currentCount >= targetCount) {
        status = 'ahead'
      } else {
        // Check if still on track for weekly target
        const now = new Date()
        const daysIntoWeek = Math.floor((now.getTime() - weekStartDate.getTime()) / (1000 * 60 * 60 * 24)) + 1
        const expectedByNow = (targetCount * daysIntoWeek) / 7
        status = currentCount >= expectedByNow - 1 ? 'on_track' : 'off_track'
      }
      displayText = `${currentCount}/${targetCount} this week`
      break
      
    case 'weekly_percentage':
      const daysInWeek = 7
      const currentPercentage = Math.round((currentCount / daysInWeek) * 100)
      if (currentPercentage >= targetCount) {
        status = 'ahead'
      } else if (currentPercentage < targetCount - 15) {
        status = 'off_track'
      }
      displayText = `${currentCount}/${daysInWeek} days (${currentPercentage}%)`
      break
      
    case 'monthly_count':
      // Monthly habits don't show in Focus, but calculate for OKRs tab
      displayText = `${currentCount} this month`
      break
  }
  
  return {
    currentCount,
    targetCount,
    completedSessions: weekCheckins,
    status,
    displayText,
    showInFocus: pattern.showInFocus
  }
}

/**
 * Get current week start (Monday)
 */
export function getCurrentWeekStart(): string {
  const now = new Date()
  const day = now.getDay()
  const diff = now.getDate() - day + (day === 0 ? -6 : 1) // Monday = 1
  const monday = new Date(now.setDate(diff))
  monday.setHours(0, 0, 0, 0)
  return monday.toISOString().split('T')[0]
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
