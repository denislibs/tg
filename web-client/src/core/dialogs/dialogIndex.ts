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
// Берём вместо него peerId: так же разводит ничьи, но одинаково при любом порядке.
//
// Модуль чистый: никаких обращений к сторам, всё приходит аргументами.
import type { Dialog } from '../models'
import { draftDate } from './draft'

/** tweb `generateDialogPinnedDateByIndex` (dialogs.ts:924-926): заведомо больше любой реальной даты. */
export const PINNED_BASE = 0x7fff0000

/**
 * Числовой индекс диалога: больше — выше в списке.
 *
 * @param pinnedOrder порядок закреплённых в текущей папке (State `pinnedOrders`)
 *
 * Черновик отдельным аргументом больше НЕ передаётся: он лежит внутри самого
 * диалога (`dialog.draft`), как у оригинала (dialogs.ts:904-910). Пока он жил
 * рядом, дата активности собиралась из двух источников — а именно она и решает
 * место строки в списке.
 */
export function dialogIndex(dialog: Dialog, pinnedOrder: readonly number[]): number {
  const pinned = !!dialog.pFlags?.pinned
  const date = pinned ? pinnedDate(dialog, pinnedOrder) : activityDate(dialog)
  // Младшие 16 бит — разрешитель ничьей (tweb: ++dialogsNum, у нас peerId).
  return date * 0x10000 + (pinned ? 0 : dialog.peerId & 0xffff)
}

/** tweb `generateDialogPinnedDate` (dialogs.ts:928-943). */
function pinnedDate(dialog: Dialog, order: readonly number[]): number {
  const idx = order.indexOf(dialog.peerId)
  // Не нашли в сохранённом порядке — считаем самым верхним (tweb: order.unshift).
  const pinnedIndex = idx === -1 ? 0 : idx
  const len = idx === -1 ? order.length + 1 : order.length
  // Переворот: нулевой в порядке закреплённых получает наибольшее значение.
  return PINNED_BASE + ((len - 1 - pinnedIndex) & 0xffff)
}

/** tweb `generateIndexForDialog` (dialogs.ts:869-922): дата последней активности. */
function activityDate(dialog: Dialog): number {
  // `date:int` на проводе, но JSON может привезти что угодно; NaN здесь отравил
  // бы СОРТИРОВКУ ЦЕЛИКОМ (сравнения с NaN ложны в обе стороны — порядок
  // становится непредсказуемым, а не «этот диалог внизу»). Поэтому непригодное
  // значение сводим к 0 явно.
  const date = dialog.lastMessage?.date
  const top = Number.isFinite(date) ? (date as number) : 0
  // Черновик свежее последнего сообщения поднимает диалог (dialogs.ts:904-910).
  // Единицы у обоих одни — секунды эпохи (`date:int` схемы), поэтому
  // перевода из ISO здесь больше нет: черновик приезжает конструктором
  // draftMessage со своим `date`, как и сообщение.
  const draft = draftDate(dialog.draft)
  // Осознанное отступление от tweb: там пустой диалог получает `topDate ||= tsNow()`
  // (dialogs.ts:913) — текущее время, разное на каждом вызове. Это ровно та
  // недетерминированность, от которой мы уходим, поэтому оставляем 0: диалог без
  // активности стабильно оказывается внизу.
  return Math.max(top, draft)
}
