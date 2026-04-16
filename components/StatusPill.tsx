'use client'

const MAP: Record<string, [string, string, string]> = {
  on_track:    ['var(--teal-bg)',  'var(--teal-text)',  'On track'],
  off_track:   ['var(--red-bg)',   'var(--red-text)',   'Off track'],
  blocked:     ['var(--amber-bg)', 'var(--amber-text)', 'Blocked'],
  done:        ['var(--teal-bg)',  'var(--teal-text)',  'Done'],
  not_started: ['var(--navy-700)', 'var(--navy-300)',   'Not started'],
  strong:      ['var(--teal-bg)',  'var(--teal-text)',  'Strong'],
  steady:      ['var(--amber-bg)', 'var(--amber-text)', 'Steady'],
  rough:       ['var(--red-bg)',   'var(--red-text)',   'Rough'],
}

export default function StatusPill({ status }: { status: string }) {
  const [bg, color, label] = MAP[status] ?? ['var(--navy-700)', 'var(--navy-300)', status]
  return (
    <span className="inline-flex items-center text-[10px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap"
      style={{ background: bg, color }}>
      {label}
    </span>
  )
}
