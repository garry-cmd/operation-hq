'use client'
import { WeeklyReview } from '@/lib/types'
import { ACTIVE_Q, formatWeek } from '@/lib/utils'
import StatusPill from './StatusPill'

interface Props { reviews: WeeklyReview[] }

export default function History({ reviews }: Props) {
  return (
    <div>
      <div className="mb-4">
        <h1 className="text-base font-semibold text-gray-900">History</h1>
        <p className="text-xs text-gray-400 mt-0.5">{ACTIVE_Q} weekly log</p>
      </div>
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {reviews.length === 0 && (
          <div className="text-center py-12 text-gray-400 text-sm">
            <div className="text-3xl mb-2">📚</div>
            No reviews yet. Complete your first weekly review in the Check-in tab.
          </div>
        )}
        {reviews.length > 0 && (
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-100">
                {['Week', 'Win', 'Slipped', 'KRs', 'Rating'].map(h => (
                  <th key={h} className="text-left text-[11px] font-medium text-gray-400 px-4 py-2.5">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {reviews.map(r => (
                <tr key={r.id} className="border-b border-gray-50 last:border-0 hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-3 text-xs font-semibold text-gray-900 whitespace-nowrap">{formatWeek(r.week_start)}</td>
                  <td className="px-4 py-3 text-xs text-gray-600 max-w-[180px]">{r.win || '—'}</td>
                  <td className="px-4 py-3 text-xs text-gray-600 max-w-[180px]">{r.slipped || '—'}</td>
                  <td className="px-4 py-3 text-xs font-semibold text-[#1D9E75] whitespace-nowrap">{r.krs_hit} / {r.krs_total}</td>
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
