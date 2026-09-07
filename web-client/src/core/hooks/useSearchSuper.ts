// Шов «панель профиля ↔ AppSearchSuper» — роль, которую у tweb делят вкладка
// `AppSharedMediaTab` (`sidebarRight/tabs/sharedMediaTab.tsx`) и обвязка
// `sharedMedia.tsx`: создать скроллер вкладки (`sliderTab.ts:66`), собрать
// класс со списком вкладок правой колонки (`sharedMedia.tsx:604-680`),
// подписать живые апдейты (`:596-602`), на смену пира — `setQuery` →
// `cleanupHTML` → `load(true)` (`sharedMediaTab.tsx:70-84`, `sharedMedia.tsx:
// 159-207`, `chat/chat.ts:1210`), на смерть вкладки — `destroy()` класса и
// скроллера (`sharedMediaTab.tsx:111-117`, `sliderTab.ts:105-111`).
//
// Здесь же принято решение по ВЛАДЕНИЮ СКРОЛЛЕРОМ (расхождение 7 в шапке
// `components/appSearchSuper.ts`): скроллер создаёт и роняет ЭТОТ хук — хозяин,
// как `SliderSuperTab` в оригинале; класс своего не заводит и чужой не роняет.
// Скроллер общий с шапкой панели (её `onAdditionalScroll`, tweb
// `sharedMedia.tsx:484-493`) и с классом `PeerProfileAvatars` (тот читает
// `scrollTop` напрямую) — второго `Scrollable` на том же узле нет.
//
// Граница с React (правило `tweb-parity`, «Граница с React»): узел `.search-super`
// создаёт и уничтожает КЛАСС; React к его атрибутам не прикасается — Solid-корень
// `.profile-content` (`UserInfoPanel.tsx`, `mountSolid`) получает его ПРОПОМ
// `searchSuperContainer` (tweb `sharedMedia.tsx:166`) и вставляет последним
// ребёнком. Корень пересоздаётся на каждый `peerId`, узел класса — один на всю
// жизнь панели и переезжает в новый корень целиком (пин —
// `useSearchSuper.test.tsx`). `useImperativeIsland` здесь не подходит: у него
// узел класса кладётся В React-хост, а у нас узел уходит в ЧУЖОЙ (Solid) корень.
//
// ─────────────────────────────────────────────────────────────────────────────
// ОБЪЯВЛЕННЫЕ РАСХОЖДЕНИЯ С ОРИГИНАЛОМ
//
//  1. Список вкладок — 8 из 12 (`sharedMedia.tsx:604-648`): `stories`, `saved`,
//     `groups`, `similar` не объявлены — это отложенные задачи 19/17/16/18
//     плана (`docs/superpowers/plans/2026-09-07-solid-wave-3-shared-media.md`,
//     «Отложено»): у трёх нет ручки бэкенда, у `stories` — своя секция выше по
//     странице (`PinnedStoriesSection`). Объявлять вкладку без загрузчика
//     нельзя — первый показ выбрал бы её, и `loadType` не знал бы, чем её
//     наполнить. Имя `savedDialogs` — `FilterChats` (`SharedMedia.SavedDialogs`
//     в словаре нет; тот же ключ у вкладки задачи 12).
//  2. `threadId` не передаётся: панель профиля тему форума отдельно не
//     открывает (`PeerProfileProps.threadId`, докблок там же).
//  3. Порядок на смену пира: у оригинала `cleanupHTML()` класса зовётся ПОСЛЕ
//     пересоздания Solid-корня (`fillProfileElements`, `:159-207` —
//     `createRoot` идёт в том же `Promise.all`, а колбэки уборки — после), у
//     нас — ДО (эффект хука объявлен раньше эффекта корня в панели, иначе
//     корню нечего было бы монтировать). Единственное, что от этого зависит, —
//     `search-empty` на РОДИТЕЛЕ узла: `cleanupHTML` поставит его на старый
//     корень, но `loadFirstTime` → `toggleContainerHidden` того же `load(true)`
//     выставляет окончательное значение уже на новом родителе.
//  4. `setLoadMutex` (`chat.ts` ставит обещание открытия чата, `:1210`) и
//     `onOpenAfterTimeout → scrollable.onScroll()` (`sharedMediaTab.tsx:106-108`)
//     не здесь: первого у панели нет (открытие чата не блокирует её), второе —
//     дело панели, у которой есть `open`.
import { useLayoutEffect, useRef, useState, type RefObject } from 'react'
import Scrollable from '@components/scrollable'
import AppSearchSuper, {
  type SearchSuperManagers,
  type SearchSuperMediaTab,
  type SearchSuperMediaType,
} from '@components/appSearchSuper'
import { getHistoryStorage, subscribeSharedMediaLiveUpdates } from '@components/sharedMediaHistories'
import ListenerSetter from '@helpers/listenerSetter'
import type { Participant } from '@helpers/dom/createParticipantContextMenu'
import { ADDITIONAL_OFFSET, HEADER_H } from '@components/userInfo/helpers'

/** tweb `sharedMedia.tsx:604-648` — расхождение 1 в шапке. */
export const SHARED_MEDIA_TABS: readonly SearchSuperMediaTab[] = [
  { name: 'FilterChats', type: 'savedDialogs' },
  { name: 'PeerMedia.Members', type: 'members' },
  { inputFilter: 'inputMessagesFilterPhotoVideo', name: 'SharedMediaTab2', type: 'media' },
  { name: 'SharedMedia.Gifts', type: 'gifts' },
  { inputFilter: 'inputMessagesFilterDocument', name: 'SharedFilesTab2', type: 'files' },
  { inputFilter: 'inputMessagesFilterUrl', name: 'SharedLinksTab2', type: 'links' },
  { inputFilter: 'inputMessagesFilterMusic', name: 'SharedMusicTab2', type: 'music' },
  { inputFilter: 'inputMessagesFilterRoundVoice', name: 'SharedVoiceTab2', type: 'voice' },
]

export type UseSearchSuperOptions = {
  /** узел-скроллер панели (`div.scrollable.scrollable-y`) — станет `Scrollable.container` без обёртки */
  scrollableRef: RefObject<HTMLElement | null>
  /** узел вкладки — `scrolled-start`/`scrolled-end` (`sliderTab.ts:67`) */
  setCollapsedOnRef: RefObject<HTMLElement | null>
  peerId: PeerId
  managers: SearchSuperManagers
  onChangeTab?: (mediaTab: SearchSuperMediaTab) => void
  onLengthChange?: (type: SearchSuperMediaType, length: number) => void
  openPeer?: (peerId: PeerId) => void
  openUserPermissions?: (participant: Participant, isAdmin?: boolean) => void
}

export type SearchSuperSeam = {
  searchSuper: AppSearchSuper
  scrollable: Scrollable
}

/** tweb `sharedMedia.tsx:480-482` — `OFFSET`, который класс вычитает при прокрутке к своему верху. */
const SCROLL_OFFSET = HEADER_H + ADDITIONAL_OFFSET

/**
 * @returns класс и скроллер после монтирования; `null` — до первого layout-эффекта.
 * Инстанс один на всю жизнь панели (deps `[]`), как `appSidebarRight.sharedMediaTab`.
 */
export function useSearchSuper(options: UseSearchSuperOptions): SearchSuperSeam | null {
  const [seam, setSeam] = useState<SearchSuperSeam | null>(null)

  // Колбэки хоста читаются в момент вызова: класс создаётся один раз, а
  // замыкания панели живут по рендеру (тот же приём, что `setupRef` в
  // `useImperativeIsland`).
  const optionsRef = useRef(options)
  optionsRef.current = options

  useLayoutEffect(() => {
    const scrollableEl = optionsRef.current.scrollableRef.current
    const setCollapsedOn = optionsRef.current.setCollapsedOnRef.current
    if (!scrollableEl || !setCollapsedOn) return

    // `sliderTab.ts:66-67`: скроллер вкладки. Пятый аргумент — ГОТОВЫЙ узел:
    // `new Scrollable(el)` переложил бы детей `el` в новый div, а узел рендерит
    // React и им же владеет.
    const scrollable = new Scrollable(undefined, undefined, undefined, undefined, scrollableEl)
    scrollable.attachBorderListeners(setCollapsedOn)

    const searchSuper = new AppSearchSuper({
      mediaTabs: SHARED_MEDIA_TABS.map((tab) => ({ ...tab })),
      scrollable,
      managers: optionsRef.current.managers,
      onChangeTab: (mediaTab) => optionsRef.current.onChangeTab?.(mediaTab),
      onLengthChange: (type, length) => optionsRef.current.onLengthChange?.(type, length),
      openPeer: (peerId) => optionsRef.current.openPeer?.(peerId),
      openUserPermissions: (participant, isAdmin) => optionsRef.current.openUserPermissions?.(participant, isAdmin),
      scrollOffset: SCROLL_OFFSET,
    })

    // `sharedMedia.tsx:596-602`
    const listenerSetter = new ListenerSetter()
    subscribeSharedMediaLiveUpdates(searchSuper, listenerSetter)

    setSeam({ searchSuper, scrollable })
    return () => {
      setSeam(null)
      listenerSetter.removeAll()
      // `sharedMediaTab.tsx:111-117` → `sliderTab.ts:109`: сперва класс, потом
      // скроллер хозяина — тем же порядком, что у оригинала.
      searchSuper.destroy()
      scrollable.destroy()
    }
  }, [])

  // `sharedMediaTab.tsx:70-84` (`setPeer` → `setQuery`), `sharedMedia.tsx:47-57`
  // (кэш пира из модульного хранилища), `:159-207` (`cleanupHTML`) и
  // `chat.ts:1210` (`loadSidebarMedia(true)`). Порядок с корнем — расхождение 3.
  const { peerId } = options
  useLayoutEffect(() => {
    if (!seam) return
    const { searchSuper } = seam
    searchSuper.setQuery({ peerId, historyStorage: getHistoryStorage(peerId) })
    searchSuper.cleanupHTML()
    void searchSuper.load(true)
  }, [seam, peerId])

  return seam
}
