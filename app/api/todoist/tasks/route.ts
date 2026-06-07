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
    // DEBUG: expose the raw response shape
    const isArr = Array.isArray(data)
    const keys = isArr ? 'top-level-array' : Object.keys(data)
    const allTasks = isArr ? data : (data.results ?? data.items ?? data.tasks ?? [])
    const today = new Date().toISOString().slice(0, 10)
    const tasks = allTasks.filter((t: Record<string, unknown>) => {
      const due = t.due as Record<string, unknown> | null | undefined
      return due && typeof due.date === 'string' && due.date <= today
    })
    return NextResponse.json({ _keys: keys, _total: allTasks.length, _filtered: tasks.length, _sample: allTasks[0] ?? null, tasks }, {
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
