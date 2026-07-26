// Анимации смены аккаунта — 1:1 из tweb:
// - «Добавить аккаунт» (sidebarLeft/index.ts addAccount): чат уезжает
//   main-screen-exit → exiting (scale 1.75 + fade, 200мс), флаг «анимировать
//   auth» переживает reload;
// - возврат из auth (AuthCardsHost back): флаг «анимировать main» → после
//   reload мессенджер появляется main-screen-enter (scale 1.75 → 1, 200мс);
// - переключение аккаунта из меню: список чатов уезжает chatlist-exit
//   (translateY(18px) scale(1.01) + fade, 200мс).
// Флаги — в localStorage (tweb: sessionStorage should_animate_auth/main).
export const ANIMATE_AUTH_KEY = 'msgr_animate_auth'
export const ANIMATE_MAIN_KEY = 'msgr_animate_main'
export const PREV_ACCOUNT_KEY = 'msgr_prev_account'

export const doubleRaf = () =>
  new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())))
export const pause = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

// tweb sidebarLeft.addAccount: exit чата перед уходом на экран входа
export async function playMainScreenExit(el: HTMLElement | null): Promise<void> {
  if (!el) return
  el.classList.add('main-screen-exit')
  await doubleRaf()
  el.classList.add('main-screen-exiting')
  await pause(200)
}

// tweb src/index.ts (should_animate_main): появление мессенджера
export async function playMainScreenEnter(el: HTMLElement | null): Promise<void> {
  if (!el) return
  el.classList.add('main-screen-enter')
  await doubleRaf()
  el.classList.add('main-screen-entering')
  await pause(200)
  el.classList.remove('main-screen-enter', 'main-screen-entering')
}

// tweb меню аккаунтов: список чатов уезжает перед changeAccount
export async function playChatlistExit(el: HTMLElement | null): Promise<void> {
  if (!el) return
  el.classList.add('chatlist-exit')
  await doubleRaf()
  el.classList.add('chatlist-exiting')
  await pause(200)
}

// tweb AuthCardsHost hostEnter: экран входа въезжает справа при добавлении
// аккаунта (translateX(100px)+fade → 0, 0.4s).
export function playAuthHostEnter(el: HTMLElement | null): void {
  el?.animate(
    [{ opacity: 0, transform: 'translateX(100px)' }, { opacity: 1, transform: 'none' }],
    { duration: 400, easing: 'ease', fill: 'backwards' },
  )
}

// tweb AuthCardsHost hostExit: перед возвратом к прежнему аккаунту
// (scale 1→1.025 + fade out, 0.2s).
export async function playAuthHostExit(el: HTMLElement | null): Promise<void> {
  if (!el) return
  el.animate(
    [{ opacity: 1, transform: 'scale(1)' }, { opacity: 0, transform: 'scale(1.025)' }],
    { duration: 200, easing: 'ease', fill: 'forwards' },
  )
  await pause(200)
}
