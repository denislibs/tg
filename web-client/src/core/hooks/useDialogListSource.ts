// Источник данных виртуального списка чатов одной папки — порт потребителя
// курсора из tweb `components/autonomousDialogList/base.ts` (`cursorFetcher`,
// `requestItemForIdx`, `guessLoadCount`, `loadDialogsInner`) и глушилки
// анимации первой загрузки (`autonomousDialogList/dialogs.ts:248-261` +
// `deferredSortedVirtualList.tsx:241-253`).
//
// СВОЕГО СПИСКА ЗДЕСЬ НЕТ. В tweb список ВЛАДЕЕТ элементами (`sortedList`), у
// нас владелец — воркерный `dialogsManager`, а `chatsStore` — зеркало: `items`
// это производная от зеркала (`useChatList()` + фильтр папки), а не второй
// набор данных. Хук только (1) просит у владельца следующую страницу и (2)
// отдаёт витрине размер набора/признак конца/флаг анимации. Писать в зеркало
// он не имеет права (`stores/noDuplicateDialogs.test.ts`), сортировать —
// тоже (`stores/noManualOrder.test.ts`): порядок уже пришёл из воркера.
import { useMemo, useState } from 'react'
import { SequentialCursorFetcher, type SequentialCursorFetcherResult } from '@helpers/sequentialCursorFetcher'
import { useManagers } from './useManagers'
import { useChatList } from './useChatList'
import { useEvent } from './useEvent'
import { useMiddlewareHelper } from './useMiddlewareHelper'
import { useChatsStore } from '../../stores/chatsStore'
import { useFolders, useFoldersStore } from '../../stores/foldersStore'
import { ALL_FOLDER_ID, ARCHIVE_FOLDER_ID } from '../folderIds'
import { chatMatchesFolder, dialogMatchesFolder } from '../folderFilter'
import type { Folder } from '../managers/foldersManager'
import type { Chat } from '../../data'

/** Размер страницы — константа tweb `autonomousDialogList/base.ts:23`. */
export const DIALOG_LOAD_COUNT = 20

/**
 * Порт tweb `base.ts:216-219` (формула дословно, `windowSize.height` у нас —
 * `window.innerHeight`): «чтобы скролл был даже на очень большом экране».
 */
export function guessLoadCount(): number {
  return Math.max(window.innerHeight / 64 * 1.25 | 0, DIALOG_LOAD_COUNT)
}

/** Строка списка: `index` — готовый индекс порядка из зеркала (его считает владелец). */
export type DialogListItem = { id: number; index: number; value: Chat }

export type DialogListSource = {
  /** Диалоги папки в порядке зеркала (не пересортированы). */
  items: DialogListItem[]
  /** Сколько всего в папке — `count` последнего ответа `getDialogs`. */
  totalCount: number
  isEnd: boolean
  wasAtLeastOnceFetched: boolean
  /** `blockedAnimationCount === 0` (deferredSortedVirtualList.tsx:270). */
  animate: boolean
  /** Порт `base.ts:63-65`; `itemsLength` опционален — как в оригинале. */
  requestItemForIdx: (idx: number, itemsLength?: number) => void
}

type PageState = { filterId: number; totalCount: number; isEnd: boolean; wasAtLeastOnceFetched: boolean }

const EMPTY_PAGE_STATE = { totalCount: 0, isEnd: false, wasAtLeastOnceFetched: false } as const

const noop = () => {}

export function useDialogListSource(filterId: number): DialogListSource {
  const managers = useManagers()
  const chats = useChatList()
  const folders = useFolders()
  const contactIds = useFoldersStore((s) => s.contactIds)
  const dialogIndexById = useChatsStore((s) => s.dialogIndexById)
  const helper = useMiddlewareHelper()

  const [pageState, setPageState] = useState<PageState>({ filterId, ...EMPTY_PAGE_STATE })
  const [blockedAnimationCount, setBlockedAnimationCount] = useState(0)
  // Смена папки на живом хуке — это новый список (в tweb на папку свой
  // AutonomousDialogList со своим курсором): счётчики прошлой папки не
  // наследуются. Не сбросом состояния в рендере, а выводом: ответ прошлой
  // папки, долетевший позже, отсекается по `filterId` в setPageState.
  const page = pageState.filterId === filterId ? pageState : { filterId, ...EMPTY_PAGE_STATE }

  // Развилка папок — та же, что у владельца (`dialogsManager.ts::forFilter`):
  // ALL — всё, кроме архива; ARCHIVE — только архив; пользовательская папка —
  // не архив + правила фильтра. Определения папки ещё нет — папка пуста, а не
  // «показать всё» (там же, `forFilter` возвращает null).
  const folder: Folder | undefined = filterId === ALL_FOLDER_ID || filterId === ARCHIVE_FOLDER_ID
    ? undefined
    : folders.find((f) => f.id === filterId)
  const folderKnown = filterId === ALL_FOLDER_ID || filterId === ARCHIVE_FOLDER_ID || !!folder

  const items = useMemo<DialogListItem[]>(() => {
    if (!folderKnown) return []
    const out: DialogListItem[] = []
    for (const chat of chats) {
      const id = Number(chat.id)
      if (!Number.isFinite(id)) continue
      if (filterId === ARCHIVE_FOLDER_ID ? !chat.archived : !!chat.archived) continue
      if (folder && !chatMatchesFolder(chat, folder, contactIds)) continue
      out.push({ id, index: dialogIndexById[id] ?? 0, value: chat })
    }
    return out
  }, [chats, dialogIndexById, filterId, folder, folderKnown, contactIds])

  /** Папка, выбранная ПРЯМО СЕЙЧАС (а не в момент запуска запроса) — ею
   *  отсекается ответ, доехавший уже после переключения папки. */
  const currentFilterId = useEvent((): number => filterId)

  /**
   * Сколько строк у списка ПРЯМО СЕЙЧАС — аналог `sortedList.itemsLength()`
   * (base.ts:297). Считаем по зеркалу из стора, а не по `items` из замыкания:
   * страница уже применена проектором к моменту ответа RPC (кадр `rt:dialog_op`
   * уходит из воркера РАНЬШЕ ответа и по тому же порту — порядок сообщений
   * MessagePort сохраняется), а вот React-рендер с новыми `items` — ещё нет.
   */
  const countInMirror = useEvent((): number => {
    if (!folderKnown) return 0
    let n = 0
    for (const d of useChatsStore.getState().dialogs) {
      if (filterId === ARCHIVE_FOLDER_ID ? !d.archived : !!d.archived) continue
      if (folder && !dialogMatchesFolder(d, folder, contactIds)) continue
      ++n
    }
    return n
  })

  /**
   * Глушилка анимации — порт `deferredSortedVirtualList.tsx:241-253`: СЧЁТЧИК,
   * а не булев флаг. Первых загрузок бывает несколько внахлёст (папку
   * переключили, пока страница прошлой ещё летит), и флаг отпустил бы анимацию
   * на первом же ответе — до того, как список действительно наполнился.
   *
   * `Set` токенов оригинала (защита от повторного вызова `unblock`) не нужен:
   * `unblock` наружу не отдаётся и зовётся ровно один раз — в `finally`
   * собственного `fetchPage`.
   */
  const blockAnimation = useEvent((): VoidFunction => {
    setBlockedAnimationCount((prev) => prev + 1)
    return () => setBlockedAnimationCount((prev) => Math.max(0, prev - 1))
  })

  /**
   * Одна страница — порт `base.ts:247-299` (`loadDialogsInner`) + обёртка
   * первой загрузки из `dialogs.ts:248-256`. Отступления от оригинала:
   *
   * 1. `shouldRefetch` через 0.5 с (`base.ts:255-272`) не портируем: он лечит
   *    `count: null` первого ответа MTProto, а наш владелец отдаёт `count`
   *    всегда (`dialogsManager.ts::countFor`).
   * 2. Курсор берётся из зеркала (`dialogIndexById`), а не считается здесь:
   *    `dialogIndex()` на main звать нельзя (`stores/noManualOrder.test.ts`).
   */
  const fetchPage = useEvent(async (forFilterId: number, offsetIndex: number | undefined): Promise<SequentialCursorFetcherResult<number | undefined>> => {
    const middleware = helper.get()
    // `isFirstLoad = !offsetIndex` — дословно dialogs.ts:249.
    const unblock = offsetIndex ? noop : blockAnimation()
    try {
      const result = await managers.dialogs.getDialogs({ offsetIndex, limit: guessLoadCount(), filterId: forFilterId })
      // Хук размонтирован либо папку успели переключить — писать нечего.
      if (!middleware() || currentFilterId() !== forFilterId) return { cursor: offsetIndex, count: 0 }

      // Порт base.ts:274-277: курсор — МИНИМАЛЬНЫЙ индекс отданной страницы.
      const indexById = useChatsStore.getState().dialogIndexById
      const cursor = result.dialogs.reduce<number>((prev, d) => {
        const index = indexById[d.chatId]
        return index !== undefined && index < prev ? index : prev
      }, offsetIndex ?? Infinity)

      setPageState({ filterId: forFilterId, totalCount: result.count, isEnd: result.isEnd, wasAtLeastOnceFetched: true })

      // Курсор не сдвинулся (пустая страница либо зеркало ещё не знает индексов
      // приехавших диалогов) — следующий запрос ушёл бы с ТЕМ ЖЕ `offsetIndex`
      // и вернул ту же страницу: у владельца сетевой курсор свой (`chatId`
      // хвоста кэша, `dialogsManager.ts::fetchPage`), поэтому цикл фетчера
      // крутился бы вечно. `count: 0` — единственный выход из него
      // (sequentialCursorFetcher.ts: `if(count === 0) break`).
      if (cursor === (offsetIndex ?? Infinity)) return { cursor: offsetIndex, count: 0 }

      return { cursor, count: result.dialogs.length, totalCount: countInMirror() }
    } finally {
      unblock()
    }
  })

  // Свой фетчер на папку: у курсора нет общего смысла между папками, поэтому
  // папка фиксируется в замыкании при создании, а не читается на каждый запрос.
  const fetcher = useMemo(
    () => new SequentialCursorFetcher<number | undefined>((cursor) => fetchPage(filterId, cursor)),
    [fetchPage, filterId],
  )

  const requestItemForIdx = useEvent((idx: number, itemsLength?: number) => {
    // ОТРИЦАТЕЛЬНЫЙ индекс — штатная ситуация оригинала: список зовёт
    // `requestItemForIdx(idx - pinnedItems.length, …)`
    // (deferredSortedVirtualList.tsx:289), а `revealIdx` после первой отдачи
    // закреплённых не учитывает. Такой вызов не просит НИЧЕГО, поэтому и
    // сообщать фетчеру ему нечего: `fetchUntil(idx + 1, itemsLength)` с
    // неположительным `neededCount` новую страницу не запустит, но
    // `fetchedItemsCount` перепишет — и уже идущий цикл догрузки решит, что
    // нужное количество набрано, и оборвётся на середине.
    if (idx < 0) return
    fetcher.fetchUntil(idx + 1, itemsLength)
  })

  return {
    items,
    totalCount: page.totalCount,
    isEnd: page.isEnd,
    wasAtLeastOnceFetched: page.wasAtLeastOnceFetched,
    animate: blockedAnimationCount === 0,
    requestItemForIdx,
  }
}
