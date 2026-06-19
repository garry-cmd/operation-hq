import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

// The Todoist "OKRs" project is the KR-mirror we deliberately kept under the
// "wrap Todoist, don't replace" decision. Every OTHER Todoist project (Admin /
// Compliance, USPSA admin/finance, Keeply backlog, Reading) was migrated into
// HQ as native tasks — so surfacing them here would double-show items that now
// live natively. Scope the Focus strip to this project only.
const OKRS_PROJECT_ID =
  process.env.TODOIST_OKRS_PROJECT_ID || '6gmgfF3847FPPjjJ'

export async function GET() {
  const token = process.env.TODOIST_API_TOKEN
  if (!token) {
    return NextResponse.json(
      { error: 'TODOIST_API_TOKEN not configured' },
      { status: 503 }
    )
  }

  try {
    // v1 filter endpoint — returns only matching tasks, no manual pagination needed
    const res = await fetch(
      'https://api.todoist.com/api/v1/tasks/filter?' + new URLSearchParams({ query: 'today | overdue' }),
      { headers: { Authorization: `Bearer ${token}` } }
    )
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      console.error(`Todoist API ${res.status}: ${body}`)
      return NextResponse.json(
        { error: `Todoist API returned ${res.status}`, detail: body.slice(0, 200) },
        { status: 502 }
      )
    }
    const data = await res.json()
    const all = Array.isArray(data) ? data : (data.results ?? [])

    // Keep only OKRs-project tasks. Field naming varies across Todoist API
    // shapes (snake vs camel), so check both.
    const tasks = all.filter(
      (t: { project_id?: string; projectId?: string }) =>
        (t.project_id ?? t.projectId) === OKRS_PROJECT_ID
    )

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
