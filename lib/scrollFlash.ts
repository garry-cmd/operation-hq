// Scroll a KR row/chip into view and briefly flash it. Used when the command
// palette deep-links to a KR: the OKR and Roadmap screens tag their KR elements
// with data-kr-id, and this finds the matching one once it has rendered.
//
// The target may not exist on the first frames after navigation: a cross-space
// jump is still propagating space data into the freshly-mounted screen, and on
// the OKR screen the owning objective card has to auto-expand before the KR row
// mounts. So we poll, and only fire `onSettled` once the element is found (or we
// give up) — the caller uses that to defer clearing its deep-link state, which
// keeps the auto-expand prop live long enough for a late-mounting card.
export function scrollToAndFlash(krId: string, onSettled?: () => void, attempts = 20): void {
  const el = document.querySelector<HTMLElement>(`[data-kr-id="${krId}"]`)
  if (!el) {
    if (attempts > 0) { setTimeout(() => scrollToAndFlash(krId, onSettled, attempts - 1), 70); return }
    onSettled?.()
    return
  }
  el.scrollIntoView({ behavior: 'smooth', block: 'center' })
  const prevShadow = el.style.boxShadow
  const prevTransition = el.style.transition
  el.style.transition = 'box-shadow .2s ease'
  el.style.boxShadow = '0 0 0 2px var(--accent)'
  setTimeout(() => {
    el.style.boxShadow = prevShadow
    setTimeout(() => { el.style.transition = prevTransition }, 250)
  }, 1500)
  onSettled?.()
}
