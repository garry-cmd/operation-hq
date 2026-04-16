'use client'
import { WeeklyReview } from '@/lib/types'
import { ACTIVE_Q, formatWeek } from '@/lib/utils'
import StatusPill from './StatusPill'

export default function History({ reviews }: { reviews: WeeklyReview[] }) {
  return (
    <div>
      <div className="mb-4">
        <h1 className="text-base font-semibold" style={{ color: 'var(--navy-50)' }}>History</h1>
        <p className="text-xs mt-0.5" style={{ color: 'var(--navy-400)' }}>{ACTIVE_Q} weekly log</p>
      </div>
      <div className="rounded-xl overflow-hidden" style={{ background: 'var(--navy-700)', border: '1px solid var(--navy-600)' }}>
        {reviews.length === 0 && (
          <div className="text-center py-12 text-sm" style={{ color: 'var(--navy-400)' }}>
            <div className="text-3xl mb-2">📚</div>
            No reviews yet. Complete your first weekly review in the Check-in tab.
          </div>
        )}
        {reviews.length > 0 && (
          <table className="w-full">
            <thead>
              <tr style={{ borderBottom: '1px solid var(--navy-600)' }}>
                {['Week', 'Win', 'Slipped', 'KRs', 'Rating'].map(h => (
                  <th key={h} className="text-left px-4 py-2.5 text-[11px] font-semibold" style={{ color: 'var(--navy-400)' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {reviews.map(r => (
                <tr key={r.id} style={{ borderBottom: '1px solid var(--navy-800)' }}>
                  <td className="px-4 py-3 text-xs font-semibold whitespace-nowrap" style={{ color: 'var(--navy-50)' }}>{formatWeek(r.week_start)}</td>
                  <td className="px-4 py-3 text-xs max-w-[180px]" style={{ color: 'var(--navy-300)' }}>{r.win || '—'}</td>
                  <td className="px-4 py-3 text-xs max-w-[180px]" style={{ color: 'var(--navy-300)' }}>{r.slipped || '—'}</td>
                  <td className="px-4 py-3 text-xs font-bold whitespace-nowrap" style={{ color: 'var(--teal-text)' }}>{r.krs_hit} / {r.krs_total}</td>
                  <td className="px-4 py-3"><StatusPill status={r.rating} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
