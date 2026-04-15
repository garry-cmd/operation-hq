import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Operation HQ',
  description: 'Your personal mission control — Roadmap, OKRs, Weekly Plans',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
