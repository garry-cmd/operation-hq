import { NextResponse } from 'next/server'

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
      {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
      }
    )
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      console.error(`Todoist API ${res.status}: ${body}`)
      return NextResponse.json(
        { error: `Todoist API returned ${res.status}` },
        { status: 502 }
      )
    }
    const allTasks = await res.json()
    // Filter to today + overdue (server-side, since we can't use the filter param reliably)
    const today = new Date().toISOString().slice(0, 10)
    const tasks = allTasks.filter((t: { due?: { date?: string } | null }) =>
      t.due?.date && t.due.date <= today
    )
    return NextResponse.json(tasks, {
      headers: { 'Cache-Control': 'private, max-age=60' },
    })
  } catch (err) {
    console.error('Todoist fetch failed:', err)
    return NextResponse.json(
      { error: 'Failed to reach Todoist' },
      { status: 502 }
    )
  }
}
