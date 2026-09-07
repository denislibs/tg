// Догрузка СОСЕДЕЙ ЛИСТАНИЯ медиавьювера — наш заменитель tweb
// `SearchListLoader` (`components/searchListLoader.ts`): вьювер открылся с
// одного медиа, а листать надо всю ленту фильтра `media`, и её страницы
// приходят с ручки `/chats/{id}/media`.
//
// Почему отдельный модуль, а не замыкание внутри `Chat.tsx`: предмет здесь —
// СОДЕРЖИМОЕ списка листания (дубли/дыры/край), и проверять его надо
// поведением, а `Chat.tsx` в vitest не рендерится вовсе (см. шапку
// `Chat.feedMount.test.ts`).
//
// Листаем КУРСОРОМ (`offsetId` = номер последнего уже загруженного), как
// оригинал: `appSearchSuper.ts:2278-2279`. Смещением листать нельзя — список
// пополняется сверху живыми апдейтами, и окно уезжает (подробности — в докблоке
// `messagesManager.mediaHistory`).
import type { MyMessage } from '@core/models'

export type MediaNeighboursLoader = {
  /** уже загруженные сообщения фильтра, newest-first */
  readonly cached: readonly MyMessage[]
  /**
   * Соседи якоря: `older` — вниз по истории (следующие во вьювере), иначе
   * вверх. Докручивает страницы, пока не найдёт якорь и не наберёт `loadCount`
   * за ним; порядок newest-first сохраняется — раскладывает его `ListLoader`.
   */
  neighbours(anchorMid: number, older: boolean, loadCount: number): Promise<MyMessage[]>
}

export function createMediaNeighboursLoader({ fetchPage, pageSize = 50 }: {
  fetchPage: (offsetId: number, limit: number) => Promise<MyMessage[]>
  pageSize?: number
}): MediaNeighboursLoader {
  const msgs: MyMessage[] = []
  let complete = false

  const fetchNext = async () => {
    const last = msgs[msgs.length - 1]
    const page = await fetchPage(last?.id ?? 0, pageSize)
    msgs.push(...page)
    // Критерий конца — тот же, что у оригинала (`tweb:2311`): страница короче
    // запрошенной значит, что ниже ничего нет. Сравнивать накопленное с общим
    // числом нельзя: общее число живёт своей жизнью (новые сообщения, удаления).
    if (page.length < pageSize) complete = true
  }

  return {
    get cached() {
      return msgs
    },
    async neighbours(anchorMid, older, loadCount) {
      const idxOf = () => msgs.findIndex((m) => m.id === anchorMid)
      while (idxOf() === -1 && !complete) await fetchNext()
      const i = idxOf()
      // якоря нет в фильтре media (секретный чат) — для листания это край
      if (i === -1) return []
      if (older) {
        while (msgs.length - i - 1 < loadCount && !complete) await fetchNext()
      }
      return older
        ? msgs.slice(i + 1, i + 1 + loadCount)
        : msgs.slice(Math.max(0, i - loadCount), i)
    },
  }
}
