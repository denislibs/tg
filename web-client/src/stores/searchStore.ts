// src/stores/searchStore.ts
// In-chat search UI state, per chat. Порт того, что в tweb живёт на уровне `Chat`
// (chat.ts:763-766 + :1312 `initSearch`): четыре сигнала — `needSearch` и триада
// `query`/`filterPeerId`/`reaction`, которыми поиск ОТКРЫВАЮТ уже настроенным.
//
// Рабочее состояние панели (текст в поле, дебаунс, выбранная строка) остаётся в
// компоненте — как в tweb, где это локальные сигналы `topbarSearch.tsx:351-366`.
// Здесь только «затравка»: `topbarSearch.tsx:403-407` («* full search replacement»)
// эффектом засевает из неё своё состояние. Плюс то, что нужно ДРУГИМ узлам:
// пин-бар и sticky-дата смотрят на `open`, колонка чата вешает
// `.chat.is-search-active` по `reactionsShown` (tweb chat.ts:795 onActive).
import { create } from 'zustand'

/**
 * Затравка поиска — аргументы tweb `chat.initSearch({query, filterPeerId, reaction})`.
 *
 * `nonce` заменяет `{equals: false}`, с которым созданы сигналы в chat.ts:763-765:
 * там повторный `setQuery('x')` тем же значением ВСЁ РАВНО будит эффект-засев.
 * Без счётчика повторный «искать от этого же пира» не перезасеял бы панель.
 */
export interface SearchSeed {
  query: string
  filterPeerId?: number
  reaction?: string
  nonce: number
}

/** Опции открытия — 1:1 с сигнатурой tweb `Chat.initSearch` (chat.ts:1312). */
export interface InitSearchOptions {
  query?: string
  filterPeerId?: number
  reaction?: string
}

interface ChatSearch {
  open: boolean
  /** tweb topbarSearch shouldShowReactions() → chat.ts onActive → `.is-search-active` */
  reactionsShown: boolean
  seed: SearchSeed
}

// Кросс-чат ответ (tweb ReplyToAnotherChat): выбран целевой чат → ждём его
// открытия, Chat ставит reply-плашку с исходным чатом + снимком.
export interface PendingReply {
  targetPeerId: number
  sourcePeerId: number
  msgId: number
  name: string
  text: string
  color: string
}

// Пересылка (tweb initMessagesForward): выбран один целевой чат → ждём его
// открытия, Chat ставит плашку форварда в композере (превью +
// меню show/hide sender/caption). Финализация — по нажатию «Отправить».
export interface PendingForward {
  targetPeerId: number
  sourcePeerId: number
  msgIds: number[]
  /** число пересылаемых сообщений — для заголовка «Переслать N сообщений». */
  count: number
  /** превью-подпод плашки: «Отправитель: текст» или «Переслано из: имена». */
  text: string
  /** среди сообщений есть медиа с подписью → доступен пункт show/hide caption. */
  hasCaption: boolean
}

interface SearchState {
  byChat: Record<number, ChatSearch>
  /** результат сайдбар-поиска ждёт открытия чата → Chat прыгает к seq */
  pendingJump: { peerId: number; seq: number } | null
  /** «Ответить в другом чате» ждёт открытия целевого чата → ставится reply-плашка */
  pendingReply: PendingReply | null
  /** пересылка в один чат ждёт открытия целевого чата → ставится плашка форварда */
  pendingForward: PendingForward | null
  /**
   * Открыть поиск по чату, при желании — сразу настроенным (tweb `Chat.initSearch`).
   * Вызывается из лупы в шапке и из пункта «Поиск» в меню; точки входа с
   * параметрами (хэштег, «искать выделенное», «от этого пира», тег-реакция) —
   * см. backlogs/frontend/topbar-search-tweb-divergences.md.
   */
  initSearch: (peerId: number, options?: InitSearchOptions) => void
  /** Закрыть поиск (tweb `searchSignal(undefined)`, chat.ts:792). */
  closeSearch: (peerId: number) => void
  setReactionsShown: (peerId: number, shown: boolean) => void
  setPendingJump: (peerId: number, seq: number) => void
  clearPendingJump: () => void
  setPendingReply: (r: PendingReply) => void
  clearPendingReply: () => void
  setPendingForward: (f: PendingForward) => void
  clearPendingForward: () => void
}

const EMPTY_SEED: SearchSeed = { query: '', nonce: 0 }
const EMPTY: ChatSearch = { open: false, reactionsShown: false, seed: EMPTY_SEED }

export const useSearchStore = create<SearchState>((set) => ({
  byChat: {},
  pendingJump: null,
  pendingReply: null,
  pendingForward: null,
  initSearch: (peerId, options = {}) =>
    set((s) => {
      const prev = s.byChat[peerId] ?? EMPTY
      return {
        byChat: {
          ...s.byChat,
          [peerId]: {
            ...prev,
            open: true,
            // tweb chat.ts:822-825 — сигналы выставляются из `searchSignal()`
            // целиком, так что не переданные поля обнуляются, а не «залипают».
            seed: {
              query: options.query ?? '',
              filterPeerId: options.filterPeerId,
              reaction: options.reaction,
              nonce: prev.seed.nonce + 1,
            },
          },
        },
      }
    }),
  // Затравку тут НЕ трогаем: панель ещё доигрывает 200мс-анимацию ухода и читает
  // её (tweb снимает узел только по окончании, chat.ts:773). Обнулит её следующий
  // `initSearch` — как `searchSignal(undefined)` → `setQuery(s?.query)` в tweb.
  closeSearch: (peerId) =>
    set((s) => ({ byChat: { ...s.byChat, [peerId]: { ...(s.byChat[peerId] ?? EMPTY), open: false, reactionsShown: false } } })),
  setReactionsShown: (peerId, reactionsShown) =>
    set((s) => ({ byChat: { ...s.byChat, [peerId]: { ...(s.byChat[peerId] ?? EMPTY), reactionsShown } } })),
  setPendingJump: (peerId, seq) => set({ pendingJump: { peerId, seq } }),
  clearPendingJump: () => set({ pendingJump: null }),
  setPendingReply: (r) => set({ pendingReply: r }),
  clearPendingReply: () => set({ pendingReply: null }),
  setPendingForward: (f) => set({ pendingForward: f }),
  clearPendingForward: () => set({ pendingForward: null }),
}))
