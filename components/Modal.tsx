'use client'
import { ReactNode } from 'react'

interface Props {
  title: string
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
}

export default function Modal({ title, onClose, children, footer }: Props) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-5"
      style={{ background: 'rgba(0,0,0,0.65)' }} onClick={onClose}>
      <div className="w-full max-w-md max-h-[90vh] overflow-y-auto rounded-2xl p-6"
        style={{ background: 'var(--navy-700)', border: '1px solid var(--navy-500)' }}
        onClick={e => e.stopPropagation()}>
        <h2 className="text-base font-semibold mb-4" style={{ color: 'var(--navy-50)' }}>{title}</h2>
        {children}
        {footer && (
          <div className="flex justify-end gap-2 mt-4 pt-4" style={{ borderTop: '1px solid var(--navy-600)' }}>
            {footer}
          </div>
        )}
      </div>
    </div>
  )
}
