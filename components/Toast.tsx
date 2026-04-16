'use client'
import { useEffect } from 'react'

export default function Toast({ msg, onDone }: { msg: string; onDone: () => void }) {
  useEffect(() => { const t = setTimeout(onDone, 2400); return () => clearTimeout(t) }, [onDone])
  return (
    <div className="fixed bottom-6 right-6 z-[200] text-sm px-4 py-2.5 rounded-xl font-medium"
      style={{ background: 'var(--navy-50)', color: 'var(--navy-900)', animation: 'slideUp .2s ease', boxShadow: '0 8px 32px rgba(0,0,0,0.5)' }}>
      {msg}
    </div>
  )
}
