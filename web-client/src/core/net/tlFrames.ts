// src/core/net/tlFrames.ts
//
// Разбор кадра, приехавшего по проводу TL: байты → апдейты с курсором.
//
// Конверта `{t, d, pts}` в TL нет — оболочку даёт схема. Конструкторов у
// объединения `Updates` семь (`updatesTooLong`, `updateShortMessage`,
// `updateShortChatMessage`, `updateShort`, `updatesCombined`, `updates`,
// `updateShortSentMessage`); наш сервер производит две
// (см. backend/internal/domain/mtupdates.go, решение Р7 разбора):
//
//   updateShort{update, date}                     — курсор внутри апдейта;
//   updates{updates, users, chats, date, seq}     — курсор это `seq` контейнера.
//
// Вторая форма и есть наш бывший конверт: у части конструкторов (кадры
// диалогов, реакции) параметра `pts` нет вовсе, а курсор кадру нужен.

import { TLDeserialization } from '@lib/mtproto/tl_utils'

/** Апдейт, приехавший в оболочке: тело плюс курсор из контейнера (если он там). */
export interface TLUpdate { update: { _: string } & Record<string, unknown>; seq?: number }

/**
 * Байты `bytes` схемы после разбора — Uint8Array, а модель клиента фазы 0
 * держит их base64-СТРОКОЙ (на JSON-проводе иначе и нельзя было).
 *
 * Пока модель не переведена, перевод формы делается ЗДЕСЬ и только здесь —
 * иначе один и тот же кадр приезжал бы вкладке в двух разных формах в
 * зависимости от флага провода. Это временный переходник на НОВОМ пути, и его
 * смерть назначена: он исчезает вместе с `bytes: string` в модели, когда
 * результат разбора станет самой моделью (фаза 3 программы).
 *
 * Ищется Uint8Array, а не «поля с типом bytes по схеме»: другого источника
 * Uint8Array у разбора нет, поэтому обход проще и ровно так же точен.
 */
function bytesToBase64(value: unknown): unknown {
  if (value instanceof Uint8Array) {
    let s = ''
    for (const b of value) s += String.fromCharCode(b)
    return btoa(s)
  }
  if (Array.isArray(value)) return value.map(bytesToBase64)
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = bytesToBase64(v)
    return out
  }
  return value
}

/**
 * Разбирает бинарный кадр в список апдейтов.
 *
 * Курсор контейнера отдаётся ПОСЛЕДНЕМУ апдейту пачки: `seq` описывает
 * состояние ПОСЛЕ применения всего контейнера, а не каждого элемента. Наш
 * сервер кладёт в контейнер ровно один апдейт, так что разница пока
 * умозрительная, — но правило названо здесь, а не выведено из этого факта.
 */
export function decodeTLFrame(raw: Uint8Array): TLUpdate[] {
  // Имя типа на разбор НЕ влияет: оболочка боксирована, конструктор ищется по
  // id из потока, и соответствия переданному типу `fetchObject` не проверяет
  // (у оригинала на этом месте и стоит `'Object'` — `networker.ts:1503`).
  // Оно здесь только как запись ожидания; несоответствие ловит явная проверка
  // `_` ниже.
  const envelope = new TLDeserialization(raw).fetchObject('Updates', 'ws') as {
    _: string
    update?: unknown
    updates?: unknown[]
    seq?: number
  }

  if (envelope._ === 'updateShort') {
    return [{ update: bytesToBase64(envelope.update) as TLUpdate['update'] }]
  }
  if (envelope._ === 'updates') {
    const list = envelope.updates ?? []
    return list.map((u, i) => ({
      update: bytesToBase64(u) as TLUpdate['update'],
      seq: i === list.length - 1 ? envelope.seq : undefined,
    }))
  }
  // Прочие конструкторы Updates (updatesTooLong, updateShortMessage) сервер не
  // производит: у нас догон свой, а короткие формы сообщения — оптимизация
  // MTProto-транспорта. Кадр не выбрасывается молча — о нём слышно.
  throw new Error(`неизвестная оболочка кадра: ${envelope._}`)
}
