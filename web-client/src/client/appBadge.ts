// Счётчик непрочитанных на вкладке — порт tweb uiNotificationsManager:
// title «(N) Telegram», navigator.setAppBadge (PWA) и favicon с красным
// кружком-бейджем. Источник — chatsStore: muted-чаты бейдж не красят
// (tweb folder_unread → unreadUnmutedPeerIds), архив в счёт не идёт
// (tweb считает по папке «Все», архив — отдельная папка).
import { useChatsStore } from '../stores/chatsStore'

export const BASE_TITLE = 'Telegram'

/** Сумма unread по незамьюченным неархивным диалогам. */
export function countUnmutedUnread(dialogs: { unread: number; muted: boolean; archived: boolean }[]): number {
  let n = 0
  for (const d of dialogs) if (!d.muted && !d.archived) n += d.unread
  return n
}

/** Заголовок вкладки: «(N) Telegram» при непрочитанных, иначе «Telegram». */
export function titleFor(unread: number): string {
  return unread > 0 ? `(${unread}) ${BASE_TITLE}` : BASE_TITLE
}

// ── favicon ──────────────────────────────────────────────────────────────────

let baseIcon: HTMLImageElement | null = null // исходная иконка (favicon.svg)
let baseIconFailed = false

function loadBaseIcon(): Promise<void> {
  return new Promise((resolve) => {
    const link = document.head.querySelector<HTMLLinkElement>('link[rel="icon"]')
    const img = new Image()
    img.onload = () => { baseIcon = img; resolve() }
    img.onerror = () => { baseIconFailed = true; resolve() }
    img.src = link?.href || '/favicon.svg'
  })
}

// Рисуем 32×32: исходная иконка (или фолбэк — синий круг с «T», цвет tweb
// #3390ec) + при unread>0 красный кружок справа-сверху с числом (≤9, иначе 9+).
function drawFavicon(unread: number): string | null {
  const canvas = document.createElement('canvas')
  canvas.width = 32
  canvas.height = 32
  const ctx = canvas.getContext('2d')
  if (!ctx) return null

  if (baseIcon) {
    try {
      ctx.drawImage(baseIcon, 0, 0, 32, 32)
    } catch {
      baseIconFailed = true
    }
  }
  if (!baseIcon || baseIconFailed) {
    ctx.beginPath()
    ctx.arc(16, 16, 16, 0, 2 * Math.PI)
    ctx.fillStyle = '#3390ec'
    ctx.fill()
    ctx.font = '700 18px Roboto, sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillStyle = '#fff'
    ctx.fillText('T', 16, 18)
  }

  if (unread > 0) {
    const str = unread > 9 ? '9+' : String(unread)
    ctx.beginPath()
    ctx.arc(22, 10, 10, 0, 2 * Math.PI)
    ctx.fillStyle = '#e53935'
    ctx.fill()
    ctx.font = `700 ${str.length > 1 ? 11 : 13}px Roboto, sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillStyle = '#fff'
    ctx.fillText(str, 22, 11)
  }

  try {
    return canvas.toDataURL('image/png')
  } catch {
    return null // svg «испачкал» canvas (не должен, но перестрахуемся)
  }
}

// Подмена href у <link rel="icon"> (создаём, если её нет); при unread=0
// возвращаем исходный favicon.svg (tweb setFavicon с data-href).
function setFavicon(href: string | null): void {
  let link = document.head.querySelector<HTMLLinkElement>('link[rel="icon"]')
  if (!link) {
    link = document.createElement('link')
    link.rel = 'icon'
    document.head.appendChild(link)
  }
  if (!link.dataset.href) link.dataset.href = link.href || '/favicon.svg'
  const next = href ?? link.dataset.href
  if (link.href !== next) link.href = next
}

// ── подписка ─────────────────────────────────────────────────────────────────

let started = false
let lastShown = -1
let timer: ReturnType<typeof setTimeout> | null = null

function apply(unread: number): void {
  if (unread === lastShown) return // не перерисовывать зря
  lastShown = unread

  document.title = titleFor(unread)

  // PWA-бейдж на иконке приложения (может отсутствовать / бросать)
  try {
    const nav = navigator as Navigator & {
      setAppBadge?: (n: number) => Promise<void>
      clearAppBadge?: () => Promise<void>
    }
    if (unread > 0) void nav.setAppBadge?.(unread)
    else void nav.clearAppBadge?.()
  } catch { /* not supported */ }

  setFavicon(unread > 0 ? drawFavicon(unread) : null)
}

/**
 * Подписка на chatsStore с троттлом 500мс: title + PWA-бейдж + favicon.
 * Идемпотентна (Shell может перемонтироваться, StrictMode зовёт эффекты дважды).
 */
export function initAppBadge(): void {
  if (started) return
  started = true

  const schedule = () => {
    if (timer) return // trailing-троттл: не чаще раза в 500мс
    timer = setTimeout(() => {
      timer = null
      apply(countUnmutedUnread(useChatsStore.getState().dialogs))
    }, 500)
  }

  void loadBaseIcon().then(() => {
    apply(countUnmutedUnread(useChatsStore.getState().dialogs))
    useChatsStore.subscribe(schedule)
  })
}
