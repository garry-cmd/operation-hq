/**
 * Icons — shared SVG icon library for Operation HQ.
 * All icons are 16×16 by default, stroke-based, using currentColor.
 * Pass size and className/style props to override.
 */

interface IconProps {
  size?: number
  color?: string
  style?: React.CSSProperties
}

const defaults = (size = 16, color = 'currentColor') => ({
  width: size, height: size,
  viewBox: '0 0 16 16',
  fill: 'none',
  stroke: color,
  strokeWidth: 1.5,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  display: 'inline-block',
  flexShrink: 0,
})

// ── Navigation / UI ────────────────────────────────────────────────

export function ChevronDown({ size = 12, color = 'currentColor', style }: IconProps) {
  return <svg {...defaults(size, color)} style={style}><path d="M3 5.5l5 5 5-5"/></svg>
}

export function ChevronRight({ size = 12, color = 'currentColor', style }: IconProps) {
  return <svg {...defaults(size, color)} style={style}><path d="M5.5 3l5 5-5 5"/></svg>
}

export function Dot({ size = 12, color = 'currentColor', style }: IconProps) {
  return (
    <svg {...defaults(size, color)} style={style}>
      <circle cx="8" cy="8" r="1.5" fill={color} stroke="none"/>
    </svg>
  )
}

// ── Notes ──────────────────────────────────────────────────────────

/** Inbox tray */
export function InboxIcon({ size = 14, color = 'currentColor', style }: IconProps) {
  return (
    <svg {...defaults(size, color)} style={style}>
      <path d="M2 10.5h3l1.5 2h3l1.5-2h3"/>
      <path d="M2 10.5V3a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v7.5"/>
    </svg>
  )
}

/** All notes — layers */
export function LayersIcon({ size = 14, color = 'currentColor', style }: IconProps) {
  return (
    <svg {...defaults(size, color)} style={style}>
      <path d="M8 1.5L14 4.5 8 7.5 2 4.5 8 1.5z"/>
      <path d="M2 8l6 3 6-3"/>
      <path d="M2 11.5l6 3 6-3"/>
    </svg>
  )
}

/** Notebook */
export function NotebookIcon({ size = 14, color = 'currentColor', style }: IconProps) {
  return (
    <svg {...defaults(size, color)} style={style}>
      <path d="M4 1.5h8a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-11a1 1 0 0 1 1-1z"/>
      <path d="M3 4.5h2M3 7.5h2M3 10.5h2"/>
      <path d="M6.5 4.5h4M6.5 7.5h4M6.5 10.5h2.5"/>
    </svg>
  )
}

/** Stack of notebooks */
export function NotebookStackIcon({ size = 14, color = 'currentColor', style }: IconProps) {
  return (
    <svg {...defaults(size, color)} style={style}>
      <rect x="4" y="3" width="9" height="11" rx="1"/>
      <path d="M3 5H2a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1v-1"/>
      <path d="M6 6.5h4M6 9h4M6 11h2.5"/>
    </svg>
  )
}

/** Pin */
export function PinIcon({ size = 12, color = 'currentColor', style }: IconProps) {
  return (
    <svg {...defaults(size, color)} style={style}>
      <path d="M9.5 2.5l4 4-1.5 1.5-1-1L8.5 9.5l.5 1.5-1.5 1.5-2-2-3 3H1.5v-.5l3-3-2-2L2.5 6.5l1.5.5L6.5 4.5 5.5 3.5 7 2l1.5 1z" fill={color} stroke="none"/>
      <line x1="8" y1="8" x2="2.5" y2="13.5"/>
    </svg>
  )
}

/** Tag / hash */
export function TagIcon({ size = 12, color = 'currentColor', style }: IconProps) {
  return (
    <svg {...defaults(size, color)} style={style}>
      <path d="M5.5 2L4 14M12 2l-1.5 12M2 5.5h12M1.5 10.5h12"/>
    </svg>
  )
}

// ── Resource link kinds ────────────────────────────────────────────

/** Todoist checkmark */
export function TodoistIcon({ size = 14, color = 'currentColor', style }: IconProps) {
  return (
    <svg {...defaults(size, color)} style={style}>
      <circle cx="8" cy="8" r="6.5"/>
      <path d="M5 8.5l2 2 4-4"/>
    </svg>
  )
}

/** Evernote notebook — elephant ear shape simplified to a clean note stack */
export function EvernoteNotebookIcon({ size = 14, color = 'currentColor', style }: IconProps) {
  return (
    <svg {...defaults(size, color)} style={style}>
      <rect x="3" y="2" width="8" height="10" rx="1"/>
      <path d="M5 14h7a1 1 0 0 0 1-1V4"/>
      <path d="M5 5h4M5 7.5h4M5 10h2.5"/>
    </svg>
  )
}

/** Evernote note — single document */
export function EvernoteNoteIcon({ size = 14, color = 'currentColor', style }: IconProps) {
  return (
    <svg {...defaults(size, color)} style={style}>
      <path d="M4 1.5h5.5L12 4v9.5a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-11a1 1 0 0 1 1-1z"/>
      <path d="M9.5 1.5V4H12"/>
      <path d="M5.5 6.5h5M5.5 9h5M5.5 11h3"/>
    </svg>
  )
}

/** Drive folder */
export function DriveFolderIcon({ size = 14, color = 'currentColor', style }: IconProps) {
  return (
    <svg {...defaults(size, color)} style={style}>
      <path d="M1.5 5a1 1 0 0 1 1-1h3.5l1.5 1.5H13a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H2.5a1 1 0 0 1-1-1V5z"/>
    </svg>
  )
}

/** Drive file */
export function DriveFileIcon({ size = 14, color = 'currentColor', style }: IconProps) {
  return (
    <svg {...defaults(size, color)} style={style}>
      <path d="M3.5 1.5h6L13 5v9a1 1 0 0 1-1 1H3.5a1 1 0 0 1-1-1v-11a1 1 0 0 1 1-1z"/>
      <path d="M9.5 1.5V5H13"/>
    </svg>
  )
}

/** Generic link / chain */
export function LinkIcon({ size = 14, color = 'currentColor', style }: IconProps) {
  return (
    <svg {...defaults(size, color)} style={style}>
      <path d="M6.5 9.5a3.5 3.5 0 0 0 5 0l2-2a3.5 3.5 0 0 0-5-5l-1 1"/>
      <path d="M9.5 6.5a3.5 3.5 0 0 0-5 0l-2 2a3.5 3.5 0 0 0 5 5l1-1"/>
    </svg>
  )
}

// ── Search / CommandPalette kinds ──────────────────────────────────

/** Objective — target/bullseye */
export function ObjectiveIcon({ size = 13, color = 'currentColor', style }: IconProps) {
  return (
    <svg {...defaults(size, color)} style={style}>
      <circle cx="8" cy="8" r="6.5"/>
      <circle cx="8" cy="8" r="3"/>
      <circle cx="8" cy="8" r=".5" fill={color} stroke="none"/>
    </svg>
  )
}

/** Key Result — diamond */
export function KRIcon({ size = 13, color = 'currentColor', style }: IconProps) {
  return (
    <svg {...defaults(size, color)} style={style}>
      <path d="M8 1.5L14.5 8 8 14.5 1.5 8 8 1.5z"/>
    </svg>
  )
}

/** Action — play arrow */
export function ActionIcon({ size = 13, color = 'currentColor', style }: IconProps) {
  return (
    <svg {...defaults(size, color)} style={style} fill={color} stroke="none">
      <path d="M5 3l8 5-8 5V3z"/>
    </svg>
  )
}

/** Note — document lines */
export function NoteIcon({ size = 13, color = 'currentColor', style }: IconProps) {
  return (
    <svg {...defaults(size, color)} style={style}>
      <path d="M3 1.5h7.5L13 4v10a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V2.5a1 1 0 0 1 1-1z"/>
      <path d="M10.5 1.5V4H13"/>
      <path d="M4.5 6.5h7M4.5 9h7M4.5 11h4"/>
    </svg>
  )
}

/** Reflect — clock */
export function ReflectIcon({ size = 13, color = 'currentColor', style }: IconProps) {
  return (
    <svg {...defaults(size, color)} style={style}>
      <circle cx="8" cy="8" r="6.5"/>
      <path d="M8 4.5V8l2.5 2"/>
    </svg>
  )
}

/** Space — hexagon */
export function SpaceIcon({ size = 13, color = 'currentColor', style }: IconProps) {
  return (
    <svg {...defaults(size, color)} style={style}>
      <path d="M8 1.5L14 5v6L8 14.5 2 11V5L8 1.5z"/>
    </svg>
  )
}

/** Notebook (for search results) — same as NotebookIcon */
export function SearchNotebookIcon({ size = 13, color = 'currentColor', style }: IconProps) {
  return <NotebookIcon size={size} color={color} style={style} />
}
