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

  const spinner = (
    <div className="min-h-screen flex items-center justify-center" style={{ background: 'var(--navy-900)' }}>
      <div className="w-5 h-5 rounded-full border-2 animate-spin" style={{ borderColor: 'var(--navy-600)', borderTopColor: 'var(--accent)' }} />
    </div>
  )

  if (valid === null) return spinner
  if (!valid) return (
    <div className="min-h-screen flex items-center justify-center text-sm" style={{ background: 'var(--navy-900)', color: 'var(--navy-400)' }}>
      <div className="text-center"><div className="text-4xl mb-3">🔒</div>This link is invalid or has been disabled.</div>
    </div>
  )

  const activeItems = items.filter(i => i.status !== 'abandoned')
  return (
    <div className="min-h-screen" style={{ background: 'var(--navy-900)' }}>
      <div className="text-center text-xs py-2 px-4" style={{ background: 'var(--amber-bg)', color: 'var(--amber-text)' }}>
        👁 Read-only view shared from Operation HQ
      </div>
      <header className="px-5 h-14 flex items-center" style={{ background: 'var(--navy-800)', borderBottom: '1px solid var(--navy-600)' }}>
        <div className="text-sm font-bold uppercase tracking-widest" style={{ color: 'var(--navy-50)' }}>
          Operation <span style={{ color: 'var(--accent)' }}>HQ</span>
        </div>
        <span className="ml-3 text-xs px-2.5 py-1 rounded-full font-semibold" style={{ background: 'var(--accent-dim)', color: 'var(--accent)' }}>
          {ACTIVE_Q} · Read only
        </span>
      </header>
      <main className="p-5 max-w-3xl mx-auto">
        <h1 className="text-base font-semibold mb-4" style={{ color: 'var(--navy-50)' }}>{ACTIVE_Q} Objectives &amp; Key Results</h1>
        {activeItems.map(item => {
          const obj = objectives.find(o => o.id === item.annual_objective_id)
          const itemKrs = krs.filter(k => k.roadmap_item_id === item.id)
          const done = itemKrs.filter(k => k.status === 'done').length
          const pct = itemKrs.length ? Math.round(done / itemKrs.length * 100) : 0
          return (
            <div key={item.id} className="rounded-xl mb-3 overflow-hidden" style={{ background: 'var(--navy-700)', border: '1px solid var(--navy-600)' }}>
              <div className="px-4 py-3 flex items-start gap-2.5" style={{ borderBottom: '1px solid var(--navy-600)' }}>
                <div className="w-2 h-2 rounded-full mt-1.5 shrink-0" style={{ background: obj?.color ?? '#888' }} />
                <div className="flex-1">
                  <div className="text-sm font-semibold" style={{ color: 'var(--navy-50)' }}>{item.title}</div>
                  {obj && <div className="text-[10px] mt-0.5" style={{ color: 'var(--navy-400)' }}>↑ {obj.name}</div>}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <div className="w-16 h-1 rounded-full" style={{ background: 'var(--navy-600)' }}>
                    <div className="h-1 rounded-full" style={{ width: `${pct}%`, background: obj?.color ?? 'var(--teal)' }} />
                  </div>
                  <span className="text-[11px]" style={{ color: 'var(--navy-300)' }}>{pct}%</span>
                </div>
              </div>
              {itemKrs.map(kr => (
                <div key={kr.id} className="px-4 py-2.5 pl-9 flex items-start gap-2.5" style={{ borderBottom: '1px solid var(--navy-800)' }}>
                  <div className="w-3.5 h-3.5 rounded shrink-0 mt-0.5 flex items-center justify-center"
                    style={{ border: `1.5px solid ${kr.status === 'done' ? 'var(--teal)' : 'var(--navy-500)'}`, background: kr.status === 'done' ? 'var(--teal)' : 'transparent' }}>
                    {kr.status === 'done' && <svg width="8" height="6" viewBox="0 0 8 6" fill="none"><path d="M1 3L3 5L7 1" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                  </div>
                  <span className="text-xs flex-1 leading-relaxed" style={{ color: kr.status === 'done' ? 'var(--navy-500)' : 'var(--navy-100)', textDecoration: kr.status === 'done' ? 'line-through' : 'none' }}>
                    {kr.title}
                  </span>
                  {kr.tag && <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: 'var(--navy-600)', color: 'var(--navy-300)' }}>{kr.tag}</span>}
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
