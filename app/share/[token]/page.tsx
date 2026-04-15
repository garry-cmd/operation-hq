'use client'
import { use, useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import { AnnualObjective, RoadmapItem, QuarterlyKR } from '@/lib/types'
import { ACTIVE_Q } from '@/lib/utils'
import StatusPill from '@/components/StatusPill'

export default function SharePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params)
  const [valid, setValid] = useState<boolean | null>(null)
  const [objectives, setObjectives] = useState<AnnualObjective[]>([])
  const [items, setItems] = useState<RoadmapItem[]>([])
  const [krs, setKrs] = useState<QuarterlyKR[]>([])

  useEffect(() => {
    async function load() {
      const { data } = await supabase.from('share_tokens').select('*').eq('token', token).eq('active', true).single()
      setValid(!!data)
      if (!data) return
      const [o, r, k] = await Promise.all([
        supabase.from('annual_objectives').select('*').order('sort_order'),
        supabase.from('roadmap_items').select('*').eq('quarter', ACTIVE_Q).order('sort_order'),
        supabase.from('quarterly_krs').select('*').order('sort_order'),
      ])
      setObjectives(o.data ?? [])
      setItems(r.data ?? [])
      setKrs(k.data ?? [])
    }
    load()
  }, [token])

  if (valid === null) return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="w-5 h-5 border-2 border-gray-200 border-t-[#1D9E75] rounded-full animate-spin" />
    </div>
  )

  if (!valid) return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 text-gray-400 text-sm">
      <div className="text-center"><div className="text-4xl mb-3">🔒</div>This link is invalid or has been disabled.</div>
    </div>
  )

  const activeItems = items.filter(i => i.status !== 'abandoned')

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-amber-50 border-b border-amber-200 text-center text-xs text-amber-700 py-2 px-4">
        👁 Read-only view shared from Operation HQ
      </div>
      <header className="bg-white border-b border-gray-200 px-5 h-13 flex items-center">
        <div className="text-sm font-bold uppercase tracking-widest text-gray-900">
          Operation <span className="text-[#1D9E75]">HQ</span>
        </div>
        <span className="ml-3 text-xs px-2.5 py-1 bg-[#E1F5EE] text-[#0F6E56] rounded-lg font-medium">{ACTIVE_Q} · Read only</span>
      </header>
      <main className="p-5 max-w-3xl mx-auto">
        <h1 className="text-base font-semibold text-gray-900 mb-4">{ACTIVE_Q} Objectives &amp; Key Results</h1>
        {activeItems.map(item => {
          const obj = objectives.find(o => o.id === item.annual_objective_id)
          const itemKrs = krs.filter(k => k.roadmap_item_id === item.id)
          const done = itemKrs.filter(k => k.status === 'done').length
          const pct = itemKrs.length ? Math.round(done / itemKrs.length * 100) : 0
          return (
            <div key={item.id} className="bg-white rounded-xl border border-gray-200 mb-3 overflow-hidden">
              <div className="px-4 py-3 flex items-start gap-2.5 border-b border-gray-100">
                <div className="w-2 h-2 rounded-full mt-1.5 shrink-0" style={{ background: obj?.color ?? '#888' }} />
                <div className="flex-1">
                  <div className="text-sm font-semibold text-gray-900">{item.title}</div>
                  {obj && <div className="text-[10px] text-gray-400 mt-0.5">↑ {obj.name}</div>}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <div className="w-16 h-1 rounded-full bg-gray-100">
                    <div className="h-1 rounded-full" style={{ width: `${pct}%`, background: obj?.color ?? '#1D9E75' }} />
                  </div>
                  <span className="text-[11px] text-gray-500">{pct}%</span>
                </div>
              </div>
              {itemKrs.map(kr => (
                <div key={kr.id} className="px-4 py-2.5 pl-9 flex items-start gap-2.5 border-b border-gray-50 last:border-0">
                  <div className={`w-3.5 h-3.5 rounded shrink-0 mt-0.5 border-[1.5px] flex items-center justify-center ${
                    kr.status === 'done' ? 'bg-[#1D9E75] border-[#1D9E75]' : 'border-gray-300'}`}>
                    {kr.status === 'done' && (
                      <svg width="8" height="6" viewBox="0 0 8 6" fill="none"><path d="M1 3L3 5L7 1" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                    )}
                  </div>
                  <span className={`text-xs flex-1 leading-relaxed ${kr.status === 'done' ? 'line-through text-gray-400' : 'text-gray-800'}`}>{kr.title}</span>
                  {kr.tag && <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-500 shrink-0">{kr.tag}</span>}
                  <StatusPill status={kr.status} />
                </div>
              ))}
            </div>
          )
        })}
      </main>
    </div>
  )
}
