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
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-5" onClick={onClose}>
      <div
        className="bg-white rounded-2xl p-6 w-full max-w-md max-h-[90vh] overflow-y-auto shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <h2 className="text-base font-semibold text-gray-900 mb-4">{title}</h2>
        {children}
        {footer && (
          <div className="flex justify-end gap-2 mt-4 pt-4 border-t border-gray-100">
            {footer}
          </div>
        )}
      </div>
    </div>
  )
}
