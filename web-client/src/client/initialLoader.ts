// Снятие статического сплеша (index.html) — когда у приложения появляется что
// показать (authed !== null). Идемпотентно, с фейдом.
let removed = false

export function removeInitialLoader(): void {
  if (removed) return
  removed = true
  const el = document.getElementById('initial-loader')
  if (!el) return
  el.classList.add('hide')
  el.addEventListener('transitionend', () => el.remove(), { once: true })
}
