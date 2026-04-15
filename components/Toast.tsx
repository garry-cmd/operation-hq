'use client'
import { useEffect } from 'react'

export default function Toast({ msg, onDone }: { msg: string; onDone: () => void }) {
  useEffect(() => { const t = setTimeout(onDone, 2400); return () => clearTimeout(t) }, [onDone])
  return (
    <div className="fixed bottom-6 right-6 bg-gray-900 text-white text-sm px-4 py-2.5 rounded-xl z-[200] shadow-lg animate-[slideUp_.2s_ease]">
      {msg}
    </div>
  )
}
