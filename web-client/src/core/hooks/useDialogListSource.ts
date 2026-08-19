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
import { useCallback, useMemo, useRef, useState } from 'react'
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

/**
 * Строка списка — форма `DeferredSortedVirtualListItem` ядра
 * (`components/virtual/DeferredSortedVirtualList.tsx:51`).
 *
 * Поля `index` (индекс порядка) здесь НЕТ, хотя в tweb у элемента оно есть
 * (`deferredSortedVirtualList.tsx:34-38`): там его читает `sortedItems`, который
 * мы не портируем (ядро уже отказалось от поля по той же причине). Класть сюда
 * копию `chatsStore.dialogIndexById` только ради полноты — заводить второй
 * источник порядка на витрине и, хуже того, обязать обёртку пересоздаваться на
 * каждый `reindex` владельца (а он приходит на любую правку `pinnedOrders`/
 * `drafts`, со ЗНАЧЕНИЯМИ диалогов неизменными) — то есть ровно ломать
 * стабильность ссылок, ради которой обёртка и кэшируется. Курсору догрузки
 * индексы нужны — он берёт их у зеркала напрямую (`fetchPage`).
 */
export type DialogListItem = { id: PeerId; value: Chat }

/** `archiveDialog.tsx:27` — страница архива, которой живёт строка «Архив»
 *  (там же её лимит показа имён, см. `ArchiveRow.LIMIT`). */
const ARCHIVE_ROW_LIMIT = 10

export type DialogListSource = {
  /**
   * Диалоги папки в порядке зеркала (не пересортированы).
   *
   * Требования к ссылкам — контракт пропа `items` ядра
   * (`DeferredSortedVirtualList.tsx:64-80`), оба выполняются кэшем ниже:
   * 1. ссылка на САМ массив меняется только при реальном изменении состава или
   *    порядка — по её смене `useShouldAnimate` решает, анимировать ли переезд;
   * 2. обёртка живёт, пока живёт строка, и приезжает НОВОЙ, когда изменилось её
   *    содержимое (строка обёрнута в `memo` и сравнивает `item` по ссылке).
   */
  items: readonly DialogListItem[]
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

  /**
   * Обёртки строк, живущие между пересчётами, — ключ по `peerId`. Тот же приём
   * и та же мотивация, что у ref-кэша в `useChatList`, только требование
   * жёстче: `useShouldAnimate` сравнивает элементы старого и нового списка ПО
   * ССЫЛКЕ (`prev.indexOf(item)`, порт `verticalVirtualList.tsx:143-172`), и
   * пересоздание обёрток на каждом пересчёте делало бы пересечение «видимые до»
   * и «видимые сейчас» ВСЕГДА пустым: `shouldAnimate` навсегда `true`,
   * компенсация равномерного сдвига (`onScrollShift`) не зовётся никогда, и при
   * появлении чата над видимой областью дёргается весь экран вместо одной
   * строки. В tweb стабильность этой ссылки — тоже часть контракта, там она
   * держится намеренной мутацией вместо спреда
   * (`deferredSortedVirtualList.tsx:141-147` и комментарий у `:144`).
   *
   * Обёртка пересоздаётся РОВНО когда изменилось витринное значение строки —
   * второе требование контракта `items` ядра: строка обёрнута в `memo` и
   * сравнивает `item` по ссылке, так что «та же обёртка с новым содержимым»
   * до перерисовки не дошла бы. Оба требования совместимы, потому что
   * `useChatList` сохраняет ссылку `Chat` у строк, значения которых не менялись.
   */
  const itemCacheRef = useRef<Map<PeerId, DialogListItem>>(new Map())
  /** Прошлый результат: ссылка на массив обязана пережить пересчёт, ничего в
   *  списке не изменивший (`useShouldAnimate` пересчитывается по её смене). */
  const prevItemsRef = useRef<readonly DialogListItem[]>([])

  const items = useMemo<readonly DialogListItem[]>(() => {
    const cache = itemCacheRef.current
    const chatById = new Map<PeerId, Chat>()
    for (const chat of chats) chatById.set(Number(chat.id), chat)
    const next: DialogListItem[] = []
    const seen = new Set<PeerId>()
    for (const d of dialogs) {
      if (!matchesThisFolder(d)) continue
      const value = chatById.get(d.peerId)
      // Контракт `chats` — ПОЛНАЯ витрина зеркала (`useChatList` маппит каждый
      // диалог), поэтому в норме ветка недостижима. Держим её не как защиту от
      // краша рендера (строка без витринного значения), а как единственную
      // честную реакцию: если она когда-нибудь сработает, набор папки станет
      // БОЛЬШЕ списка (`countInMirror` считает по зеркалу, а не по `chats`), и
      // догрузка встанет ровно так же, как вставала на разъехавшемся `muted`.
      if (!value) continue
      seen.add(d.peerId)
      const hit = cache.get(d.peerId)
      if (hit && hit.value === value) { next.push(hit); continue }
      const item: DialogListItem = { id: d.peerId, value }
      cache.set(d.peerId, item)
      next.push(item)
    }
    for (const id of cache.keys()) if (!seen.has(id)) cache.delete(id)

    const prev = prevItemsRef.current
    if (prev.length === next.length && prev.every((it, i) => it === next[i])) return prev
    prevItemsRef.current = next
    return next
  }, [chats, dialogs, matchesThisFolder])

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
   * Строка «Архив» — порт `AutonomousDialogList.ensureArchiveDialogHydrated`
   * (`autonomousDialogList/dialogs.ts:263-276`): список «Всех чатов» тянет её
   * страницу ПАРАЛЛЕЛЬНО каждой своей загрузке, а состояние строки просит у
   * хранилища `getDialogs({filterId: FOLDER_ID_ARCHIVE, limit: 10})`
   * (`archiveDialog.tsx:27,124-137`) и показывает ряд, если та непуста.
   *
   * Без этого запроса строки не бывает вовсе: её гейт — архивные диалоги в
   * зеркале (`ChatList.tsx`, `pinnedArchive`), первичный `refresh()` страничный
   * и старый архив в первое окно не попадает, а страницы «Всех чатов» уходят с
   * `folder_id=0` и архива не приносят никогда (спека
   * `2026-08-13-dialogs-count-and-refresh-design.md`, «Дополнение: вход в архив»).
   *
   * Зовётся из `fetchPage`, а не из эффекта монтирования, — ровно по месту
   * оригинала, и это же даёт РЕТРАЙ: запрос fire-and-forget, и упади он
   * (моргнула сеть на старте), следующая же страница «Всех чатов» — прокрутка,
   * дырка, новый `requestItemForIdx` — попросит архив заново. Условие «архива в
   * зеркале нет» — порт правила перезапроса `archiveDialog.tsx:162-171`
   * («список строки сократился — перезапросить»): у нас архив штатно выпадает
   * из окна `refresh()`, а пока он в зеркале есть, повторный запрос не нужен.
   *
   * Ответ здесь НЕ применяется: владелец объявляет страницу сам (`upsert` →
   * `rt:dialog_op` → проектор → зеркало), витрина своего вывода того же факта
   * не держит (`web-client/CLAUDE.md`, «Владение фактами»). Читается из него
   * ровно одно — «архива нет вовсе» (`isEnd` при пустой странице), и только
   * чтобы БОЛЬШЕ НЕ СПРАШИВАТЬ: у пользователя без архива гейт по зеркалу не
   * закроется никогда, и запрос уходил бы на каждую страницу списка (в сеть при
   * этом сходил бы только первый — дальше владелец отвечает из кэша, — но RPC
   * воркеру летели бы все). У оригинала на этом месте свой признак «уже
   * спрашивали» (`archiveDialog.tsx:170` — `if(canFetch()) return`); наш
   * опирается на ОТВЕТ, потому что перезапрос при выпавшем из зеркала архиве
   * обязан остаться. `.catch` — как у прочих fire-and-forget колсайтов
   * владельца, и он же сохраняет ретрай: упавший запрос признака не ставит.
   *
   * Только список «Всех чатов»: строку архива несёт он один (`Sidebar.tsx`
   * отдаёт `archived` только ему), а сам оверлей архива страницы просит уже
   * своим курсором — обычным `fetchPage` ниже.
   */
  const noArchiveRef = useRef(false)
  const ensureArchiveHydrated = useEvent((forFilterId: number): void => {
    if (forFilterId !== ALL_FOLDER_ID || noArchiveRef.current) return
    if (useChatsStore.getState().dialogs.some((d) => d.archived)) return
    void managers.dialogs.getDialogs({ filterId: ARCHIVE_FOLDER_ID, limit: ARCHIVE_ROW_LIMIT })
      .then((r) => { if (!r.dialogs.length && r.isEnd) noArchiveRef.current = true })
      .catch(() => {})
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
    ensureArchiveHydrated(forFilterId)
    try {
      const result = await managers.dialogs.getDialogs({ offsetIndex, limit: guessLoadCount(), filterId: forFilterId })
      // Хук размонтирован либо папку успели переключить: писать в состояние
      // нечего, а двигать курсор чужого (уже нового) цикла — тем более.
      if (!middleware() || currentFilterId() !== forFilterId) return { cursor: offsetIndex, count: 0 }

      // Порт base.ts:274-277: курсор — МИНИМАЛЬНЫЙ индекс отданной страницы.
      const indexById = useChatsStore.getState().dialogIndexById
      const cursor = result.dialogs.reduce<number>((prev, d) => {
        const index = indexById[d.peerId]
        return index !== undefined && index < prev ? index : prev
      }, offsetIndex ?? Infinity)

      setPageState({ filterId: forFilterId, totalCount: result.count, isEnd: result.isEnd, wasAtLeastOnceFetched: true })

      // Курсор не сдвинулся (пустая страница либо зеркало ещё не знает индексов
      // приехавших диалогов) — следующий запрос ушёл бы с ТЕМ ЖЕ `offsetIndex`
      // и вернул ту же страницу: у владельца сетевой курсор свой (`peerId`
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
