'use client'
/**
 * MarkdownBody — single shared spot for rendering markdown.
 *
 * Used in both ActionPanel and ObjectivePanel for note bodies. The content
 * column is markdown source; this turns it into HTML via `marked`.
 *
 * Solo-app context: notes are written by the authenticated user themselves,
 * so XSS is self-inflicted (you'd be attacking your own browser). If notes
 * ever come from a non-trusted source (shared spaces, imported content, a
 * collaborator's writes) wrap `html` below in DOMPurify.sanitize() before
 * rendering.
 */
import { useMemo } from 'react'
import { marked } from 'marked'

marked.setOptions({ breaks: true, gfm: true })

const STYLES = `
.md-body { font-size: 13px; color: var(--navy-100); line-height: 1.6; }
.md-body p { margin: 0 0 8px; }
.md-body p:last-child { margin-bottom: 0; }
.md-body h1, .md-body h2, .md-body h3 { color: var(--navy-50); margin: 12px 0 6px; line-height: 1.3; }
.md-body h1 { font-size: 16px; font-weight: 700; }
.md-body h2 { font-size: 14px; font-weight: 700; }
.md-body h3 { font-size: 13px; font-weight: 700; }
.md-body ul, .md-body ol { margin: 0 0 8px; padding-left: 22px; }
.md-body li { margin-bottom: 2px; }
.md-body code {
  background: var(--navy-800); color: var(--accent);
  padding: 1px 5px; border-radius: 4px; font-size: 12px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}
.md-body pre {
  background: var(--navy-800); color: var(--navy-100);
  padding: 10px 12px; border-radius: 6px; overflow-x: auto;
  font-size: 12px; line-height: 1.5;
}
.md-body pre code { background: transparent; color: inherit; padding: 0; }
.md-body blockquote {
  border-left: 3px solid var(--accent);
  padding: 0 0 0 10px; margin: 0 0 8px;
  color: var(--navy-200);
}
.md-body a { color: var(--teal-text); text-decoration: underline; }
.md-body strong { color: var(--navy-50); font-weight: 700; }
.md-body em { color: var(--navy-100); font-style: italic; }
.md-body hr { border: none; border-top: 1px solid var(--navy-600); margin: 12px 0; }
.md-body input[type="checkbox"] { margin-right: 6px; }
.md-body table { border-collapse: collapse; margin: 0 0 8px; font-size: 12px; }
.md-body th, .md-body td { border: 1px solid var(--navy-600); padding: 4px 8px; text-align: left; }
.md-body th { background: var(--navy-700); font-weight: 700; }
`

let stylesInjected = false

export default function MarkdownBody({ content }: { content: string }) {
  // Inject styles once on first render. Module-scoped flag avoids React
  // re-rendering them per instance and avoids DOM bloat with multiple notes.
  if (typeof document !== 'undefined' && !stylesInjected) {
    const style = document.createElement('style')
    style.textContent = STYLES
    document.head.appendChild(style)
    stylesInjected = true
  }

  const html = useMemo(() => {
    if (!content) return ''
    // marked v12 returns a string when async:false. Cast since the type is
    // string|Promise<string> by default.
    return marked.parse(content, { async: false }) as string
  }, [content])

  if (!content) {
    return <div style={{ fontSize: 13, color: 'var(--navy-500)', fontStyle: 'italic' }}>(empty)</div>
  }

  return <div className="md-body" dangerouslySetInnerHTML={{ __html: html }} />
}
