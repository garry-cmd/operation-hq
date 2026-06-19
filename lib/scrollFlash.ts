// Scroll a KR row/chip into view and briefly flash it. Used when the command
// palette deep-links to a KR: the OKR and Roadmap screens tag their KR elements
// with data-kr-id, and this finds the matching one once it has rendered.
//
// The target may not exist on the very first frame after navigation (space data
// is still propagating into the freshly-mounted screen), so we poll briefly.
export function scrollToAndFlash(krId: string, attempts = 10): void {
  const el = document.querySelector<HTMLElement>(`[data-kr-id="${krId}"]`)
  if (!el) {
    if (attempts > 0) setTimeout(() => scrollToAndFlash(krId, attempts - 1), 70)
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
}
