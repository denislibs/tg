// Ported from tweb's fastSmoothScroll (src/helpers/fastSmoothScroll.ts): smooth-scroll
// `container` so `el` ends up vertically centered. `el` must already be in the DOM so
// its position is known. Like tweb's LONG_TRANSITION_MAX_DISTANCE, when the target is
// farther than `cap` px we jump to within `cap` of it first, then smooth-scroll the
// last stretch — so a jump across a long list is a short, snappy glide instead of a
// multi-second native crawl that layout shifts can derail.
export function smoothCenterElement(container: HTMLElement, el: HTMLElement, cap = 1500): void {
  const scRect = container.getBoundingClientRect()
  const elRect = el.getBoundingClientRect()
  const desired = container.scrollTop + (elRect.top - scRect.top) + elRect.height / 2 - container.clientHeight / 2
  const target = Math.max(0, Math.min(desired, container.scrollHeight - container.clientHeight))
  const cur = container.scrollTop
  if (Math.abs(target - cur) > cap) container.scrollTop = target > cur ? target - cap : target + cap
  container.scrollTo({ top: target, behavior: 'smooth' })
}

// Invoke `cb` once `container` stops scrolling. A fixed timeout is fragile (a long
// smooth scroll can take >1.5s), so poll scrollTop and fire when it holds still:
// fast for a no-op scroll, late for a long one, with a hard cap so it always fires.
export function afterScrollSettles(
  container: HTMLElement,
  cb: () => void,
  opts: { pollMs?: number; minMs?: number; maxMs?: number } = {},
): void {
  const { pollMs = 60, minMs = 180, maxMs = 2200 } = opts
  let last = container.scrollTop
  let stable = 0
  let elapsed = 0
  const iv = window.setInterval(() => {
    elapsed += pollMs
    const cur = container.scrollTop
    stable = Math.abs(cur - last) <= 1 ? stable + 1 : 0
    last = cur
    // require ~2 still polls, but give the smooth scroll time to start first
    if ((stable >= 2 && elapsed >= minMs) || elapsed >= maxMs) {
      window.clearInterval(iv)
      cb()
    }
  }, pollMs)
}
