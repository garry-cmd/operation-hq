import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function GET() {
  const token = process.env.TODOIST_API_TOKEN
  if (!token) {
    return NextResponse.json(
      { error: 'TODOIST_API_TOKEN not configured' },
      { status: 503 }
    )
  }

  try {
    const res = await fetch(
      'https://api.todoist.com/api/v1/tasks',
      { headers: { Authorization: `Bearer ${token}` } }
    )
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      console.error(`Todoist API ${res.status}: ${body}`)
      return NextResponse.json(
        { error: `Todoist API returned ${res.status}` },
        { status: 502 }
      )
    }
    const data = await res.json()
    // v1 API returns { results: [...] } (paginated), not a flat array like v2 did
    const allTasks: Array<{ due?: { date?: string } | null }> = Array.isArray(data) ? data : (data.results ?? [])
    // Filter to today + overdue
    const today = new Date().toISOString().slice(0, 10)
    const tasks = allTasks.filter(t => t.due?.date && t.due.date <= today)
    return NextResponse.json(tasks, {
      headers: { 'Cache-Control': 'private, max-age=60' },
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('Todoist fetch failed:', msg)
    return NextResponse.json(
      { error: 'Failed to reach Todoist', detail: msg },
      { status: 502 }
    )
  }
}
