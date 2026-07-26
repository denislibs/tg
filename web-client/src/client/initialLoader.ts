// Снятие стартового фона (index.html) на первом рендере — authed решён локально
// (по токену), так что показывать всегда есть что. Идемпотентно, с фейдом.
let removed = false

export function removeInitialLoader(): void {
  if (removed) return
  removed = true
  const el = document.getElementById('initial-loader')
  if (!el) return
  el.classList.add('hide')
  el.addEventListener('transitionend', () => el.remove(), { once: true })
}
