// Порт tweb `src/components/sidebarRight/tabs/sharedMedia.tsx:28-45`, `:209-345`
// — КЭШ СПИСКОВ shared media и точечные живые апдейты над ним.
//
// Почему кэш живёт ЗДЕСЬ, а не в классе. У оригинала `historiesStorage` — это
// модульная переменная обвязки правой колонки (`sharedMedia.tsx:33-37`), и
// принадлежит она НЕ вкладке: она переживает и `cleanup()` класса, и смену
// пира, поэтому возврат в тот же профиль рисует вкладки без единого запроса
// (`appSearchSuper.ts:2245-2276`). Класс держит на неё только ссылку
// (`setQuery`) и помечает, сколько из неё уже отрисовал (`usedFromHistory`).
//
// Нашей прежней панели (`userInfo/SharedMedia.tsx:177-183`) именно этого и не
// хватало: любое изменение длины окна чата сносило кэш ВСЕХ фильтров, и
// открытая вкладка перезагружалась с нуля. Здесь этого нет по построению —
// апдейт добавляет один элемент в начало списка и один узел в начало вкладки.
//
// ─────────────────────────────────────────────────────────────────────────────
// ОБЪЯВЛЕННЫЕ РАСХОЖДЕНИЯ С ОРИГИНАЛОМ
//
//  1. Рядом со списком `{mid, peerId}` здесь лежат САМИ СООБЩЕНИЯ. У оригинала
//     их отдаёт `apiManagerProxy.getMessageByPeer` (`:2255`) — синхронное
//     зеркало ВСЕХ сообщений на главном потоке. У нас такого зеркала нет:
//     `core/history/messagesMirror.ts` держит только окна открытых чатов, а
//     шаред-медиа — это старые сообщения вне окна. Хранилище сообщений — наш
//     аналог того зеркала, ограниченный подсистемой; форма списка при этом
//     остаётся оригинальной (`{mid, peerId}`), чтобы `usedFromHistory` и
//     `unshift` работали дословно.
//  2. `_deleteDeletedMessages` в оригинале (`:283-286`) пишет
//     `if(idx === -1) history.splice(idx, 1)` — при ОТСУТСТВИИ элемента режет
//     последний (`splice(-1, 1)`). Это опечатка оригинала, а не поведение:
//     соседний блок в той же функции удаляет найденный узел. Портируем намерение
//     (`idx !== -1`) — иначе удаление чужого сообщения выбрасывало бы из кэша
//     хвост чужой вкладки.
//  3. Треды: у оригинала `threadId` вычисляется из самого сообщения
//     (`getMessageThreadId`, `:257`), у нас — приходит ключом окна зеркала
//     (`winKey`: "peerId" | "peerId:threadRoot"), потому что именно им
//     объявляются события `history_append`. Ответ на вопрос «какому списку
//     принадлежит сообщение» тот же, источник ответа другой.
import type AppSearchSuper from '@components/appSearchSuper'
import type { SearchSuperMediaTab, SearchSuperType } from '@components/appSearchSuper'
import type { MyMessage } from '@core/models'
import rootScope from '@lib/rootScope'
import type ListenerSetter from '@helpers/listenerSetter'

/** tweb `:29-31`. */
export type SharedMediaHistoryStorage = Partial<Record<SearchSuperType, { mid: number, peerId: PeerId }[]>>

/** tweb `:33-37` — «пир → тред → фильтр». Модульная, переживает смену пира. */
const historiesStorage: Map<PeerId, Map<number, SharedMediaHistoryStorage>> = new Map()

/** Расхождение 1 в шапке: «пир → номер → сообщение». */
const messagesStorage: Map<PeerId, Map<number, MyMessage>> = new Map()

/** Тред отсутствует — это ключ `0` (у оригинала — `undefined` в объекте). */
const threadKey = (threadId?: number) => threadId ?? 0

/** tweb `:43-45`. */
export function getHistoryStorage(peerId: PeerId, threadId?: number): SharedMediaHistoryStorage {
  let byThread = historiesStorage.get(peerId)
  if(!byThread) {
    historiesStorage.set(peerId, byThread = new Map())
  }

  let storage = byThread.get(threadKey(threadId))
  if(!storage) {
    byThread.set(threadKey(threadId), storage = {})
  }

  return storage
}

/** Положить сообщения туда, откуда их синхронно берёт рендер из кэша. */
export function saveSharedMediaMessages(messages: readonly MyMessage[]) {
  for(const message of messages) {
    let byMid = messagesStorage.get(message.peerId)
    if(!byMid) {
      messagesStorage.set(message.peerId, byMid = new Map())
    }

    byMid.set(message.id, message)
  }
}

/** Наш `apiManagerProxy.getMessageByPeer` (`tweb:2255`) — см. расхождение 1. */
export function getSharedMediaMessage(peerId: PeerId, mid: number): MyMessage | undefined {
  return messagesStorage.get(peerId)?.get(mid)
}

/** Только для тестов: хранилище модульное, между прогонами его надо обнулять. */
export function resetSharedMediaHistories() {
  historiesStorage.clear()
  messagesStorage.clear()
}

/**
 * tweb `:209-252`. Новое сообщение попадает в СПИСОК того фильтра, которому
 * подходит, и — если этот пир сейчас открыт и вкладка уже что-то показывала —
 * ОДНИМ узлом в начало вкладки. Загруженные страницы при этом не трогаются.
 */
export function renderNewMessage(
  searchSuper: AppSearchSuper,
  message: MyMessage,
  peerId: PeerId = message.peerId,
  threadId?: number,
) {
  const historyStorage = historiesStorage.get(peerId)?.get(threadKey(threadId))
  if(!historyStorage) {
    return
  }

  for(const mediaTab of searchSuper.mediaTabs) {
    const inputFilter = mediaTab.inputFilter
    const history = inputFilter && historyStorage[inputFilter]
    if(!history || !inputFilter) {
      continue
    }

    const filtered = searchSuper.filterMessagesByType([message], inputFilter)
    if(!filtered.length) {
      continue
    }

    const toInsert = filtered
      .filter((m) => !history.find((h) => h.mid === m.id && h.peerId === m.peerId))
      .map((m) => ({ mid: m.id, peerId: m.peerId }))
    history.unshift(...toInsert)
    saveSharedMediaMessages(filtered)

    // tweb `:241-250`: рисуем только если открыт ТОТ ЖЕ пир и тред, и вкладка
    // уже что-то показывала (`usedFromHistory !== -1`) — иначе её нарисует
    // ближайшая загрузка, и узел удвоился бы.
    if(
      searchSuper.searchContext?.peerId === peerId &&
      searchSuper.usedFromHistory[inputFilter] !== -1 &&
      searchSuper.searchContext?.threadId === threadId
    ) {
      searchSuper.usedFromHistory[inputFilter]! += filtered.length
      void searchSuper.performSearchResult({ messages: filtered, mediaTab, append: false }).then((length) => {
        searchSuper.setCounter(mediaTab.type, (searchSuper.counters[mediaTab.type] ?? 0) + length)
      })
    }
  }
}

/** tweb `:265-336`. */
function _deleteDeletedMessages(
  searchSuper: AppSearchSuper,
  historyStorage: SharedMediaHistoryStorage,
  peerId: PeerId,
  mids: number[],
  threadId?: number,
) {
  const notFound: Set<SearchSuperMediaTab> = new Set()
  for(const mid of mids) {
    for(const mediaTab of searchSuper.mediaTabs) {
      const inputFilter = mediaTab.inputFilter
      const history = inputFilter && historyStorage[inputFilter]
      if(!history || !inputFilter) {
        continue
      }

      const isGood = searchSuper.searchContext?.peerId === peerId &&
        searchSuper.searchContext?.threadId === threadId

      const idx = history.findIndex((m) => m.mid === mid)
      // Расхождение 2 в шапке: у оригинала здесь `idx === -1`.
      if(idx !== -1) {
        history.splice(idx, 1)
      }

      if(!isGood) {
        continue
      }

      const container = searchSuper.tabs[inputFilter]
      const div = container?.querySelector<HTMLElement>(`[data-mid="${mid}"][data-peer-id="${peerId}"]`)
      if(!div) {
        notFound.add(mediaTab)
        continue
      }

      const divs = container!.querySelectorAll<HTMLElement>('[data-mid][data-peer-id]')
      const domIdx = Array.from(divs).indexOf(div)
      div.remove()

      // Отрисованных стало меньше — иначе следующая порция из кэша пропустила
      // бы один элемент (`tweb:300-302`).
      if(domIdx !== -1 && (searchSuper.usedFromHistory[inputFilter] ?? 0) >= (domIdx + 1)) {
        --searchSuper.usedFromHistory[inputFilter]!
      }

      searchSuper.setCounter(mediaTab.type, (searchSuper.counters[mediaTab.type] ?? 0) - 1)
    }
  }

  // tweb `:318-335` — узла не было (страница ещё не долистана), поэтому счётчик
  // не вывести арифметикой: спрашиваем его у сервера батчем.
  const filters = Array.from(notFound)
    .map((mediaTab) => mediaTab.inputFilter)
    .filter((inputFilter): inputFilter is SearchSuperType => !!inputFilter)
  if(!filters.length) {
    return
  }

  const middleware = searchSuper.middleware.get()
  void searchSuper.getSearchCounters(filters).then((counters) => {
    if(!middleware()) {
      return
    }

    notFound.forEach((mediaTab) => {
      const counter = counters.find((c) => c.inputFilter === mediaTab.inputFilter)
      if(counter) {
        searchSuper.setCounter(mediaTab.type, counter.count)
      }
    })
  })
}

/** tweb `:338-348`. */
export function deleteDeletedMessages(searchSuper: AppSearchSuper, peerId: PeerId, mids: number[]) {
  const byThread = historiesStorage.get(peerId)
  if(!byThread) {
    return
  }

  const byMid = messagesStorage.get(peerId)
  for(const mid of mids) {
    byMid?.delete(mid)
  }

  for(const [thread, storage] of byThread) {
    _deleteDeletedMessages(searchSuper, storage, peerId, mids, thread || undefined)
  }

  searchSuper.scrollable.onScroll()
}

/**
 * tweb `:596-602` — подписка обвязки правой колонки. У оригинала событие
 * `history_multiappend` несёт само сообщение, у нас `history_append` несёт его
 * вместе с ключом окна (`winKey`), из которого и берутся пир и тред
 * (расхождение 3 в шапке).
 */
export function subscribeSharedMediaLiveUpdates(searchSuper: AppSearchSuper, listenerSetter: ListenerSetter) {
  listenerSetter.add(rootScope)('history_append', ({ storageKey, message }) => {
    const [peerId, threadRoot] = storageKey.split(':')
    renderNewMessage(searchSuper, message, +peerId, threadRoot ? +threadRoot : undefined)
  })

  listenerSetter.add(rootScope)('history_delete', ({ peerId, msgs }) => {
    deleteDeletedMessages(searchSuper, peerId, [...msgs])
  })
}
