// Ссылка на конкретное сообщение («Copy Message Link» в меню бабла).
//
// В tweb это `t.me/<username>/<mid>` — ссылка на домен Telegram, которую
// открывает их же клиент. У нас домена t.me нет, поэтому ссылка ведёт на наш
// origin и продолжает существующую схему хэша (`useUrlSync`):
//
//   #@channelname      → чат по юзернейму        (уже было)
//   #<peerId>          → чат по числовому id     (уже было)
//   #@channelname/123  → чат + прыжок к сообщению (добавлено здесь)
//   #<peerId>/123      → то же для чата без юзернейма
//
// Якорь сообщения — `seq` (порядковый номер сообщения В ЧАТЕ), а не глобальный
// `id`: именно им оперирует прыжок (`setPendingJump(peerId, seq)`), и он же
// аналог телеграмного `mid` — номера внутри чата, а не по всей базе.
import { useSearchStore } from '@stores/searchStore'

/** Хэш без ведущего `#`: цель навигации + (опционально) якорь сообщения. */
export interface ParsedHash {
  /** `@username` — публичный чат; иначе ЗНАКОВЫЙ ключ пира строкой
   *  (`-1234567` у группы/канала, `1234567` у человека). */
  target: string
  /** seq сообщения, если ссылка указывает на конкретное сообщение */
  seq?: number
  /** корень треда (`<peerId>_<rootMsgId>`) — как было до якоря сообщения */
  threadRoot?: number
}

/**
 * Разбор хэша навигации. Возвращает undefined, если хэш не по схеме —
 * вызывающий тогда ничего не делает (как и раньше при нераспознанном хэше).
 */
export function parseNavHash(rawHash: string): ParsedHash | undefined {
  const h = rawHash.replace(/^#/, '')
  if (!h) return undefined

  // Якорь сообщения — последний сегмент после `/`; всё до него — цель навигации.
  const slash = h.lastIndexOf('/')
  let target = h
  let seq: number | undefined
  if (slash > 0) {
    const tail = h.slice(slash + 1)
    if (/^\d+$/.test(tail)) {
      target = h.slice(0, slash)
      seq = Number(tail)
    }
  }

  if (target.startsWith('@')) {
    return target.length > 1 ? { target, seq } : undefined
  }

  // Ключ пира ЗНАКОВЫЙ: у группы/канала он отрицательный (`core/peers/peerId.ts`,
  // тот же класс символов, что у `isPeerId`). Без минуса в шаблоне хэш `#-42`
  // не разбирался бы вовсе — то есть ссылка на любую группу молча открывала бы
  // список чатов. Корень треда — `msgId`, он положительный всегда.
  const m = target.match(/^(-?\d+)(?:_(\d+))?$/)
  if (!m) return undefined
  return { target: m[1], seq, threadRoot: m[2] ? Number(m[2]) : undefined }
}

/**
 * Ссылка на сообщение для буфера обмена. Юзернейм предпочтительнее числового
 * id: такая ссылка читаема и переживает переезд между инсталляциями (её
 * разбирает та же ветка `@username`, что и обычную ссылку на чат).
 */
export function buildMessageLink({
  origin,
  pathname,
  peerId,
  username,
  seq,
}: {
  origin: string
  pathname: string
  peerId: PeerId | string
  username?: string | null
  seq: number
}): string {
  const target = username ? `@${username}` : String(peerId)
  return `${origin}${pathname}#${target}/${seq}`
}

/**
 * Поставить прыжок к сообщению, который потребит лента чата при открытии
 * (`Chat.tsx` читает `pendingJump` ровно так же для перехода из поиска).
 */
export function requestMessageJump(peerId: PeerId, seq: number): void {
  useSearchStore.getState().setPendingJump(peerId, seq)
}
