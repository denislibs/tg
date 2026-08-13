// Источник данных виртуального списка чатов одной папки — порт потребителя
// курсора из tweb `components/autonomousDialogList/base.ts` (`cursorFetcher`,
// `requestItemForIdx`, `loadDialogsInner`) и глушилки анимации первой загрузки
// (`autonomousDialogList/dialogs.ts:248-261` +
// `deferredSortedVirtualList.tsx:241-253`).
//
// СВОЕГО СПИСКА ЗДЕСЬ НЕТ. В tweb список ВЛАДЕЕТ элементами (`sortedList`), у
// нас владелец — воркерный `dialogsManager`, а `chatsStore` — зеркало: `items`
// это производная от зеркала, а не второй набор данных. Хук только (1) просит у
// владельца следующую страницу и (2) отдаёт витрине размер набора/признак
// конца/флаг анимации. Писать в зеркало он не имеет права
// (`stores/noDuplicateDialogs.test.ts`), сортировать — тоже
// (`stores/noManualOrder.test.ts`): порядок уже пришёл из воркера.
import { useCallback, useMemo, useState } from 'react'
import { SequentialCursorFetcher, type SequentialCursorFetcherResult } from '@helpers/sequentialCursorFetcher'
import { useManagers } from './useManagers'
import { useEvent } from './useEvent'
import { useMiddlewareHelper } from './useMiddlewareHelper'
import { useChatsStore } from '../../stores/chatsStore'
import { useFolders, useFoldersStore } from '../../stores/foldersStore'
import { useNotifyStore, isDialogMuted } from '../../stores/notifyStore'
import { guessLoadCount } from '../dialogs/loadCount'
import { ALL_FOLDER_ID, ARCHIVE_FOLDER_ID } from '../folderIds'
import { dialogMatchesFolder } from '../folderFilter'
import type { Folder } from '../managers/foldersManager'
import type { Dialog } from '../models'
import type { Chat } from '../../data'

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

/**
 * @param filterId «Все чаты»/«Архив»/id пользовательской папки
 * @param chats витрина зеркала (`useChatList()`) — берётся ПРОПОМ, а не своим
 *   вызовом хука: на каждую папку монтируется свой список, и N собственных
 *   `useChatList` дали бы N ref-кэшей с `JSON.stringify` по всему массиву
 *   диалогов на каждую операцию (сам `useChatList` предупреждает, что
 *   стабильность ссылок критична для FPS).
 */
export function useDialogListSource(filterId: number, chats: Chat[]): DialogListSource {
  const managers = useManagers()
  const dialogs = useChatsStore((s) => s.dialogs)
  const dialogIndexById = useChatsStore((s) => s.dialogIndexById)
  const notifySettings = useNotifyStore((s) => s.settings)
  const folders = useFolders()
  const contactIds = useFoldersStore((s) => s.contactIds)
  const helper = useMiddlewareHelper()

  const [pageState, setPageState] = useState<PageState>({ filterId, ...EMPTY_PAGE_STATE })
  const [blockedAnimationCount, setBlockedAnimationCount] = useState(0)
  // Смена папки на живом хуке — это новый список (в tweb на папку свой
  // AutonomousDialogList со своим курсором): размер набора, признак конца и
  // «загружались хоть раз» прошлой папки не наследуются, иначе новая получила
  // бы чужую высоту списка и подавленный скелетон.
  const page = pageState.filterId === filterId ? pageState : { filterId, ...EMPTY_PAGE_STATE }

  // Развилка папок — та же, что у владельца (`dialogsManager.ts::forFilter`):
  // ALL — всё, кроме архива; ARCHIVE — только архив; пользовательская папка —
  // не архив + правила фильтра. Определения папки ещё нет — папка пуста, а не
  // «показать всё» (там же, `forFilter` возвращает null).
  const folder: Folder | undefined = filterId === ALL_FOLDER_ID || filterId === ARCHIVE_FOLDER_ID
    ? undefined
    : folders.find((f) => f.id === filterId)
  const folderKnown = filterId === ALL_FOLDER_ID || filterId === ARCHIVE_FOLDER_ID || !!folder

  /**
   * ЕДИНСТВЕННОЕ правило принадлежности строки этой папке — и для `items`, и
   * для размера набора (`countInMirror`). Считается по `Dialog`, а не по `Chat`:
   * размер нужен вне рендера, где витринных `Chat` попросту нет, — а два разных
   * адаптера расходились бы ровно на `muted`: витрина (`useChatList`) считает
   * заглушённым и чат глобально выключенного ТИПА, а у `Dialog.muted` этого нет.
   * В папке с `excludeMuted` фетчер тогда считал бы набранным то, чего в списке
   * нет: цикл догрузки обрывается, папка не наполняется никогда. Само правило
   * живёт в одном месте на всё приложение — `stores/notifyStore.ts::isDialogMuted`
   * (пин `stores/noDuplicateMuteRule.test.ts`).
   */
  const matchesThisFolder = useCallback((d: Dialog): boolean => {
    if (!folderKnown) return false
    if (filterId === ARCHIVE_FOLDER_ID ? !d.archived : !!d.archived) return false
    if (!folder) return true
    return dialogMatchesFolder({ ...d, muted: isDialogMuted(d, notifySettings) }, folder, contactIds)
  }, [folderKnown, folder, filterId, contactIds, notifySettings])

  const items = useMemo<DialogListItem[]>(() => {
    const chatById = new Map<number, Chat>()
    for (const chat of chats) chatById.set(Number(chat.id), chat)
    const out: DialogListItem[] = []
    for (const d of dialogs) {
      if (!matchesThisFolder(d)) continue
      const value = chatById.get(d.chatId)
      // Контракт `chats` — ПОЛНАЯ витрина зеркала (`useChatList` маппит каждый
      // диалог), поэтому в норме ветка недостижима. Держим её не как защиту от
      // краша рендера (строка без витринного значения), а как единственную
      // честную реакцию: если она когда-нибудь сработает, набор папки станет
      // БОЛЬШЕ списка (`countInMirror` считает по зеркалу, а не по `chats`), и
      // догрузка встанет ровно так же, как вставала на разъехавшемся `muted`.
      if (!value) continue
      out.push({ id: d.chatId, index: dialogIndexById[d.chatId] ?? 0, value })
    }
    return out
  }, [chats, dialogs, dialogIndexById, matchesThisFolder])

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
    let n = 0
    for (const d of useChatsStore.getState().dialogs) if (matchesThisFolder(d)) ++n
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
      // Хук размонтирован либо папку успели переключить: писать в состояние
      // нечего, а двигать курсор чужого (уже нового) цикла — тем более.
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
      //
      // Легитимную догрузку это глушит МЯГКО: обрывается только текущий цикл,
      // следующий `requestItemForIdx` (скролл, новый видимый индекс) начнёт с
      // того же курсора заново. Само окно почти недостижимо: `startRealtime()`
      // поднимает насос до того, как долетит ответ RPC, а кадр `rt:dialog_op`
      // уходит из воркера раньше ответа и по тому же порту.
      if (cursor === (offsetIndex ?? Infinity)) return { cursor: offsetIndex, count: 0 }

      // `totalCount` — размер НАБОРА в зеркале, а не длина страницы (порт
      // base.ts:297, `sortedList.itemsLength()`). Страницы перекрываются
      // (владелец режет свой кэш по курсору-значению), поэтому `+= count`
      // фетчера считал бы уже известные строки заново и обрывал цикл, не
      // добрав до нужного индекса, — в списке остались бы пустые строки.
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
    // закреплённых не учитывает. Такой вызов не просит ни одной строки, поэтому
    // и фетчеру сообщать нечего: `fetchUntil(idx + 1, itemsLength)` новую
    // страницу не запустит (`neededCount` неположительный), но `itemsLength`
    // всё равно перепишет — а у нас, в отличие от tweb, «уже набрано» приходит
    // не только отсюда, но и из ответа владельца (`totalCount` выше), так что
    // молча смешивать эти два источника на вызове, который ничего не просит,
    // незачем.
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
