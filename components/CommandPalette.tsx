'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  SearchEntry, SearchKind, RankedHit, rankEntries, highlightSegments, makeSnippet, Segment,
} from '@/lib/search'

const CHIPS: (SearchKind | 'All')[] = ['All', 'Objective', 'Key Result', 'Action', 'Task', 'Note']

function Hi({ segs }: { segs: Segment[] }) {
  return (
    <>
      {segs.map((s, i) =>
        s.hit
          ? <span key={i} style={{ background: 'var(--accent-dim)', color: 'var(--accent)', borderRadius: 3, padding: '0 1px', fontWeight: 600 }}>{s.text}</span>
          : <span key={i}>{s.text}</span>,
      )}
    </>
  )
}

function ResultRow({ hit, selected, onHover, onClick }: {
  hit: RankedHit; selected: boolean; onHover: () => void; onClick: () => void
}) {
  const e = hit.entry
  const snippet = hit.hitField === 'body' && e.body ? makeSnippet(e.body, hit.tokens) : null
  return (
    <div
      data-sel={selected}
      onMouseMove={onHover}
      onMouseDown={(ev) => { ev.preventDefault(); onClick() }}
      style={{
        display: 'flex', alignItems: 'center', gap: 12, padding: '9px 12px',
        borderRadius: 10, cursor: 'pointer', position: 'relative',
        background: selected ? 'var(--navy-700)' : 'transparent',
      }}
    >
      {selected && (
        <span style={{ position: 'absolute', left: 0, top: 7, bottom: 7, width: 3, borderRadius: 99, background: 'var(--accent)' }} />
      )}
      <span style={{
        flex: 'none', width: 24, height: 24, borderRadius: 7, display: 'flex',
        alignItems: 'center', justifyContent: 'center', fontSize: 12,
        background: selected ? 'var(--navy-600)' : 'var(--navy-700)', color: 'var(--navy-300)',
      }}>{e.icon}</span>

      <span style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 500, color: selected ? 'var(--navy-50)' : 'var(--navy-100)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          <Hi segs={highlightSegments(e.title || 'Untitled', hit.tokens)} />
        </div>
        <div style={{ fontSize: 11.5, color: 'var(--navy-400)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', marginTop: 1 }}>
          {e.tags && e.tags.map((t, i) => (
            <span key={i} style={{ color: 'var(--nw-caution-text)', marginRight: 5 }}>#<Hi segs={highlightSegments(t, hit.tokens)} /></span>
          ))}
          {e.spaceColor && <span style={{ display: 'inline-block', width: 7, height: 7, borderRadius: 99, background: e.spaceColor, marginRight: 6, verticalAlign: 'middle' }} />}
          {e.spaceName}
          {e.container && <> · {e.container}</>}
          {e.hint && <> · {e.hint}</>}
          {e.done && <> · done</>}
          {snippet && <> — <span style={{ color: 'var(--navy-300)' }}><Hi segs={snippet} /></span></>}
        </div>
      </span>

      <span style={{ flex: 'none', fontSize: 10, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--nw-label)', fontWeight: 600 }}>{e.kind}</span>
    </div>
  )
}

export default function CommandPalette({ open, onClose, entries, onPick }: {
  open: boolean
  onClose: () => void
  entries: SearchEntry[]
  onPick: (entry: SearchEntry) => void
}) {
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<SearchKind | 'All'>('All')
  const [sel, setSel] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const hits = useMemo(() => rankEntries(entries, query, filter, 12), [entries, query, filter])

  // Reset on each open; focus the field.
  useEffect(() => {
    if (open) {
      setQuery(''); setFilter('All'); setSel(0)
      const t = setTimeout(() => inputRef.current?.focus(), 0)
      return () => clearTimeout(t)
    }
  }, [open])

  useEffect(() => { setSel(0) }, [query, filter])

  // Keyboard: arrows navigate, Enter opens, Esc closes.
  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setSel(s => (hits.length ? (s + 1) % hits.length : 0)) }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setSel(s => (hits.length ? (s - 1 + hits.length) % hits.length : 0)) }
      else if (e.key === 'Enter') { e.preventDefault(); const h = hits[sel]; if (h) { onPick(h.entry); onClose() } }
      else if (e.key === 'Escape') { e.preventDefault(); onClose() }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, hits, sel, onPick, onClose])

  // Keep the selected row in view.
  useEffect(() => {
    const el = listRef.current?.querySelector('[data-sel="true"]') as HTMLElement | null
    el?.scrollIntoView({ block: 'nearest' })
  }, [sel, hits])

  if (!open) return null

  const pick = (e: SearchEntry) => { onPick(e); onClose() }

  return (
    <div
      onMouseDown={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 200,
        background: 'var(--nw-scrim, rgba(4,6,10,.55))', backdropFilter: 'blur(2px)',
        display: 'flex', alignItems: 'flex-start', justifyContent: 'center', paddingTop: '11vh',
      }}
    >
      <div
        role="dialog"
        aria-label="Search"
        onMouseDown={e => e.stopPropagation()}
        style={{
          width: 640, maxWidth: '92vw', maxHeight: '74vh',
          background: 'var(--navy-800)', border: '1px solid var(--navy-500)',
          borderRadius: 16, boxShadow: '0 24px 70px rgba(0,0,0,.45), 0 4px 12px rgba(0,0,0,.3)',
          overflow: 'hidden', display: 'flex', flexDirection: 'column',
        }}
      >
        {/* query row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '16px 18px', borderBottom: '1px solid var(--navy-600)' }}>
          <svg width="17" height="17" viewBox="0 0 17 17" fill="none" style={{ flex: 'none' }}>
            <circle cx="7.2" cy="7.2" r="5" stroke="var(--navy-400)" strokeWidth="1.5" />
            <path d="M11.2 11.2L15 15" stroke="var(--navy-400)" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search everything…  (try: rick · #billing · onboard stellar)"
            style={{ flex: 1, border: 'none', outline: 'none', background: 'none', color: 'var(--navy-50)', fontSize: 17, fontWeight: 500, fontFamily: 'inherit' }}
          />
          <span style={{ fontSize: 10.5, color: 'var(--navy-400)', background: 'var(--navy-700)', border: '1px solid var(--navy-500)', borderRadius: 5, padding: '2px 7px' }}>esc</span>
        </div>

        {/* type filter chips */}
        <div style={{ display: 'flex', gap: 6, padding: '10px 16px', borderBottom: '1px solid var(--navy-600)', flexWrap: 'wrap' }}>
          {CHIPS.map(c => {
            const on = c === filter
            return (
              <button
                key={c}
                onMouseDown={e => { e.preventDefault(); setFilter(c) }}
                style={{
                  fontSize: 11, fontWeight: 600, letterSpacing: '.02em', padding: '4px 10px', borderRadius: 99,
                  cursor: 'pointer', fontFamily: 'inherit',
                  background: on ? 'var(--accent-dim)' : 'var(--navy-700)',
                  color: on ? 'var(--accent)' : 'var(--navy-300)',
                  border: `1px solid ${on ? 'var(--accent)' : 'transparent'}`,
                }}
              >{c === 'All' ? 'All' : c + 's'}</button>
            )
          })}
        </div>

        {/* results */}
        <div ref={listRef} style={{ overflowY: 'auto', padding: 6 }}>
          {query.trim().length === 0 ? (
            <div style={{ padding: '34px 18px', textAlign: 'center', color: 'var(--navy-400)', fontSize: 13.5 }}>
              Search objectives, KRs, actions, tasks, notes, notebooks — and tags.
            </div>
          ) : hits.length === 0 ? (
            <div style={{ padding: '34px 18px', textAlign: 'center', color: 'var(--navy-400)', fontSize: 13.5 }}>
              No matches for “{query.trim()}”. Try fewer or different words.
            </div>
          ) : (
            hits.map((h, i) => (
              <ResultRow
                key={h.entry.id}
                hit={h}
                selected={i === sel}
                onHover={() => setSel(i)}
                onClick={() => pick(h.entry)}
              />
            ))
          )}
        </div>

        {/* footer hints */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '9px 16px', borderTop: '1px solid var(--navy-600)', fontSize: 11, color: 'var(--navy-400)' }}>
          <span><Kbd>↑↓</Kbd>navigate</span>
          <span><Kbd>↵</Kbd>open</span>
          <span><Kbd>#</Kbd>tags</span>
          <span style={{ flex: 1 }} />
          <span>{hits.length ? `${hits.length} result${hits.length > 1 ? 's' : ''}` : ''}</span>
        </div>
      </div>
    </div>
  )
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <span style={{ background: 'var(--navy-700)', border: '1px solid var(--navy-500)', borderRadius: 4, padding: '1px 5px', marginRight: 4, fontSize: 10 }}>{children}</span>
  )
}
