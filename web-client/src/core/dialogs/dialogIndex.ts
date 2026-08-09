// Порт порядка диалогов из tweb (lib/storages/dialogs.ts). Смысл: порядок —
// ПРОИЗВОДНАЯ ОТ ДАННЫХ, а не позиция в ответе сервера. Из одних и тех же данных
// всегда получается один и тот же порядок, поэтому кэш и сеть не расходятся и
// список не перетасовывается после ответа сети.
//
// Оригинал (dialogs.ts:605-608):
//   generateDialogIndex(date, isPinned) => (date * 0x10000) + (isPinned ? 0 : (++dialogsNum & 0xFFFF))
//
// Отличие от tweb: там младшие 16 бит — инкрементный счётчик экземпляра
// (разрешитель ничьей при равных датах). Счётчик зависит от порядка вызовов, то
// есть НЕ детерминирован между кэшем и сетью — ровно то, чего мы избегаем.
// Берём вместо него chatId: так же разводит ничьи, но одинаково при любом порядке.
//
// Модуль чистый: никаких обращений к сторам, всё приходит аргументами.
import type { Dialog, Draft } from '../models'

/** tweb `generateDialogPinnedDateByIndex` (dialogs.ts:924-926): заведомо больше любой реальной даты. */
export const PINNED_BASE = 0x7fff0000

/** ISO-строка (`lastMessage.at`, `Draft.updatedAt`) → unix-секунды; 0 при отсутствии/битой дате. */
const secs = (iso: string | undefined): number => {
  if (!iso) return 0
  const ms = Date.parse(iso)
  return Number.isNaN(ms) ? 0 : Math.floor(ms / 1000)
}

/**
 * Числовой индекс диалога: больше — выше в списке.
 *
 * @param pinnedOrder порядок закреплённых в текущей папке (State `pinnedOrders`)
 * @param draft черновик чата, если есть. В tweb черновик лежит внутри `dialog.draft`
 *   (dialogs.ts:904-910), у нас — в отдельном сторе (`AppState.drafts`), поэтому
 *   передаётся аргументом, чтобы модуль остался чистым.
 */
export function dialogIndex(
  dialog: Dialog,
  pinnedOrder: readonly number[],
  draft?: Pick<Draft, 'updatedAt'>,
): number {
  const date = dialog.pinned ? pinnedDate(dialog, pinnedOrder) : activityDate(dialog, draft)
  // Младшие 16 бит — разрешитель ничьей (tweb: ++dialogsNum, у нас chatId).
  return date * 0x10000 + (dialog.pinned ? 0 : dialog.chatId & 0xffff)
}

/** tweb `generateDialogPinnedDate` (dialogs.ts:928-943). */
function pinnedDate(dialog: Dialog, order: readonly number[]): number {
  const idx = order.indexOf(dialog.chatId)
  // Не нашли в сохранённом порядке — считаем самым верхним (tweb: order.unshift).
  const pinnedIndex = idx === -1 ? 0 : idx
  const len = idx === -1 ? order.length + 1 : order.length
  // Переворот: нулевой в порядке закреплённых получает наибольшее значение.
  return PINNED_BASE + ((len - 1 - pinnedIndex) & 0xffff)
}

/** tweb `generateIndexForDialog` (dialogs.ts:869-922): дата последней активности. */
function activityDate(dialog: Dialog, draft?: Pick<Draft, 'updatedAt'>): number {
  const top = secs(dialog.lastMessage?.at)
  // Черновик свежее последнего сообщения поднимает диалог (dialogs.ts:904-910).
  const draftDate = secs(draft?.updatedAt)
  // Осознанное отступление от tweb: там пустой диалог получает `topDate ||= tsNow()`
  // (dialogs.ts:913) — текущее время, разное на каждом вызове. Это ровно та
  // недетерминированность, от которой мы уходим, поэтому оставляем 0: диалог без
  // активности стабильно оказывается внизу.
  return Math.max(top, draftDate)
}
