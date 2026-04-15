'use client'
import { KRStatus } from '@/lib/types'

const MAP: Record<string, [string, string]> = {
  on_track:    ['bg-[#E1F5EE] text-[#0F6E56]', 'On track'],
  off_track:   ['bg-[#FAECE7] text-[#993C1D]', 'Off track'],
  blocked:     ['bg-[#FAEEDA] text-[#633806]', 'Blocked'],
  done:        ['bg-[#E1F5EE] text-[#0F6E56]', 'Done'],
  not_started: ['bg-gray-100 text-gray-500',    'Not started'],
  strong:      ['bg-[#E1F5EE] text-[#0F6E56]', 'Strong'],
  steady:      ['bg-[#FAEEDA] text-[#633806]', 'Steady'],
  rough:       ['bg-[#FAECE7] text-[#993C1D]', 'Rough'],
}

export default function StatusPill({ status }: { status: string }) {
  const [cls, label] = MAP[status] ?? ['bg-gray-100 text-gray-500', status]
  return (
    <span className={`inline-flex items-center text-[10px] font-medium px-2 py-0.5 rounded-full whitespace-nowrap ${cls}`}>
      {label}
    </span>
  )
}
