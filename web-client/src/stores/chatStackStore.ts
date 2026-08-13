import { create } from 'zustand'
import type { ThreadInfo } from '../components/Chat'

// Стек инстансов колонки чата — порт `appImManager.chats[]` (tweb
// lib/appImManager.ts:218). Открытие треда не подменяет содержимое текущего
// чата, а кладёт сверху новый инстанс; возврат снимает верхний и отдаёт
// нижнему его состояние. Верхний элемент — активный (инвариант).

/** Значения совпадают с `data-type` живого DOM tweb (`chat`, `discussion`). */
export type ChatType = 'chat' | 'discussion' | 'saved' | 'pinned' | 'search'

export interface ChatInstanceDesc {
  /** `${peerId}_${threadId ?? 0}_${type}` — он же ключ React-узла */
  key: string
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

export function descKey(o: { peerId: number; threadId?: number; type: ChatType }): string {
  return `${o.peerId}_${o.threadId ?? 0}_${o.type}`
}

function makeDesc(o: OpenChatOptions): ChatInstanceDesc {
  return {
    key: descKey(o),
    peerId: o.peerId,
    threadId: o.threadId,
    type: o.type,
    query: o.query,
    thread: o.thread,
  }
}

interface ChatStackState {
  stack: ChatInstanceDesc[]
  /** tweb setPeer: уход к другому пиру схлопывает стек до одного инстанса */
  setPeer: (o: OpenChatOptions) => void
  /** tweb setInnerPeer: положить сверху; тот же пир в стеке — срезать всё выше */
  setInnerPeer: (o: OpenChatOptions) => void
  popTo: (index: number) => void
  /** tweb spliceChats(chatIndex) при пустом peerId — снять верхний */
  closeTop: () => void
  clear: () => void
}

export const useChatStackStore = create<ChatStackState>((set) => ({
  stack: [],
  setPeer: (o) => set({ stack: [makeDesc(o)] }),
  setInnerPeer: (o) =>
    set((s) => {
      const desc = makeDesc(o)
      const i = s.stack.findIndex((d) => d.key === desc.key)
      return { stack: i === -1 ? [...s.stack, desc] : s.stack.slice(0, i + 1) }
    }),
  popTo: (index) => set((s) => ({ stack: index < 0 ? [] : s.stack.slice(0, index + 1) })),
  closeTop: () => set((s) => (s.stack.length > 1 ? { stack: s.stack.slice(0, -1) } : s)),
  clear: () => set({ stack: [] }),
}))

/** Активный инстанс — верхний (инвариант стека). */
export const selectActive = (s: ChatStackState): ChatInstanceDesc | undefined => s.stack[s.stack.length - 1]

/** Подсветку в списке чатов определяет ДНО стека: в tweb чат из списка — chats[0],
 *  а тред лежит поверх него и подсветку не меняет. */
export const selectRoot = (s: ChatStackState): ChatInstanceDesc | undefined => s.stack[0]

/** Совместимость с потребителями `navigationStore.openThread` на время этапа 1. */
export const selectOpenThread = (s: ChatStackState): { chatId: number; thread: ThreadInfo } | null => {
  const top = selectActive(s)
  return s.stack.length > 1 && top?.thread ? { chatId: top.peerId, thread: top.thread } : null
}
