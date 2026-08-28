import { create } from 'zustand'
import type { ThreadInfo } from '../components/Chat'

// Стек инстансов колонки чата — порт `appImManager.chats[]` (tweb
// lib/appImManager.ts:218). Открытие треда не подменяет содержимое текущего
// чата, а кладёт сверху новый инстанс; возврат снимает верхний и отдаёт
// нижнему его состояние. Верхний элемент — активный (инвариант).

/** Значения совпадают с `data-type` живого DOM tweb (`chat`, `discussion`). */
export type ChatType = 'chat' | 'discussion' | 'saved' | 'pinned' | 'search'

export interface ChatInstanceDesc {
  /**
   * Личность ИНСТАНСА, а не пира — и она же ключ React-узла.
   *
   * Это несущая деталь порта. У tweb инстанс — объект `Chat`, созданный
   * `createNewChat()` (appImManager.ts:2658); пир внутри него меняется
   * (`chat.setPeer`), а сам инстанс остаётся тем же. Пока личность выводилась
   * из пира (ключ `${peerId}_${threadId}_${type}`), обычное открытие чата из
   * списка выглядело для контейнера сменой инстанса и играло переход выезда —
   * которого в оригинале там нет: `chatsSelectTab` выходит первой же строкой
   * `if(this.prevTab === tab) return` (appImManager.ts:2238-2240).
   */
  id: number
  peerId: number
  threadId?: number
  type: ChatType
  /** только для type === 'search' */
  query?: string
  /** мета треда для шапки; на этапе 2 уедет в сам инстанс */
  thread?: ThreadInfo
}

export interface OpenChatOptions {
  peerId: number
  threadId?: number
  /** тип задаёт вызывающий: форум-топик в tweb остаётся `chat` с threadId
   *  (chat.ts:894), комментарии — `discussion` */
  type: ChatType
  query?: string
  thread?: ThreadInfo
}

/**
 * ЧТО инстанс сейчас показывает — порт `appImManager.isSamePeer`. Ключом
 * React-узла больше не служит (им стал `id`): сравнение по пиру нужно только
 * там, где оригинал спрашивает «тот же ли это пир» — в `setPeer` и
 * `setInnerPeer`.
 */
export function descKey(o: { peerId: number; threadId?: number; type: ChatType }): string {
  return `${o.peerId}_${o.threadId ?? 0}_${o.type}`
}

// Порт `createNewChat` (appImManager.ts:2658) в части выдачи личности: там её
// даёт сам объект `Chat`, здесь — счётчик. Модульная переменная, а не поле
// стора: `clear()` не имеет права её сбрасывать, иначе новый инстанс после
// логаута получил бы id только что размонтированного и React переиспользовал
// бы его узел.
let instanceSeq = 0

function makeDesc(o: OpenChatOptions): ChatInstanceDesc {
  return {
    id: ++instanceSeq,
    peerId: o.peerId,
    threadId: o.threadId,
    type: o.type,
    query: o.query,
    thread: o.thread,
  }
}

/** Порт `chat.setPeer(options)`: у ТОГО ЖЕ инстанса меняется содержимое. */
function withPeer(desc: ChatInstanceDesc, o: OpenChatOptions): ChatInstanceDesc {
  return {
    id: desc.id,
    peerId: o.peerId,
    threadId: o.threadId,
    type: o.type,
    query: o.query,
    thread: o.thread,
  }
}

interface ChatStackState {
  stack: ChatInstanceDesc[]
  /**
   * Играть ли переход на последнюю смену стека — порт параметра `animate` у
   * `chatsSelectTab` (appImManager.ts:2237), который оригинал протаскивает
   * через `spliceChats`.
   *
   * Это ОБЪЯВЛЕНИЕ намерения владельцем, а не вывод из формы стека. Вывести
   * его нельзя: уход к другому пиру из треда и возврат к пиру дна дают ОДНУ И
   * ТУ ЖЕ форму (стек ужался до одного элемента), а анимация у них разная —
   * `spliceChats(0, true, true, spliced)` против `spliceChats(0, false,
   * false, spliced)` (appImManager.ts:2784, 2788).
   *
   * Ставится тем же `set()`, что и `stack`, поэтому читатель, реагирующий на
   * смену `stack`, видит согласованную пару.
   */
  animateNext: boolean
  /** Порт `appImManager.setPeer` (:2755-2805) — открытие чата из списка */
  setPeer: (o: OpenChatOptions) => void
  /** Порт `appImManager.setInnerPeer` (:2830-2871) — тред, тема, отложенные */
  setInnerPeer: (o: OpenChatOptions) => void
  popTo: (index: number) => void
  /** tweb spliceChats(chatIndex) при пустом peerId — снять верхний */
  closeTop: () => void
  clear: () => void
}

export const useChatStackStore = create<ChatStackState>((set) => ({
  stack: [],
  animateNext: false,

  setPeer: (o) =>
    set((s) => {
      const stack = s.stack
      // Пустой стек — оригиналу неизвестное состояние: у него инстанс есть
      // всегда, первый создаётся в конструкторе (appImManager.ts:314). Мы
      // пустую колонку не рисуем вовсе, поэтому первый инстанс рождается тут.
      if (!stack.length) return { stack: [makeDesc(o)], animateNext: false }

      const top = stack[stack.length - 1]
      const chatIndex = stack.length - 1 // `this.chats.indexOf(this.chat)` (:2759)

      // Уход к ДРУГОМУ пиру, пока открыт тред (:2775-2790): стек схлопывается
      // до дна. Анимация — только когда дно уже показывает целевой пир, тогда
      // это честный возврат назад; иначе дну меняют содержимое и переход
      // гасят.
      if (chatIndex > 0 && descKey(top) !== descKey(o)) {
        const base = stack[0]
        return descKey(base) === descKey(o)
          ? { stack: [base], animateNext: true } // spliceChats(0, true, true, spliced)
          : { stack: [withPeer(base, o)], animateNext: false } // setPeer + spliceChats(0, false, false)
      }

      // Обычный случай (:2804-2805): `chat.setPeer(options)` на ВЕРХНЕМ
      // инстансе, стек не трогаем. Инстанс тот же — перехода нет.
      return { stack: [...stack.slice(0, -1), withPeer(top, o)], animateNext: false }
    }),

  setInnerPeer: (o) =>
    set((s) => {
      const stack = s.stack
      // «Тот же пир уже в стеке» → срезать всё выше него и доставить ему
      // опции (:2852-2855: `spliceChats(existingIndex + 1)` → `setPeer`).
      const i = stack.findIndex((d) => descKey(d) === descKey(o))
      if (i !== -1) {
        const kept = stack.slice(0, i + 1)
        const top = kept[kept.length - 1]
        return { stack: [...kept.slice(0, -1), withPeer(top, o)], animateNext: true }
      }
      // `if (oldChat.inited) chat = this.createNewChat()` (:2859-2861):
      // неиспользованный инстанс переиспользуется, а не плодит второй. У нас
      // «неиспользованный» = пустой стек.
      if (!stack.length) return { stack: [makeDesc(o)], animateNext: false }
      return { stack: [...stack, makeDesc(o)], animateNext: true }
    }),

  popTo: (index) =>
    set((s) => ({ stack: index < 0 ? [] : s.stack.slice(0, index + 1), animateNext: true })),
  closeTop: () =>
    set((s) => (s.stack.length > 1 ? { stack: s.stack.slice(0, -1), animateNext: true } : s)),
  clear: () => set({ stack: [], animateNext: false }),
}))

/** Активный инстанс — верхний (инвариант стека). */
export const selectActive = (s: ChatStackState): ChatInstanceDesc | undefined => s.stack[s.stack.length - 1]

/** Подсветку в списке чатов определяет ДНО стека: в tweb чат из списка — chats[0],
 *  а тред лежит поверх него и подсветку не меняет. */
export const selectRoot = (s: ChatStackState): ChatInstanceDesc | undefined => s.stack[0]

/**
 * Верхний инстанс, если это открытый тред (глубина стека > 1) — сам дескриптор
 * из стора, стабильный по ссылке между рендерами, пока стек не меняется.
 *
 * Единственный безопасный для подписки (`useChatStackStore(selectOpenThreadDesc)`)
 * вариант «открыт ли тред»: селектор, который строил бы НОВЫЙ объект на каждый
 * вызов (например, `{peerId, thread}`), давал бы бесконечный ре-рендер на любой
 * глубине стека > 1 — Zustand v5 сравнивает снимок подписки по ссылке
 * (`useSyncExternalStore`), и «новый» объект на каждом рендере читается как
 * изменившийся снимок (найдено на стенде: React error #185 «Maximum update
 * depth exceeded» при открытии темы форума — на глубине ≤ 1 такой селектор
 * стабильно отдаёт `undefined`, и баг был не виден). Возвращая сам дескриптор
 * из стора (ссылка меняется, только когда меняется стек), эта функция безопасна
 * и для подписки, и для разового чтения через `getState()`.
 */
export const selectOpenThreadDesc = (
  s: ChatStackState,
): (ChatInstanceDesc & { thread: ThreadInfo }) | undefined => {
  const top = selectActive(s)
  return s.stack.length > 1 && top?.thread ? (top as ChatInstanceDesc & { thread: ThreadInfo }) : undefined
}
