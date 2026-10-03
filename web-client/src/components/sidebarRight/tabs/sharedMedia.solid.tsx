/** @jsxImportSource solid-js */
/**
 * Порт tweb `src/components/sidebarRight/tabs/sharedMedia.tsx` (812502980) —
 * содержимое `AppSharedMediaTab` (`sharedMediaTab.ts`): шапка (крестик ⇄
 * «назад», заголовок ⇄ «имя + счётчик вкладки», карандаш «Изменить»),
 * профиль `PeerProfile` и `AppSearchSuper` в одной прокрутке вкладки, кнопка
 * «Добавить участников». Компонент строит всё императивно и вешает на вкладку
 * `_impl` — как оригинал.
 *
 * Тред (решение пользователя 2026-10-03): `setPeer(peerId, threadId)`, где
 * `peerId` — группа обсуждения или форум. Вкладки медиа выбираются с
 * `threadId` (`setQuery` → контекст поиска → `thread_root` ручек), «Участники» —
 * весь список группы (`canViewMembers`, у темы форума скрыты), истории и
 * подарки в треде скрыты — всё это решает `AppSearchSuper`.
 *
 * Расхождения:
 *  1. Вкладок 8 из 12 (`:725-768`): нет `stories`, `saved`, `groups`,
 *     `similar` — у них нет загрузчика (задачи 19/17/16/18 плана shared media,
 *     «Отложено»). `savedDialogs` назван `FilterChats` (ключа
 *     `SharedMedia.SavedDialogs` нет). Строки `historyStorage` «Избранного»
 *     (`setQuery`, `:67`) нет — вкладки `saved` нет.
 *  2. Меню ⋮ шапки (`:497-547`: «Показать как сообщения», фильтр фото/видео,
 *     меню историй и подарков) и контекст-меню ряда вкладок «Сделать главной»
 *     (`:809-893`) — Б-100: нет `createButtonMenuCheckboxFilters`/
 *     `setMediaInputFilter` у класса и ручки `setMainProfileTab`.
 *  3. Подзаголовок вкладки «Медиа» — `MediaFiles` с длиной из `onLengthChange`,
 *     а не «N фото, M видео» (`:456-481`): раздельных счётчиков
 *     (`onMediaCountersChange`) у нашего класса нет.
 *  4. «Изменить»: тема форума (`AppEditTopicTab`) и бот (`AppEditBotTab`) не
 *     портированы — карандаш у них скрыт (Б-101). У группы и канала —
 *     `AppEditChatTab`, у контакта — `AppEditContactTab`. Проверка
 *     `monoforum` (`:151`) — поля нет на проводе.
 *  5. Шапка-карусель — наш класс `PeerProfileAvatars` СНАРУЖИ `PeerProfile`
 *     (узлы-пропы `avatarsContainer`/`avatarsInfo`) с Solid-портом
 *     `useCollapsable`, как у корня настроек (`settings.solid.tsx`,
 *     расхождение 2), а не `PeerProfile.AutoAvatar`. Класс на скролл сам не
 *     подписан (у tweb — `peerProfileAvatars.ts:312-320`): `updateHeaderFilled`
 *     зовёт слушатель скролла этого же корня.
 *  6. `profile-container` на вкладку ставит этот компонент, а не `PeerProfile`
 *     (tweb `peerProfile.tsx:183`): наш `PeerProfile` монтирует и корень
 *     настроек, у которого класса нет.
 *  7. Меню участника: «Назначить админом»/«Изменить права»/«Ограничить» скрыты
 *     — вкладки прав участника нет (Б-41), `openUserPermissions` не передаётся.
 *  8. Прежний корень профиля гасится на повторном `fillProfileElements` (у
 *     оригинала — только на смерти вкладки): вкладка на другого пира у нас
 *     та же, что и у tweb, — новая (`chat.ts:1003`), но второй корень в одной
 *     прокрутке не нужен ни при каком вызове.
 */
import { createEffect, createRoot, onCleanup } from 'solid-js'
import AppSearchSuper, { type SearchSuperMediaTab, type SearchSuperMediaType } from '@components/appSearchSuper'
import { getHistoryStorage, subscribeSharedMediaLiveUpdates } from '@components/sharedMediaHistories'
import TransitionSlider from '@components/transition'
import Button from '@components/button'
import ButtonIcon from '@components/buttonIcon'
import ButtonCorner from '@components/buttonCorner'
import I18n, { i18n, type LangPackKey } from '@lib/langPack'
import { attachClickEvent } from '@helpers/dom/clickEvent'
import liteMode from '@helpers/liteMode'
import { fastRaf } from '@helpers/schedulers'
import addChatUsers from '@components/addChatUsers'
import PeerProfile from '@components/peerProfile.solid'
import PeerProfileAvatars from '@components/peerProfileAvatars'
import { useCollapsable } from '@helpers/solid/useCollapsable'
import { ADDITIONAL_OFFSET, HEADER_H, isSharedMediaReached, shouldForceFold } from '@components/userInfo/helpers'
import { useSuperTab } from '@components/solidJsTabs/superTabProvider.solid'
import { AppEditChatTab, AppEditContactTab } from '@components/solidJsTabs/tabs'
import type SidebarSlider from '@components/slider'
import type AppSharedMediaTab from './sharedMediaTab'
import rootScope from '@lib/rootScope'
import appImManager from '@lib/appImManager'
import { cachedChat, cachedUser, hasRightsPeer, subscribePeerMirror } from '@core/peerCache'
import { hasRights } from '@core/peers/rights'
import { isBot, isBroadcast } from '@core/peers/predicates'
import { isAnyChat, isUser, toChatId } from '@core/peers/peerId'
import { isForumPeer } from '@core/peerCache'
import PeerTitle from '@components/chat/peerTitle'

/** tweb `:725-768` — расхождение 1. */
const SHARED_MEDIA_TABS: readonly SearchSuperMediaTab[] = [
  { name: 'FilterChats', type: 'savedDialogs' },
  { name: 'PeerMedia.Members', type: 'members' },
  { inputFilter: 'inputMessagesFilterPhotoVideo', name: 'SharedMediaTab2', type: 'media' },
  { name: 'SharedMedia.Gifts', type: 'gifts' },
  { inputFilter: 'inputMessagesFilterDocument', name: 'SharedFilesTab2', type: 'files' },
  { inputFilter: 'inputMessagesFilterUrl', name: 'SharedLinksTab2', type: 'links' },
  { inputFilter: 'inputMessagesFilterMusic', name: 'SharedMusicTab2', type: 'music' },
  { inputFilter: 'inputMessagesFilterRoundVoice', name: 'SharedVoiceTab2', type: 'voice' },
]

/** tweb `:562-575` (только вкладки из `SHARED_MEDIA_TABS`; расхождение 3 — `media`). */
const SUBTITLE_KEYS: [SearchSuperMediaType, LangPackKey][] = [
  ['savedDialogs', 'SavedDialogsTabCount'],
  ['members', 'Members'],
  ['media', 'MediaFiles'],
  ['gifts', 'StarGiftsCount'],
  ['files', 'Files'],
  ['links', 'Links'],
  ['music', 'MusicFiles'],
  ['voice', 'Voice'],
]

/** tweb `:107-119` — заголовок вкладки по виду пира. */
export function getSharedMediaTitleKey(options: {
  isTopic: boolean
  isBot: boolean
  isBroadcast: boolean
  isUser: boolean
}): LangPackKey {
  if(options.isTopic) {
    return 'Profile.Info.Topic'
  } else if(options.isBot) {
    return 'Profile.Info.Bot'
  } else if(options.isBroadcast) {
    return 'Profile.Info.Channel'
  } else if(options.isUser) {
    return 'Profile.Info.User'
  } else {
    return 'Profile.Info.Group'
  }
}

/**
 * tweb `:131-163` (`toggleEditBtn`) — виден ли карандаш «Изменить» (без
 * расхождения 4 вид вкладки решал бы клик). Канал — любой админ или право
 * `change_info` (зеркало tdesktop `EditPeerInfoBox::Available`), группа —
 * `change_info` или `change_permissions`. Пользователь — `appUsersManager.canEdit`: не я и контакт
 * (`bot_can_edit` на проводе нет; бот — расхождение 4).
 */
export async function canEditPeer(peerId: PeerId, threadId: number | undefined, isContact: (peerId: PeerId) => Promise<boolean>): Promise<boolean> {
  if(isUser(peerId)) {
    if(peerId === rootScope.myId || isBot(cachedUser(peerId))) return false
    return isContact(peerId)
  }

  // расхождение 4 — тема форума
  if(threadId && isForumPeer(peerId)) return false

  const chat = cachedChat(peerId)
  if(chat?._ === 'channel') {
    return hasRights(chat, 'just_admin') || hasRights(chat, 'change_info')
  }

  return hasRights(chat, 'change_info') || hasRights(chat, 'change_permissions')
}

const SharedMedia = () => {
  const [tab] = useSuperTab<typeof AppSharedMediaTab>()
  const managers = tab.managers!

  const setQuery = () => {
    const { peerId, threadId } = tab
    tab.searchSuper.setQuery({
      peerId,
      threadId,
      historyStorage: getHistoryStorage(peerId, threadId),
    })
  }

  const cleanupHTML = async() => {
    const isAnyChatPeer = isAnyChat(tab.peerId)
    const canViewMembers = isAnyChatPeer ? await tab.searchSuper.canViewMembers() : false
    const hasInviteRights = isAnyChatPeer && hasRightsPeer(tab.peerId, 'invite_users')

    return () => {
      editBtn.classList.add('hide')
      tab.searchSuper.cleanupHTML()
      tab.container.classList.toggle('can-add-members', canViewMembers && hasInviteRights)
    }
  }

  const changeTitleKey = async() => {
    const { peerId, threadId } = tab
    await managers.peers.fillMirror([peerId])
    const isSavedDialog = !!(peerId === rootScope.myId && threadId)
    const usePeerId = isSavedDialog ? threadId! : peerId
    const titleKey = getSharedMediaTitleKey({
      isTopic: !!threadId && isForumPeer(usePeerId),
      isBot: isBot(cachedUser(usePeerId)),
      isBroadcast: isBroadcast(cachedChat(usePeerId)),
      isUser: isUser(usePeerId),
    })
    // tweb `wrapPeerTitle({peerId, threadId, meAsNotes, dialog: true})`; имя
    // темы форума (`threadId`) нашему `PeerTitle` нужно иконкой `topic` — у
    // заголовка вкладки темы её нет, как и вкладки темы (расхождение 4)
    const peerTitle = new PeerTitle({
      peerId,
      dialog: true,
      meAsNotes: isSavedDialog && threadId === rootScope.myId,
      middleware: tab.middlewareHelper.get(),
      managers,
    }).element

    return () => {
      titleI18n.compareAndUpdate({ key: titleKey })
      sharedMediaTitle.replaceChildren(peerTitle)
    }
  }

  function toggleEditBtn(manual: true): Promise<() => void>
  function toggleEditBtn(manual?: false): Promise<void>
  async function toggleEditBtn(manual?: boolean): Promise<(() => void) | void> {
    const { peerId, threadId } = tab
    const show = await canEditPeer(peerId, threadId, (peerId) => managers.contacts.isContact(peerId))

    const callback = () => {
      editBtn.classList.toggle('hide', !show)
    }

    return manual ? callback : callback()
  }

  let disposeProfile: (() => void) | undefined
  const renderProfile = () => {
    // расхождение 8
    disposeProfile?.()
    createRoot((dispose) => {
      disposeProfile = dispose
      tab.middlewareHelper.onDestroy(dispose)

      // расхождение 5 (`settings.solid.tsx:250-273`, tweb `peerProfileAvatars.ts:350-373`)
      const scrollableEl = tab.scrollable.container
      const avatars = new PeerProfileAvatars({
        managers,
        setCollapsedOn: tab.container,
        scrollableEl,
        unfold: (e) => unfold(e),
      })
      const { folded, unfold, fold } = useCollapsable({
        container: () => avatars.container,
        listenWheelOn: tab.container,
        scrollable: () => scrollableEl,
      })
      createEffect(() => {
        if(shouldForceFold(avatars.hasPhoto, folded())) {
          fold()
          return
        }

        avatars.setCollapsed(folded())
      })
      void avatars.setPeer(tab.peerId)
      const onScroll = () => fastRaf(avatars.updateHeaderFilled)
      scrollableEl.addEventListener('scroll', onScroll, { passive: true })
      onCleanup(() => {
        scrollableEl.removeEventListener('scroll', onScroll)
        avatars.cleanup()
      })

      tab.scrollable.append((
        <PeerProfile
          peerId={tab.peerId}
          threadId={tab.threadId}
          isDialog
          scrollable={scrollableEl}
          setCollapsedOn={tab.container}
          searchSuperContainer={tab.searchSuper.container}
          avatarsContainer={avatars.container}
          avatarsInfo={avatars.info}
        />
      ) as HTMLElement)
    })
  }

  const fillProfileElements = async() => {
    if(!tab.peerChanged) {
      return
    }

    tab.peerChanged = false
    const callbacks = await Promise.all([
      cleanupHTML(),
      toggleEditBtn(true),
      changeTitleKey(),
      Promise.resolve((() => {
        // расхождение 6
        tab.container.classList.add('profile-container')

        if(!tab.noProfile) {
          renderProfile()
        } else {
          // * keep same layout
          const content = document.createElement('div')
          content.classList.add('profile-content')

          tab.searchSuper.container.replaceWith(content)
          content.append(tab.searchSuper.container)
        }

        return () => {}
      })()),
    ])

    return () => {
      callbacks.forEach((callback) => {
        callback?.()
      })
    }
  }

  const loadSidebarMedia = (single: boolean, justLoad?: boolean) => {
    return tab.searchSuper.load(single, justLoad)
  }

  const setSearchTab = (type: SearchSuperMediaType) => {
    const idx = tab.searchSuper.mediaTabs.findIndex((t) => t.type === type)
    if(idx === -1) return
    tab.searchSuper.selectTab(idx)
  }

  const setLoadMutex = (promise: Promise<unknown>) => {
    tab.searchSuper.loadMutex = promise
  }

  // ===== build (the former init body) =====

  tab.container.classList.add('shared-media-container')

  // * header
  const newCloseBtn = Button('btn-icon sidebar-close-button', { noRipple: true, ariaLabel: 'Close' })
  tab.closeBtn.replaceWith(newCloseBtn)
  tab.closeBtn = newCloseBtn

  const animatedCloseIcon = document.createElement('div')
  animatedCloseIcon.classList.add('animated-close-icon')
  newCloseBtn.append(animatedCloseIcon)

  if(tab.isFirst) {
    animatedCloseIcon.classList.add('state-back')
  }

  const createTransitionContainer = () => {
    const transitionContainer = document.createElement('div')
    transitionContainer.className = 'transition slide-fade'
    return transitionContainer
  }

  const transitionContainer = createTransitionContainer()

  const makeTransitionItem = (titleInner: HTMLElement, noCounter?: boolean, title?: HTMLElement) => {
    const element = document.createElement('div')
    element.classList.add('transition-item')

    title ??= tab.title.cloneNode() as HTMLElement
    title.append(titleInner)

    let subtitle: HTMLElement | undefined
    if(noCounter) {
      element.append(title)
    } else {
      const rows = document.createElement('div')
      rows.classList.add('sidebar-header__rows')
      subtitle = document.createElement('div')
      subtitle.classList.add('sidebar-header__subtitle')
      rows.append(title, subtitle)
      element.append(rows)
    }

    return { element, title, subtitle }
  }

  const titleI18n = new I18n.IntlElement()
  const transitionFirstItem = makeTransitionItem(titleI18n.element, true, tab.title)
  const editBtn = ButtonIcon('edit', { ariaLabel: 'Edit' })

  transitionFirstItem.element.append(editBtn)

  enum TitleIndex {
    Profile = 0,
    Media = 1,
  }

  const transitionSharedMedia = makeTransitionItem(i18n('PeerInfo.SharedMedia'))
  const sharedMediaTitle = transitionSharedMedia.title

  const sharedMediaTransitionContainer = createTransitionContainer()
  transitionSharedMedia.subtitle!.append(sharedMediaTransitionContainer)

  const subtitles = new Map<SearchSuperMediaType, I18n.IntlElement>()
  sharedMediaTransitionContainer.append(...SUBTITLE_KEYS.map(([type]) => {
    const element = document.createElement('div')
    element.classList.add('transition-item')
    const subtitle = new I18n.IntlElement({ key: 'Loading' })
    subtitles.set(type, subtitle)
    element.append(subtitle.element)
    return element
  }))

  transitionContainer.append(...[
    transitionFirstItem,
    transitionSharedMedia,
  ].map(({ element }) => element))

  // расхождение 2 — без `btnMenu`
  tab.header.append(transitionContainer)

  // * body

  const OFFSET = HEADER_H + ADDITIONAL_OFFSET
  const cb = tab.scrollable.onAdditionalScroll
  tab.scrollable.onAdditionalScroll = () => {
    cb?.()
    const isSharedMedia = isSharedMediaReached(tab.searchSuper)
    if(isSharedMedia === undefined) return
    setIsSharedMedia(isSharedMedia)
  }

  const getTitleIndex = (isSharedMedia = transition.prevId() !== TitleIndex.Profile) => {
    let index = TitleIndex.Profile
    if(isSharedMedia) {
      index = TitleIndex.Media
    }

    return index
  }

  const setIsSharedMedia = (isSharedMedia: boolean) => {
    animatedCloseIcon.classList.toggle('state-back', !!tab.isFirst || isSharedMedia)
    tab.searchSuper.container.classList.toggle('is-full-viewport', isSharedMedia)
    tab.header.classList.toggle('hide-border', isSharedMedia)

    transition(getTitleIndex(isSharedMedia))

    if(isSharedMedia) {
      tab.container.classList.add('header-filled')
    } else {
      tab.searchSuper.cleanScrollPositions()
    }
  }

  const transition = TransitionSlider({
    content: transitionContainer,
    type: 'slide-fade',
    transitionTime: 400,
    isHeavy: false,
  })

  transition(tab.noProfile ? TitleIndex.Media : TitleIndex.Profile)

  const transitionSubtitle = TransitionSlider({
    content: sharedMediaTransitionContainer,
    type: 'slide-fade',
    transitionTime: 400,
    isHeavy: false,
  })

  transitionSubtitle(0)

  attachClickEvent(tab.closeBtn, () => {
    if(transition.prevId() && !tab.noProfile) {
      void tab.scrollable.scrollIntoViewNew({
        element: tab.scrollable.container.querySelector('.profile-content') as HTMLElement,
        position: 'start',
      })
      transition(TitleIndex.Profile)

      if(!tab.isFirst) {
        animatedCloseIcon.classList.remove('state-back')
        tab.container.classList.remove('header-filled')
      }
    } else if(!tab.scrollable.isHeavyAnimationInProgress) {
      (tab.slider as SidebarSlider).onCloseBtnClick()
    }
  }, { listenerSetter: tab.listenerSetter })

  attachClickEvent(editBtn, () => {
    const { peerId } = tab
    const slider = tab.slider as SidebarSlider
    if(isAnyChat(peerId)) {
      void slider.createTab(AppEditChatTab).open({ chatId: toChatId(peerId) })
    } else {
      void slider.createTab(AppEditContactTab).open(peerId)
    }
  }, { listenerSetter: tab.listenerSetter })

  tab.listenerSetter.add(rootScope)('contacts_update', (userId) => {
    if(tab.peerId === userId) {
      void toggleEditBtn()
    }
  })

  // tweb `:711-715` (`chat_update`): карточка чата у нас приходит в зеркало
  // (`core/peerCache.ts`), отдельного события нет — права перечитываются на
  // каждом изменении зеркала.
  tab.middlewareHelper.onDestroy(subscribePeerMirror(() => {
    if(tab.peerId !== undefined && isAnyChat(tab.peerId)) {
      void toggleEditBtn()
    }
  }))

  tab.searchSuper = new AppSearchSuper({
    mediaTabs: SHARED_MEDIA_TABS.map((mediaTab) => ({ ...mediaTab })),
    scrollable: tab.scrollable,
    onChangeTab: (mediaTab) => {
      transitionSubtitle(SUBTITLE_KEYS.findIndex((item) => item[0] === mediaTab.type))

      const timeout = mediaTab.type === 'members' && liteMode.isAvailable('animations') ? 250 : 0
      setTimeout(() => {
        btnAddMembers.classList.toggle('is-hidden', mediaTab.type !== 'members')
      }, timeout)
    },
    managers,
    onLengthChange: (type, length) => {
      const item = SUBTITLE_KEYS.find((item) => item[0] === type)
      if(!item) {
        return
      }

      subtitles.get(type)!.compareAndUpdate({ key: item[1], args: [length] })
    },
    // tweb `appSearchSuper.ts:1564-1569`
    openPeer: (peerId) => {
      void appImManager.setInnerPeer({ peerId })
    },
    setInnerPeer: ({ peerId, lastMsgId, threadId }) => {
      void appImManager.setInnerPeer({ peerId, lastMsgId, threadId })
    },
    scrollOffset: OFFSET,
  })

  // tweb `:705-723` — живые апдейты вкладок (`sharedMediaHistories.ts`)
  subscribeSharedMediaLiveUpdates(tab.searchSuper, tab.listenerSetter)

  tab.searchSuper.scrollStartCallback = () => {
    setIsSharedMedia(true)
  }

  if(tab.noProfile) {
    tab.scrollable.append(tab.searchSuper.container)
  }

  const btnAddMembers = ButtonCorner({ icon: 'addmember_filled', ariaLabel: 'GroupAddMembers' })
  tab.content.append(btnAddMembers)

  attachClickEvent(btnAddMembers, () => {
    addChatUsers({
      peerId: tab.peerId,
      slider: tab.slider as SidebarSlider,
    })
  }, { listenerSetter: tab.listenerSetter })

  tab._impl = {
    setQuery,
    fillProfileElements,
    loadSidebarMedia,
    setSearchTab,
    setLoadMutex,
  }

  return null
}

export default SharedMedia
