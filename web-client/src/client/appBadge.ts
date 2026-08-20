// Вкладка при новых уведомлениях — порт tweb `src/lib/uiNotificationsManager.ts`:
// пока вкладка «в простое» (idle), заголовок и фавиконка МИГАЮТ раз в секунду:
// секунду — «N notifications» + синий круг с числом, секунду — исходные title/иконка
// (tweb: onTitleInterval :605-661, resetTitle :665-672, toggleToggler :675-689,
// setFavicon :691-700). Счётчик — число НЕПОКАЗАННЫХ уведомлений (tweb notify()
// :712-718 инкрементит на каждое уведомляемое сообщение), он обнуляется, когда
// пользователь возвращается во вкладку (tweb :541-556 idle→false → clear()).
// Отдельно — PWA-бейдж на иконке приложения: navigator.setAppBadge получает
// `folder.unreadUnmutedPeerIds.size` (tweb :194-199) — число ЧАТОВ с непрочитанным
// (не сумму сообщений), по папке «Все» (архив в неё не входит).
import { useChatsStore } from '../stores/chatsStore'
import { isDialogArchived, type Dialog } from '../core/models'
import { isPeerMuted } from '../core/dialogs/notifySettings'
import { useI18nStore, type Lang } from '../i18n'
import { IS_MOBILE } from '../environment/userAgent'
import IS_TOUCH_SUPPORTED from '../environment/touchSupport'

// tweb config/font.ts:2 (FontFamily) — шрифт числа на фавиконке.
const FONT_FAMILY =
  'Roboto, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Oxygen-Sans, Ubuntu, Cantarell, "Helvetica Neue", sans-serif'

// ── i18n: tweb lang.ts:317 'Notifications.Count' {one_value/other_value} ─────
// У нас словарь плоский (ключ = английская строка), поэтому третья славянская
// форма (2-4) живёт отдельным ключом; правило выбора формы — в коде, как в
// core/format/commentsLabel.ts.
const ONE = '%d notification'
const FEW = '%d notifications (few)' // только ru/uk
const OTHER = '%d notifications'

/** «N notifications» для заголовка вкладки (tweb I18n.format('Notifications.Count')). */
export function notificationsCountTitle(count: number, lang: Lang, t: (s: string) => string): string {
  let key = OTHER
  if (lang === 'ru' || lang === 'uk') {
    const m10 = count % 10
    const m100 = count % 100
    if (m10 === 1 && m100 !== 11) key = ONE
    else if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) key = FEW
  } else if (count === 1) {
    key = ONE
  }
  return t(key).replace('%d', String(count))
}

/**
 * Число ЧАТОВ с непрочитанным среди незамьюченных неархивных (tweb
 * `unreadUnmutedPeerIds.size`).
 *
 * «Замьючен» и «в архиве» больше не приезжают полями строки: первый выражен
 * СРОКОМ (`notify_settings.mute_until`), второй — номером папки. Оба вопроса
 * задаются здесь теми же функциями, что и везде.
 */
export function countUnmutedUnreadPeers(
  dialogs: Pick<Dialog, 'unread_count' | 'notify_settings' | 'folder_id'>[],
  now = Math.floor(Date.now() / 1000),
): number {
  let n = 0
  for (const d of dialogs) {
    if (d.unread_count && !isPeerMuted(d.notify_settings, now) && !isDialogArchived(d)) n += 1
  }
  return n
}

// ── favicon (tweb :691-700) ──────────────────────────────────────────────────
// Ссылки не правятся на месте, а КЛОНИРУЮТСЯ и подменяют себя в DOM: только так
// браузер перечитывает иконку. Исходный href запоминается в data-href на самой
// ссылке (клон его наследует), а `arr[idx] = link` держит наш массив на живых
// узлах — старые после replaceWith выкинуты из документа.
let faviconElements: HTMLLinkElement[] = []
let prevFavicon: string | undefined

function setFavicon(href?: string): void {
  if (prevFavicon === href) return
  prevFavicon = href
  faviconElements.forEach((element, idx, arr) => {
    const link = element.cloneNode() as HTMLLinkElement
    link.dataset.href ||= link.href
    link.href = href ?? link.dataset.href
    element.replaceWith((arr[idx] = link))
  })
}

// tweb :627-660: круг во всю площадь канваса 32×dpr, #3390ec, белое число.
// Базовая линия — height * .5625 (не центр), размер шрифта зависит от разрядности.
function drawFavicon(count: number): string | null {
  const canvas = document.createElement('canvas')
  canvas.width = 32 * window.devicePixelRatio
  canvas.height = canvas.width

  const ctx = canvas.getContext('2d')
  if (!ctx) return null // отступление от tweb: у нас strict TS, tweb контекст не проверяет
  ctx.beginPath()
  ctx.arc(canvas.width / 2, canvas.height / 2, canvas.width / 2, 0, 2 * Math.PI, false)
  ctx.fillStyle = '#3390ec'
  ctx.fill()

  let fontSize = 24
  let str = '' + count
  if (count < 10) fontSize = 22
  else if (count < 100) fontSize = 20
  else {
    str = '99+'
    fontSize = 16
  }

  fontSize *= window.devicePixelRatio

  ctx.font = `700 ${fontSize}px ${FONT_FAMILY}`
  ctx.textBaseline = 'middle'
  ctx.textAlign = 'center'
  ctx.fillStyle = 'white'
  ctx.fillText(str, canvas.width / 2, canvas.height * 0.5625)

  return canvas.toDataURL()
}

// ── мигание заголовка (tweb :605-689) ────────────────────────────────────────

let titleBackup = ''
let titleChanged = false
let titleInterval: ReturnType<typeof setInterval> | null = null
let notificationsCount = 0

// Раз в секунду: если сейчас показан «тревожный» титул — вернуть исходный (это
// вторая половина мигания и на этом тике всё), иначе — поставить тревожный.
function onTitleInterval(): void {
  const wasChanged = titleChanged
  if (wasChanged) resetTitle()
  if (!notificationsCount || wasChanged) return

  titleChanged = true
  const { t, lang } = useI18nStore.getState()
  document.title = notificationsCountTitle(notificationsCount, lang, t)
  const href = drawFavicon(notificationsCount)
  if (href) setFavicon(href)
}

function resetTitle(): void {
  if (!titleChanged) return
  titleChanged = false
  document.title = titleBackup
  setFavicon()
}

function toggleToggler(enable = idle): void {
  if (IS_MOBILE) return

  if (titleInterval) {
    clearInterval(titleInterval)
    titleInterval = null
  }

  if (!enable) resetTitle()
  // отступление от tweb: tweb крутит интервал в воркере (apiManagerProxy.setInterval),
  // чтобы фон вкладки его не тормозил; у нас обычный setInterval (в скрытой вкладке
  // браузер и так клампит его ровно до 1с — периода мигания).
  else titleInterval = setInterval(onTitleInterval, 1000)
}

// ── idle (порт helpers/idleController в объёме, нужном уведомлениям) ─────────
// idle = вкладка/окно без пользователя: blur → idle, focus или первое движение
// мыши (на тач-устройствах — тач) → активен. Возврат пользователя обнуляет
// счётчик уведомлений (tweb :541-556: clear() → setNotificationCount(0)).
let idle = true

function setIdle(value: boolean): void {
  if (idle === value) return
  idle = value
  if (!idle) notificationsCount = 0
  toggleToggler()
}

/** Уведомление показано (tweb notify() :712-718: ++count и перезапуск мигания). */
export function incNotificationsCount(): void {
  if (!started) return // tweb notify(): `if(this.stopped) return` — до construct() не считаем
  ++notificationsCount
  toggleToggler()
}

// ── PWA-бейдж ────────────────────────────────────────────────────────────────

const setAppBadge: ((contents?: number) => Promise<void>) | undefined = (
  navigator as Navigator & { setAppBadge?: (contents?: number) => Promise<void> }
).setAppBadge?.bind(navigator)

let lastAppBadge = -1

function updateAppBadge(): void {
  const count = countUnmutedUnreadPeers(useChatsStore.getState().dialogs)
  if (count === lastAppBadge) return
  lastAppBadge = count
  void setAppBadge?.(count)
}

// ── старт ────────────────────────────────────────────────────────────────────

let started = false
let badgeTimer: ReturnType<typeof setTimeout> | null = null

/**
 * tweb construct() :160-199: запомнить фавиконки и исходный заголовок, обнулить
 * PWA-бейдж, подписаться на idle и на изменения непрочитанного.
 * Идемпотентна (Shell может перемонтироваться, StrictMode зовёт эффекты дважды).
 */
export function initAppBadge(): void {
  if (started) return
  started = true

  faviconElements = Array.from(
    document.head.querySelectorAll<HTMLLinkElement>('link[rel="icon"], link[rel="alternate icon"]'),
  )
  titleBackup = document.title
  void setAppBadge?.(0)

  window.addEventListener('blur', () => setIdle(true))
  window.addEventListener('focus', () => setIdle(false))
  window.addEventListener(IS_TOUCH_SUPPORTED ? 'touchstart' : 'mousemove', () => setIdle(false), {
    once: true,
    passive: true,
  })

  // отступление от tweb: события folder_unread у нас нет — пересчитываем по
  // подписке на стор с trailing-троттлом 500мс (стор дёргается и на печать/презенс).
  updateAppBadge()
  useChatsStore.subscribe(() => {
    if (badgeTimer) return
    badgeTimer = setTimeout(() => {
      badgeTimer = null
      updateAppBadge()
    }, 500)
  })
}
