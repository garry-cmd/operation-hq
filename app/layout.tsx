import type { Metadata, Viewport } from 'next'
import { Space_Grotesk, Inter, JetBrains_Mono } from 'next/font/google'
import './globals.css'

// Evolve type system: Space Grotesk (display), Inter (body), JetBrains Mono (readouts).
// Exposed as CSS variables and consumed in globals.css.
const fontDisplay = Space_Grotesk({ subsets: ['latin'], variable: '--font-display', display: 'swap' })
const fontBody = Inter({ subsets: ['latin'], variable: '--font-body', display: 'swap' })
const fontMono = JetBrains_Mono({ subsets: ['latin'], variable: '--font-mono', display: 'swap' })

export const metadata: Metadata = {
  title: 'Operation HQ',
  description: 'Personal mission control — Home, Roadmap, Calendar',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'Op HQ',
  },
  icons: {
    apple: '/apple-touch-icon.png',
    icon: '/icon-192.png',
  },
}

export const viewport: Viewport = {
  themeColor: '#f7f9fc',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="light" className={`${fontDisplay.variable} ${fontBody.variable} ${fontMono.variable}`}>
      <body style={{ margin: 0, overscrollBehavior: 'none' }}>
        {children}
      </body>
    </html>
  )
}
