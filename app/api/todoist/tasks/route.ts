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
      'https://api.todoist.com/rest/v2/tasks?filter=' + encodeURIComponent('today | overdue'),
      {
        headers: { Authorization: `Bearer ${token}` },
        // Don't let Next.js cache this indefinitely — Todoist data changes often
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
    const tasks = await res.json()
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
