// Порт tweb `src/components/chat/topbar.ts` (812502980, 1873 строки) — шапка чата.
// Ядро — шаг К-3, меню ⋮, плашки и `setFloating` — пачка П-5 волны 7
// (`docs/superpowers/plans/2026-10-02-wave-7-carcass-first.md`, Б-18, Б-21).
//
// Что портировано:
//  - `construct` (`:132-307`): `.sidebar-header.topbar`, стрелка «назад» с бейджем
//    непрочитанного, `.chat-info-container` → `.chat-info` → `.person` → `.content`
//    (`.top` → `.user-title`, `.bottom` → `.info`), `.chat-utils` (лупа, ⋮),
//    `.topbar-floating-plates` с плашками (`createTopbarPlates`); клик по шапке →
//    `appSidebarRight.toggleSidebar` (`:259-286`), «назад» → `chat.pop()` (`:288-306`);
//  - `constructUtils` (`:462-902`): меню ⋮ — пункты с `verify` (расхождение 1), лупа;
//    подменю автоудаления `createAutoDeleteSubmenu` (`:1849-1872`);
//  - `constructPeerHelpers` (`:1030-1175`) в объёме подписи, бейджа «назад» и кнопок
//    звонка (`btnCall`/`btnGroupCall`/`btnGroupCallMenu`, `:1039-1060`, пачка П-4);
//  - проверка кнопок звонка (`pushButtonToVerify`/`verifyButtons` `:309-338`,
//    `verifyRtmpButton`/`verifyVideoChatButton`/`verifyCallButton` `:340-415`),
//    `onCallClick`/`onJoinGroupCallClick` (`:969-998`) — пачка П-4 (расхождение 10);
//  - `addContact` (`:904`), `blockUser` (`:921-959`), `attachClickEvent` (`:961-967`),
//    `onMuteClick`/`onUnmuteClick` (`:1220-1226`), `onResize`/`onChangeScreen`;
//  - `finishPeerChange` (`:1383-1549`): аватар, заголовок, статус, видимость лупы и ⋮,
//    `peerId` плашек; `cleanup`/`destroy` (`:1236-1254`);
//  - закреп: `appendPinnedMessage`/`setupPinnedMessageForPeer`/`revealPreparedPinnedMessage`
//    (`:1256-1381`), `openPinned` (`:1177-1187`), подписки `setPeer`/`peer_pinned_messages`
//    (`:1134-1157`);
//  - `setTitleManual`/`setTitle` (`:1550-1641`), `setFloating` (`:1645-1683`),
//    `messagesCounter` (`:1685-1716`), `createStatus` (`:1718-1845`).
//
// ОБЪЯВЛЕННЫЕ РАСХОЖДЕНИЯ С ОРИГИНАЛОМ
//  1. Меню ⋮: пункты, которым нечего делать у нас, не заведены (dead `verify` = мёртвая
//     кнопка) — каждый строкой бэклога Б-85 плана: `FilterActions`/`CompactDiffView`
//     (журнала действий `ChatType.Logs` нет), `TopicViewAsTopics`/`SavedViewAsChats`
//     (нет `view_forum_as_messages`/`savedAsForum`, О-88), `ChannelDirectMessages.*`,
//     `PaidMessages.ChargeFee`/`RemoveFee` (монофорума нет, О-4), `AddToGroup`/
//     `BotAddToGroupOrChannel`/`AddToChannel` (нет `bot_info` и попапа
//     `showAddBotToChat`), `ShareContact` (выбор получателя — только React-мост
//     `popups/shareUrl.bridge.ts`, до 2C-24), `Chat.Menu.SendGift` (`showSendGiftPopup` —
//     заглушка до 2C-20), `BoostChannel`/`BoostGroup`
//     (`openBoosts` не портирован), бот-`Settings` (нет `attachMenuBots`), `Translate`
//     (перевода нет), `DisableSharing`/`EnableSharing` (нет флагов `noforwards_*` у
//     `userFull`), `WelcomeMessages.DeleteAll` и обёртка `ChatType.Welcome` (секции нет).
//     Пункты звонков (`Call`/`VideoCall`/`LiveStream`/`VoiceChat`, `:528-547`) — П-5
//     (контракт `p5-contract.md`); их `verify*` и кнопки звонка — здесь (П-4, расхождение 10).
//  2. Плашки — только с предметом (`topbarPlates.ts`, его шапка): заявки, видеочат и эфир.
//     Закреп — `pinnedMessage.solid.tsx`, цикл `setupPinnedMessageForPeer`/
//     `revealPreparedPinnedMessage` (`:1256-1381`) 1:1; скрытие плашки — `isPinnedMessagesHidden`
//     (`core/pinnedMessages.ts`) вместо `appState.hiddenPinnedMessages`.
//  3. `chat.isPreview`, `ChatType.Search` (`resetSearch`), монофорум, `autoDeletePeriod`
//     аватарки, `welcome_*`, ветка заголовка `Welcome` — предметов нет. Заголовок
//     экрана закрепов (`:1557-1585`) — счёт `core/pinnedMessages.ts::getPinnedMessage`. Тема форума
//     (заголовок `wrapPeerTitle({threadId})`, аватар `avatarNew({threadId})`, статус
//     `TopicProfileStatus` `:1736-1742`) — тема приходит не из кэша, а ручкой списка тем
//     (`loadForumTopic`). Замка закрытой темы в шапке у tweb нет (`pFlags.closed` темы
//     шапка не читает) — его рисовал прежний React `ChatHeader`, в порт он не идёт.
//  4. Статус — `appImManager.setPeerStatus` (блок L, его расхождения Н1–Н6). Поводы
//     перерисовки — зеркала, а не события: набор и присутствие — `chatsStore.typing`/
//     `presence` (вместо `peer_typings`/`user_update`), карточка — `peerCache`.
//  5. Счёт истории (`historyStorage.count`, `createEffect` в `messagesCounter`) — зеркало
//     `messagesMirror.mirrorHistoryCount` с подпиской `subscribeMirror`. Пока счёт не
//     объявлен, счётчик показывает `Loading` во всех ветках (у tweb — только у «Избранного»
//     и комментариев, `displayLoading`/`:1590-1594`), поэтому параметра `displayLoading` нет.
//  6. Бейдж «назад» (`folder_unread` по `FOLDER_ID_ALL`, `:1066-1076`) — подписка на
//     `chatsStore.dialogs` и `countUnmutedUnreadPeers` (`client/appBadge.ts`, тот же
//     подсчёт, что у бейджа приложения): события `folder_unread` у нас нет.
//  7. Данные пунктов — синхронно из зеркал главного потока, а не RPC менеджеров:
//     диалог — `chatsStore.dialogs` (`getDialogOnly`), мьют без учёта типа чата
//     (`isPeerLocalMuted({respectType: false})`) — `isPeerMuted(dialog.notify_settings)`,
//     полная карточка — `chat.fullPeer()` (`getCachedFullUser`/`getCachedFullChat`),
//     пир — `cachedPeer` (`chat.peer`). Мьют и снятие мьюта — `groups.setMute`, попап —
//     vanilla `PopupMute` (ВРЕМЕННО до 2C-7, как `dialogsContextMenu.ts`). Жалоба —
//     `showPeerReport` (`popups/reportAd.bridge.ts`, ВРЕМЕННО до 2C-27: React `ReportPopup`
//     острова оверлеев).
//  8. Мьют темы форума (`isPeerLocalMuted({threadId})`, `togglePeerMute({threadId})`) — ручки
//     мьюта темы нет (`groups.setMute` глушит весь чат), поэтому в теме (`threadId`) пунктов
//     «Без звука»/«Со звуком» нет (Б-85).
//     «Удалить» у «Избранного» (`ChatType.Saved` и свой пир) не показывается — удаления
//     истории вместе с диалогом на бэкенде нет (О-89; так же `dialogsContextMenu.ts`).
//     Удаление темы/сохранённого диалога (`threadId` в `showDeleteDialogPopup`) — О-3.
//  9. Подсказка «Chat.Menu.Hint» после «Выбрать сообщения» помнится настройкой
//     `chatContextMenuHintWasShown` нашего `useSettingsStore` (tweb `appSettings`).
// 10. Кнопки звонка (расхождения З1, З3 блока H `lib/appImManager.ts`): `call_active` —
//     идущий видеочат или эфир чата из сторов звонков (`groupCallStore.activeByChat`,
//     `livestreamStore.activeByChat`), `groupCallsController.groupCall` — `groupCallStore.peerId`,
//     `rtmp_stream` звонка — `livestreamStore.activeByChat`, `manage_call` —
//     `hasRights(chat, 'just_admin')`, `IS_GROUP_CALL_SUPPORTED` — `IS_CALL_SUPPORTED` (оба
//     движка просят у браузера одно и то же), `getCachedFullUser` — `cachedPeerFull`.
//     Поводы перепроверки: `peer_full_update` — зеркало полных карточек, `chat_update` —
//     зеркало кратких, а смена `call_active` (у tweb едет в `chat_update`) — подписка на
//     сторы звонков. Пункт меню «Stream With...» (`showRtmpStartStreamPopup`) — нет попапа
//     (`StreamSettingsPopup` снят на К-3, Б-18), в меню эфира только «Начать видеочат».
//     Пункты ⋮ проверяет `ButtonMenuToggle` (`verify` пункта), поэтому `buttonsToVerify` —
//     только кнопки звонка.
import type { AppSidebarRight } from '@components/sidebarRight'
import AppStatisticsTab from '@components/sidebarRight/tabs/statistics.solid'
import { canViewStatistics } from '@core/chatFullCache'
import { RIGHT_COLUMN_ACTIVE_CLASSNAME } from '@components/sidebarRight'
import type { Managers } from '@/client/bootstrap'
import { LEFT_COLUMN_ACTIVE_CLASSNAME } from '@lib/appImManager'
import mediaSizes, { ScreenSize } from '@core/dom/mediaSizes'
import rootScope from '@lib/rootScope'
import ButtonIcon from '@components/buttonIcon'
import ButtonMenuToggle from '@components/buttonMenuToggle'
import ButtonMenu, { type ButtonMenuItemOptionsVerifiable } from '@components/buttonMenu'
import createSubmenuTrigger from '@components/createSubmenuTrigger'
import Icon from '@components/icon'
import { createAutoDeleteIcon } from '@components/autoDeleteIcon'
import { getDefaultOptions } from '@components/sidebarLeft/tabs/autoDeleteMessages/options'
import ListenerSetter from '@helpers/listenerSetter'
import PeerTitle from '@components/chat/peerTitle'
import I18n, { i18n, type LangPackKey } from '@lib/langPack'
import findUpClassName from '@helpers/dom/findUpClassName'
import blurActiveElement from '@helpers/dom/blurActiveElement'
import cancelEvent from '@helpers/dom/cancelEvent'
import { attachClickEvent } from '@helpers/dom/clickEvent'
import replaceContent from '@helpers/dom/replaceContent'
import { toastNew } from '@components/toast'
import { avatarNew, findUpAvatar } from '@components/avatar'
import { getMiddleware, type Middleware, type MiddlewareHelper } from '@helpers/middleware'
import setBadgeContent from '@helpers/setBadgeContent'
import createBadge from '@helpers/createBadge'
import formatNumber from '@helpers/number/formatNumber'
import { useChatsStore } from '@stores/chatsStore'
import { showPeerReport } from '@components/popups/reportAd.bridge'
import { useSettingsStore } from '@/settings'
import { countUnmutedUnreadPeers } from '@/client/appBadge'
import { cachedChat, cachedPeer, subscribePeerMirror } from '@core/peerCache'
import { isUser, toPeerId } from '@core/peers/peerId'
import { RT } from '@core/realtime/events'
import { getLinkedChatPeerId } from '@core/peers/peer'
import { isPeerMuted } from '@core/dialogs/notifySettings'
import canClearHistory from '@core/peers/canClearHistory'
import canReportBot from '@core/peers/canReportBot'
import { getDeleteButtonText } from '@core/peers/dialogType'
import { isBroadcast } from '@core/peers/predicates'
import { hasRights } from '@core/peers/rights'
import { cachedPeerFull, subscribeChatFullMirror } from '@core/chatFullCache'
import IS_CALL_SUPPORTED from '@environment/callSupport'
import { useGroupCallStore } from '@stores/groupCallStore'
import { useLivestreamStore } from '@stores/livestreamStore'
import type { CallType } from '@lib/calls/types'
import { mirrorHistoryCount, subscribeMirror, winKey } from '@core/history/messagesMirror'
import PopupElement from '@components/popups/popupElement'
import PopupMute from '@components/popups/popupMute'
import { confirmationPopup } from '@components/popups/popupPeer'
import showDeleteDialogPopup from '@components/popups/deleteDialog'
import clearHistoryWithConfirmation from '@components/clearHistory'
import { AppEditContactTab } from '@components/solidJsTabs/tabs'
import { createTopbarPlates, type TopbarPlates } from './topbarPlates'
import createChatPinnedMessage, { type ChatPinnedMessageController } from './pinnedMessage.solid'
import { getPinnedMessage, isPinnedMessagesHidden } from '@core/pinnedMessages'
import { untrack } from 'solid-js'
import type { TopicIconSource } from '@components/topicAvatar'
import type { TopbarPlateController } from './topbarPlate.solid'
import type Chat from './chat'
import { ChatType } from './chatType'

type ButtonToVerify = { element: HTMLElement, verify: () => boolean | Promise<boolean> }

/** `chat.pFlags.call_active` (расхождение 10): идёт видеочат или эфир. */
function isCallActive(peerId: PeerId) {
  return !!useGroupCallStore.getState().activeByChat[peerId]?.length ||
    !!useLivestreamStore.getState().activeByChat[peerId]
}

export default class ChatTopbar {
  public container!: HTMLDivElement
  public floatingPlatesWrapper!: HTMLDivElement
  private btnBack!: HTMLButtonElement
  private btnBackBadge!: HTMLElement
  private chatInfo!: HTMLDivElement
  private avatar?: ReturnType<typeof avatarNew>
  private avatarMiddlewareHelper?: MiddlewareHelper
  private title!: HTMLDivElement
  private subtitle!: HTMLDivElement
  private chatUtils!: HTMLDivElement
  private btnSearch?: HTMLButtonElement
  private btnMore?: HTMLElement

  private autoDeleteBtnMenuOptions!: ButtonMenuItemOptionsVerifiable
  /** The chat's own Delete, whose text depends on what the chat is (Delete Group, Leave Channel…). */
  private deleteChatBtnMenuOptions?: ButtonMenuItemOptionsVerifiable

  public plates?: TopbarPlates
  public pinnedMessage?: ChatPinnedMessageController

  public listenerSetter: ListenerSetter

  private menuButtons: ButtonMenuItemOptionsVerifiable[]
  private btnCall!: HTMLButtonElement
  private btnGroupCall!: HTMLButtonElement
  private btnGroupCallMenu!: HTMLElement
  private buttonsToVerify: ButtonToVerify[]
  private chatInfoContainer!: HTMLDivElement
  private person!: HTMLDivElement

  private titleMiddlewareHelper?: MiddlewareHelper
  private status?: ReturnType<ChatTopbar['createStatus']>
  /** Б-57: тема форума открытого чата — см. `loadForumTopic` */
  private forumTopic?: TopicIconSource

  constructor(
    private chat: Chat,
    public appSidebarRight: AppSidebarRight,
    private managers: Managers,
  ) {
    this.listenerSetter = new ListenerSetter()

    this.menuButtons = []
    this.buttonsToVerify = []
  }

  public construct() {
    this.container = document.createElement('div')
    this.container.classList.add('sidebar-header', 'topbar', 'hide')
    this.container.dataset.floating = '0'

    this.btnBack = ButtonIcon('left sidebar-close-button', { noRipple: true, ariaLabel: 'Close' })
    this.btnBackBadge = createBadge('span', 20, 'primary')
    this.btnBackBadge.classList.add('back-unread-badge')
    this.btnBack.append(this.btnBackBadge)

    // * chat info section
    this.chatInfoContainer = document.createElement('div')
    this.chatInfoContainer.classList.add('chat-info-container')

    this.chatInfo = document.createElement('div')
    this.chatInfo.classList.add('chat-info')

    const person = this.person = document.createElement('div')
    person.classList.add('person')

    const content = document.createElement('div')
    content.classList.add('content')

    const top = document.createElement('div')
    top.classList.add('top')

    this.title = document.createElement('div')
    this.title.classList.add('user-title')

    top.append(this.title)

    const bottom = document.createElement('div')
    bottom.classList.add('bottom')

    if(this.subtitle) {
      bottom.append(this.subtitle)
    }

    content.append(top, bottom)

    person.append(content)
    this.chatInfo.append(person)

    // * chat utils section
    this.chatUtils = document.createElement('div')
    this.chatUtils.classList.add('chat-utils')

    this.plates = createTopbarPlates(this, this.chat)

    if(this.menuButtons.length) {
      this.btnMore = ButtonMenuToggle({
        buttonOptions: { ariaLabel: 'MultiAccount.More' },
        listenerSetter: this.listenerSetter,
        direction: 'bottom-left',
        buttons: this.menuButtons,
        positionPadding: { top: 7 },
        onOpenBefore: () => {
          const hasAutoDeleteButton = this.chat.canManageAutoDelete()
          if(!hasAutoDeleteButton) return

          const period = this.chat.getAutoDeletePeriod()
          this.autoDeleteBtnMenuOptions.iconElement = createAutoDeleteIcon(period)
        },
        onOpen: () => {
          const deleteButton = this.deleteChatBtnMenuOptions
          if(deleteButton?.element) {
            const deleteButtonText = getDeleteButtonText(this.peerId)
            deleteButton.element.lastChild!.replaceWith(i18n(deleteButtonText))
          }

          this.autoDeleteBtnMenuOptions.onOpen?.()
        },
        onClose: () => {
          this.autoDeleteBtnMenuOptions.onClose?.()
        },
      })
    }

    this.chatUtils.append(...[
      this.btnCall,
      this.btnGroupCall,
      this.btnGroupCallMenu,
      this.btnSearch,
      this.btnMore,
    ].filter(Boolean) as HTMLElement[])

    this.pushButtonToVerify(this.btnCall, this.verifyCallButton.bind(this, 'voice'))
    this.pushButtonToVerify(this.btnGroupCall, this.verifyVideoChatButton.bind(this, 'nonadmin'))
    this.pushButtonToVerify(this.btnGroupCallMenu, this.verifyRtmpButton.bind(this))

    this.chatInfoContainer.append(this.btnBack, this.chatInfo, this.chatUtils)
    this.container.append(this.chatInfoContainer)

    this.floatingPlatesWrapper = document.createElement('div')
    this.floatingPlatesWrapper.classList.add('topbar-floating-plates', 'hide')
    this.container.append(this.floatingPlatesWrapper)

    // the pinned plate is prepended here by `revealPreparedPinnedMessage`, in the
    // same frame as the bubbles it belongs to

    this.plates.mount(this.floatingPlatesWrapper)

    // * construction end

    // * fix topbar overflow section

    this.listenerSetter.add(window)('resize', this.onResize)
    this.listenerSetter.add(mediaSizes)('changeScreen', this.onChangeScreen)

    this.updateBackBadge()

    attachClickEvent(this.container, (e) => {
      if(
        findUpClassName(e.target!, 'topbar-search-container') ||
        !(e.target as HTMLElement).isConnected ||
        findUpClassName(e.target!, 'chat-search-top')
      ) {
        return
      }

      const container = findUpClassName(e.target!, 'pinned-container')
      blurActiveElement()
      if(container) {
        return
      } else {
        const avatar = findUpAvatar(e.target!)
        if(mediaSizes.activeScreen === ScreenSize.medium && document.body.classList.contains(LEFT_COLUMN_ACTIVE_CLASSNAME)) {
          onBtnBackClick()
        } else if(avatar) {
          if(avatar.classList.contains('has-stories')) {
            return
          }

          void this.appSidebarRight.toggleSidebar(!document.body.classList.contains(RIGHT_COLUMN_ACTIVE_CLASSNAME))
        } else {
          void this.appSidebarRight.toggleSidebar(true)
        }
      }
    }, { listenerSetter: this.listenerSetter })

    const onBtnBackClick = (e?: Event) => {
      if(e) {
        cancelEvent(e)
      }

      this.chat.pop()
    }

    attachClickEvent(this.btnBack, onBtnBackClick, { listenerSetter: this.listenerSetter })
  }

  // * `getDialogOnly` (расхождение 7)
  private getDialog() {
    return useChatsStore.getState().dialogs.find((dialog) => dialog.peerId === this.peerId)
  }

  private verifyIfCanReportChat = () => {
    if(
      this.chat.type !== ChatType.Chat ||
      this.chat.threadId
    ) {
      return false
    }

    const peer = cachedPeer(this.peerId)
    if(peer?._ === 'user') {
      return canReportBot(peer)
    }

    return !!peer && (peer._ === 'chat' || peer._ === 'channel') && !peer.pFlags?.creator
  }

  private verifyIfCanClearHistory = () => {
    if(
      this.chat.type !== ChatType.Chat ||
      this.chat.threadId ||
      this.chat.monoforumThreadId
    ) {
      return false
    }

    return canClearHistory(cachedPeer(this.peerId)) &&
      !!this.getDialog()
  }

  private verifyIfCanDeleteChat = () => {
    // расхождение 8: `ChatType.Saved` → `true` у tweb
    if(this.peerId === rootScope.myId) return false

    return (
      this.chat.type === ChatType.Chat &&
      !this.chat.threadId && // расхождение 8 (О-3)
      !!this.getDialog()
    )
  }

  /** tweb `:462-902` — расхождение 1. */
  public constructUtils() {
    this.autoDeleteBtnMenuOptions = createSubmenuTrigger({
      options: {
        text: 'AutoDeleteMessagesShort',
        separatorDown: true,
        verify: this.chat.canManageAutoDelete,
      },
      createSubmenu: this.createAutoDeleteSubmenu.bind(this),
      direction: 'left-start',
    })

    this.menuButtons = [this.autoDeleteBtnMenuOptions, {
      icon: 'search',
      text: 'Search',
      onClick: () => {
        this.chat.initSearch()
      },
      verify: () => mediaSizes.isMobile,
    }, {
      icon: 'mute',
      text: 'ChatList.Context.Mute',
      onClick: this.onMuteClick,
      verify: () => this.chat.type === ChatType.Chat && !this.chat.monoforumThreadId && !this.chat.threadId && rootScope.myId !== this.peerId && !this.isPeerLocalMuted(),
    }, {
      icon: 'unmute',
      text: 'ChatList.Context.Unmute',
      onClick: this.onUnmuteClick,
      verify: () => this.chat.type === ChatType.Chat && !this.chat.monoforumThreadId && !this.chat.threadId && rootScope.myId !== this.peerId && this.isPeerLocalMuted(),
    }, {
      icon: 'comments',
      text: 'ViewDiscussion',
      onClick: () => {
        const linkedPeerId = this.getLinkedChatPeerId()
        if(linkedPeerId) {
          void this.chat.appImManager.setInnerPeer({
            peerId: linkedPeerId,
          })
        }
      },
      verify: () => this.chat.type === ChatType.Chat && !!this.getLinkedChatPeerId(),
    }, {
      icon: 'select',
      text: 'Chat.Menu.SelectMessages',
      onClick: () => {
        const selection = this.chat.selection
        selection.toggleSelection(true, true)
        // расхождение 9
        if(useSettingsStore.getState().chatContextMenuHintWasShown) {
          return
        }

        const original = selection.toggleByElement
        selection.toggleByElement = (bubble, selected) => {
          useSettingsStore.getState().update({ chatContextMenuHintWasShown: true })
          toastNew({ langPackKey: 'Chat.Menu.Hint' })

          selection.toggleByElement = original
          selection.toggleByElement(bubble, selected)
        }
      },
      verify: () => !this.chat.selection.isSelecting && !!this.chat.bubbles.getRenderedLength(),
    }, {
      icon: 'select',
      text: 'Chat.Menu.ClearSelection',
      onClick: () => {
        this.chat.selection.cancelSelection()
      },
      verify: () => this.chat.selection.isSelecting,
    }, {
      icon: 'adduser',
      text: 'AddContact',
      onClick: () => {
        this.addContact()
      },
      verify: async() => !this.chat.isBot && isUser(this.peerId) && this.peerId !== rootScope.myId && !(await this.managers.contacts.isContact(this.peerId)),
    }, {
      // tweb `:682-689`; `monoforumThreadId` — монофорума у нас нет (О-4)
      icon: 'statistics_chart',
      text: 'Statistics',
      onClick: () => {
        void this.appSidebarRight.createTab(AppStatisticsTab).open(this.peerId)
        void this.appSidebarRight.toggleSidebar(true)
      },
      verify: () => canViewStatistics(this.peerId),
    }, {
      icon: 'lock',
      text: 'BlockUser',
      onClick: () => {
        void this.blockUser()
      },
      verify: () => {
        if(!isUser(this.peerId)) return false
        const userFull = this.getFullUser()
        return this.peerId !== rootScope.myId && !!userFull && !userFull.pFlags?.blocked
      },
    }, {
      icon: 'lockoff',
      text: 'Unblock',
      onClick: () => {
        void this.managers.privacy.toggleBlock(this.peerId, false).then(() => {
          toastNew({ langPackKey: 'UserUnblocked' })
        })
      },
      verify: () => !!this.getFullUser()?.pFlags?.blocked,
    }, {
      icon: 'flag',
      text: 'ReportChat',
      onClick: () => {
        showPeerReport(this.peerId)
      },
      verify: this.verifyIfCanReportChat,
    }, {
      icon: 'message_crossed',
      text: 'ClearHistory',
      onClick: () => {
        void clearHistoryWithConfirmation({ peerId: this.peerId, managers: this.managers })
      },
      verify: this.verifyIfCanClearHistory,
    }, {
      icon: 'delete',
      danger: true,
      text: 'Delete',
      onClick: () => {
        showDeleteDialogPopup(this.peerId, this.managers)
      },
      verify: this.verifyIfCanDeleteChat,
    }]
    this.deleteChatBtnMenuOptions = this.menuButtons[this.menuButtons.length - 1]

    this.btnSearch = ButtonIcon('search', { ariaLabel: 'Search' })
    this.attachClickEvent(this.btnSearch, () => {
      this.chat.initSearch()
    }, true)
  }

  // * `appNotificationsManager.isPeerLocalMuted({respectType: false})` (расхождение 7)
  private isPeerLocalMuted() {
    return isPeerMuted(this.getDialog()?.notify_settings, Math.floor(Date.now() / 1000))
  }

  private getFullUser() {
    const fullPeer = this.chat.fullPeer()
    return fullPeer?._ === 'userFull' ? fullPeer : undefined
  }

  private getLinkedChatPeerId() {
    const fullPeer = this.chat.fullPeer()
    return fullPeer?._ === 'channelFull' ? getLinkedChatPeerId(fullPeer) : undefined
  }

  /** tweb `:904-910` */
  public addContact() {
    if(!this.appSidebarRight.isTabExists(AppEditContactTab)) {
      void this.appSidebarRight.createTab(AppEditContactTab).open(this.peerId)

      void this.appSidebarRight.toggleSidebar(true)
    }
  }

  /**
   * tweb `:921-959` без чекбоксов `showReport`/`showDelete`: их передаёт плашка
   * настроек пира (`actions.tsx`), которой у нас нет (`topbarPlates.ts`).
   */
  public async blockUser() {
    const peerId = this.peerId
    const middlewareHelper = getMiddleware()
    try {
      await confirmationPopup({
        peerId,
        managers: this.managers,
        titleLangKey: 'BlockUser',
        descriptionLangKey: 'AreYouSureBlockContact2',
        descriptionLangArgs: [new PeerTitle({ peerId, middleware: middlewareHelper.get(), managers: this.managers }).element],
        button: {
          langKey: 'BlockUser',
          isDanger: true,
        },
      })
    } catch{
      return
    } finally {
      middlewareHelper.destroy()
    }

    await this.managers.privacy.toggleBlock(peerId, true)

    toastNew({ langPackKey: 'UserBlocked' })
  }

  /** tweb `:961-967` */
  public attachClickEvent(el: HTMLElement, cb: (e: Event) => void, noBlur?: boolean) {
    attachClickEvent(el, (e) => {
      cancelEvent(e)
      if(!noBlur) blurActiveElement()
      cb(e)
    }, { listenerSetter: this.listenerSetter })
  }

  private pushButtonToVerify(element: HTMLElement, verify: ButtonToVerify['verify']) {
    if(!element) {
      return
    }

    element.classList.add('hide')
    this.buttonsToVerify.push({ element, verify })
  }

  /** tweb `:318-338`; `menuButtons` ⋮ — П-5 (расхождение 1). */
  private verifyButtons = (e?: Event) => {
    if(e) cancelEvent(e)

    const r = async() => {
      const buttons = this.buttonsToVerify
      const results = await Promise.all(buttons.map(async(button) => {
        return {
          result: await button.verify(),
          button,
        }
      }))

      results.forEach(({ button, result }) => {
        button.element?.classList.toggle('hide', !result)
      })
    }

    void r()
  }

  /** tweb `:340-362` — расхождение 10. */
  private verifyRtmpButton = () => {
    if(!this.chat.isBroadcast || this.chat.type !== ChatType.Chat) {
      return false
    }

    if(useGroupCallStore.getState().peerId === this.peerId) {
      return false
    }

    const chat = cachedChat(this.peerId)
    if(!chat) {
      return false
    }

    if(isCallActive(this.peerId)) {
      return false
    }

    return hasRights(chat, 'just_admin')
  }

  /** tweb `:364-407` — расхождение 10. */
  public verifyVideoChatButton = (type?: 'group' | 'broadcast' | 'nonadmin') => {
    if(
      !IS_CALL_SUPPORTED ||
      isUser(this.peerId) ||
      this.chat.type !== ChatType.Chat ||
      this.chat.threadId
    ) return false

    if(useGroupCallStore.getState().peerId === this.peerId) {
      return false
    }

    if(type) {
      if(((type === 'group' && !this.chat.isAnyGroup)) ||
        ((type === 'broadcast' && !this.chat.isBroadcast))) {
        return false
      }
    }

    const chat = cachedChat(this.peerId)
    const canManageCall = hasRights(chat, 'just_admin')
    if(type === 'nonadmin' && canManageCall && isBroadcast(chat)) {
      return false // * hide live stream top button
    }
    const needActiveCall = !canManageCall
    if(!isCallActive(this.peerId)) {
      return !needActiveCall
    }

    // * `groupCall.pFlags.rtmp_stream`
    return !useLivestreamStore.getState().activeByChat[this.peerId]
  }

  /** tweb `:409-415` — расхождение 10. */
  public verifyCallButton = (type?: CallType) => {
    if(!IS_CALL_SUPPORTED || !isUser(this.peerId) || this.chat.type !== ChatType.Chat) return false
    const userFull = cachedPeerFull(this.peerId)

    return userFull?._ === 'userFull' && !!(type === 'voice' ? userFull.pFlags?.phone_calls_available : userFull.pFlags?.video_calls_available)
  }

  /** tweb `:969-971` */
  public onCallClick(type: CallType) {
    void this.chat.appImManager.callUser(this.peerId, type)
  }

  /** tweb `:996-998` */
  public onJoinGroupCallClick = () => {
    void this.chat.appImManager.joinGroupCall(this.peerId)
  }

  private get peerId() {
    return this.chat.peerId
  }

  public constructPeerHelpers() {
    this.subtitle = document.createElement('div')
    this.subtitle.classList.add('info')

    this.btnCall = ButtonIcon('phone', { ariaLabel: 'Call' })
    this.btnGroupCall = ButtonIcon('videochat', { ariaLabel: 'PeerInfo.Action.VoiceChat' })
    this.btnGroupCallMenu = ButtonMenuToggle({
      buttonOptions: { ariaLabel: 'PeerInfo.Action.VoiceChat' },
      listenerSetter: this.listenerSetter,
      direction: 'bottom-left',
      buttons: [{
        icon: 'videochat',
        text: 'Rtmp.Topbar.StartVideoChat',
        onClick: this.onJoinGroupCallClick,
      }],
      icon: 'videochat',
    })
    this.attachClickEvent(this.btnCall, this.onCallClick.bind(this, 'voice'))
    this.attachClickEvent(this.btnGroupCall, this.onJoinGroupCallClick)

    // расхождение 6: `folder_unread` по папке «Все»
    this.listenerSetter.addCleanup(useChatsStore.subscribe((state, prev) => {
      if(state.dialogs !== prev.dialogs) {
        this.updateBackBadge()
      }
    }))

    // tweb :1134-1147
    this.chat.addEventListener('setPeer', (mid, isTopMessage) => {
      const middleware = this.chat.bubbles.getMiddleware()
      if(!middleware() || !this.pinnedMessage) return

      this.pinnedMessage.setUserHidden(isPinnedMessagesHidden(this.chat.peerId, this.chat.threadId))

      if(isTopMessage) {
        this.pinnedMessage.unsetScrollDownListener()
        this.pinnedMessage.testMid(mid, 0) // * because slider will not let get bubble by document.elementFromPoint
      } else if(!this.pinnedMessage.isLocked()) {
        void this.pinnedMessage.handleFollowingPinnedMessage()
        this.pinnedMessage.testMid(mid)
      }
    })

    // tweb :1149-1157
    this.listenerSetter.add(rootScope)('peer_pinned_messages', ({ peerId, mids }) => {
      if(this.chat.type !== ChatType.Pinned || peerId !== this.peerId) {
        return
      }

      if(mids) {
        this.setTitle()
      }
    })

    // * `chat_update` (`:1081-1090`) — расхождение 10
    let chat = cachedChat(this.peerId)
    this.listenerSetter.addCleanup(subscribePeerMirror(() => {
      const newChat = cachedChat(this.peerId)
      if(newChat === chat) {
        return
      }

      chat = newChat
      if(!isBroadcast(chat)) {
        return
      }

      this.verifyButtons()
    }))

    // * `peer_full_update` (`:1092-1096`) — расхождение 10
    let full = cachedPeerFull(this.peerId)
    this.listenerSetter.addCleanup(subscribeChatFullMirror(() => {
      const newFull = cachedPeerFull(this.peerId)
      if(newFull === full) {
        return
      }

      full = newFull
      this.verifyButtons()
    }))

    // * `:1098-1115`
    this.listenerSetter.add(rootScope)(RT.chatRequests, ({ chatId, recentRequesters, requestsPending }) => {
      if(this.peerId !== toPeerId(chatId as number, true)) {
        return
      }

      const middleware = this.chat.bubbles.getMiddleware()
      void this.plates!.requests.set(
        this.peerId,
        recentRequesters.map((userId) => toPeerId(userId as number, false)),
        requestsPending,
      ).then((callback) => {
        if(!middleware()) {
          return
        }

        callback()
      })
    })

    // * `call_active` чата — расхождение 10
    const onCallsChange = <T extends { activeByChat: Record<number, unknown> }>(state: T, prev: T) => {
      if(state.activeByChat[this.peerId] !== prev.activeByChat[this.peerId]) {
        this.verifyButtons()
      }
    }
    this.listenerSetter.addCleanup(useGroupCallStore.subscribe((state, prev) => {
      if(state.peerId !== prev.peerId) {
        this.verifyButtons()
        return
      }

      onCallsChange(state, prev)
    }))
    this.listenerSetter.addCleanup(useLivestreamStore.subscribe(onCallsChange))

    return this
  }

  /** tweb `:1177-1187` */
  public openPinned(byCurrent: boolean) {
    const currentMid = byCurrent ? +this.pinnedMessage!.container.dataset.mid! : 0
    void this.chat.appImManager.setInnerPeer({
      peerId: this.peerId,
      // the pinned list is per-topic in a forum — without the thread the tab
      // would list every pin of the forum instead of this topic's
      threadId: this.chat.threadId,
      lastMsgId: currentMid || 0,
      type: ChatType.Pinned,
    })
  }

  private updateBackBadge() {
    if(!this.btnBackBadge) {
      return
    }

    const size = countUnmutedUnreadPeers(useChatsStore.getState().dialogs)
    setBadgeContent(this.btnBackBadge, size ? '' + formatNumber(size, 1) : '')
  }

  /** tweb `:1220-1222` — ВРЕМЕННО до 2C-7: `showMutePopup(peerId)` — vanilla `PopupMute` */
  private onMuteClick = () => {
    const peerId = this.peerId
    PopupElement.createPopup(PopupMute, peerId, this.managers, (seconds) => {
      const until = seconds ? Math.floor(Date.now() / 1000) + seconds : undefined
      void this.managers.groups.setMute(peerId, true, until)
    })
  }

  /** tweb `:1224-1226` */
  private onUnmuteClick = () => {
    void this.managers.groups.setMute(this.peerId, false)
  }

  private onResize = () => {
    this.setFloating()
  }

  private onChangeScreen = () => {
    this.onResize()
  }

  public destroy() {
    this.listenerSetter.removeAll()

    this.status?.destroy()
    this.titleMiddlewareHelper?.destroy()
    this.avatarMiddlewareHelper?.destroy()
    this.pinnedMessage?.destroy()
    this.plates?.destroy()

    this.pinnedMessage = undefined
    this.plates = undefined
  }

  public cleanup() {
    if(!this.chat.peerId) {
      this.container.classList.add('hide')
    }
  }

  /** tweb `:1256-1263` */
  private appendPinnedMessage(pinnedMessage: ChatPinnedMessageController) {
    const container = pinnedMessage.container
    if(this.pinnedMessage && this.pinnedMessage !== pinnedMessage) {
      this.pinnedMessage.container.replaceWith(container)
    } else {
      this.floatingPlatesWrapper.prepend(container)
    }
  }

  private pinnedMessageSetupForKey: string | undefined
  /**
   * Plate swap deferred from `setupPinnedMessageForPeer` until the
   * bubbles-mount moment (tweb :1265-1278): `kind='install'` carries a detached
   * new plate and (optionally) a `prepareInitialPromise`; `kind='destroy'` means
   * the new peer has no plate, but the old one must stay visible until bubbles swap.
   */
  private pendingPinnedSetup:
    | { kind: 'install', newPlate: ChatPinnedMessageController, prepareInitialPromise?: Promise<void> }
    | { kind: 'destroy' }
    | null = null

  /**
   * tweb `:1280-1354` — подготовить плашку закрепа для текущего пира, не трогая DOM;
   * применяет `revealPreparedPinnedMessage` вместе с баблами. Скрытие плашки — наш
   * `isPinnedMessagesHidden` (`appState.hiddenPinnedMessages` оригинала).
   */
  public setupPinnedMessageForPeer(): Promise<void> | undefined {
    const peerId = this.chat.peerId
    const threadId = this.chat.threadId
    // The pinned list is per-topic in a forum, and on mobile the same chat
    // instance is reused across peer changes — keying on peerId alone would
    // keep the previous topic's plate on a topic switch.
    const setupKey = peerId + (threadId ? '_' + threadId : '')
    if(this.pinnedMessageSetupForKey === setupKey) {
      return this.pendingPinnedSetup?.kind === 'install' ?
        this.pendingPinnedSetup.prepareInitialPromise :
        undefined
    }
    this.pinnedMessageSetupForKey = setupKey

    // Drop an orphaned pending plate from an even earlier peer change.
    if(this.pendingPinnedSetup?.kind === 'install') {
      this.pendingPinnedSetup.newPlate.destroy()
    }
    this.pendingPinnedSetup = null

    const isPinnedMessagesNeeded = this.chat.isPinnedMessagesNeeded()
    const wantsPlate = isPinnedMessagesNeeded || this.chat.type === ChatType.Discussion
    if(!wantsPlate) {
      if(this.pinnedMessage) {
        this.pendingPinnedSetup = { kind: 'destroy' }
      }
      return
    }

    const newPlate = createChatPinnedMessage(this, this.chat, this.managers)
    let prepareInitialPromise: Promise<void> | undefined

    if(this.chat.type === ChatType.Discussion) {
      newPlate.setStaticMessage(this.chat.threadId!)
    } else {
      newPlate.setUserHidden(isPinnedMessagesHidden(peerId, threadId))
      const savedPosition = this.chat.appImManager.getChatSavedPosition(this.chat)
      const cachedFull = untrack(() => this.chat.fullPeer())
      // `pinned_msg_id` is peer-scoped. In a forum topic the pinned list is
      // per-topic, so seeding from it would paint a foreign pin.
      const pinnedMessageId = !threadId && cachedFull && 'pinned_msg_id' in cachedFull ?
        cachedFull.pinned_msg_id :
        undefined
      const hint = savedPosition?.pinnedMessages ||
        (pinnedMessageId ? { mid: pinnedMessageId, index: 0, count: 1 } : undefined)
      if(hint) {
        prepareInitialPromise = newPlate.prepareInitial(hint)
      }
    }

    this.pendingPinnedSetup = { kind: 'install', newPlate, prepareInitialPromise }
    return prepareInitialPromise
  }

  /** tweb `:1356-1381` */
  public revealPreparedPinnedMessage() {
    const pending = this.pendingPinnedSetup
    if(!pending) {
      this.pinnedMessage?.revealPrepared()
      return
    }
    this.pendingPinnedSetup = null

    const old = this.pinnedMessage
    if(pending.kind === 'install') {
      this.appendPinnedMessage(pending.newPlate)
      this.pinnedMessage = pending.newPlate
      pending.newPlate.revealPrepared()
    } else {
      this.pinnedMessage = undefined
    }
    old?.destroy()
    this.setFloating()
  }

  /**
   * Б-57: тема форума — у tweb её отдаёт кэш `dialogsStorage.getForumTopic` (заголовок —
   * `wrapPeerTitle({threadId})`, аватар — `avatarNew({threadId})`). Хранилища тем на главном
   * потоке у нас нет: список тем перечитывается ручкой, как у форум-таба
   * (`autonomousDialogList/forumTopics.ts`). Темы нет — заголовок и аватар пира (как у tweb,
   * когда `getForumTopicById` ничего не нашёл, `peerTitle.ts:160-170`).
   */
  private async loadForumTopic(): Promise<TopicIconSource | undefined> {
    const { peerId, threadId } = this.chat
    if(!this.chat.isForumTopic) return

    const topics = await this.managers.groups.listTopics(peerId).catch(() => [])
    const topic = topics.find((topic) => topic.id === threadId)
    return topic && {
      title: topic.title,
      icon_color: topic.iconColor,
      icon_emoji: topic.iconEmoji,
      isGeneral: topic.isGeneral,
    }
  }

  public async finishPeerChange(options: { middleware: () => boolean }) {
    const { peerId, threadId } = this.chat
    const { middleware } = options

    this.forumTopic = await this.loadForumTopic()

    let newAvatar: ChatTopbar['avatar'], newAvatarMiddlewareHelper: ChatTopbar['avatarMiddlewareHelper']
    const isSaved = this.chat.type === ChatType.Saved
    const needArrowBack = this.chat.type === ChatType.Search
    if([ChatType.Chat, ChatType.Static, ChatType.Logs].includes(this.chat.type) || isSaved) {
      const usePeerId = isSaved ? threadId as PeerId : peerId
      const useThreadId = isSaved || !this.forumTopic ? undefined : threadId
      const avatar = this.avatar

      if(
        !avatar ||
        avatar.node.dataset.peerId !== '' + usePeerId ||
        avatar.node.dataset.threadId !== (useThreadId ? '' + useThreadId : undefined) ||
        peerId === rootScope.myId
      ) {
        newAvatar = avatarNew({
          middleware: (newAvatarMiddlewareHelper = getMiddleware()).get(),
          isDialog: true,
          size: 40,
          peerId: usePeerId,
          threadId: useThreadId,
          topic: useThreadId ? this.forumTopic : undefined,
          meAsNotes: isSaved,
          managers: this.managers,
        })
        newAvatar.node.classList.add('person-avatar')
      } else {
        newAvatar = this.avatar
      }
    }

    this.status?.destroy()
    const status = this.status = this.createStatus()

    // `:1429` — подтверждённый ответ плашки заявок: из зеркала (`cached`) колбэк
    // ждём здесь же, иначе плашка снимается и встаёт, когда карточка приедет
    const setRequestsCallback = this.plates!.requests.setPeerId(peerId)
    const [, setTitleCallback, setStatusCallback, , setRequestsCached] = await Promise.all([
      Promise.resolve(newAvatar?.readyThumbPromise),
      this.setTitleManual(),
      Promise.resolve(status?.prepare(true)),
      Promise.resolve(this.setupPinnedMessageForPeer()),
      Promise.resolve(setRequestsCallback.cached ? setRequestsCallback.result : undefined),
    ] as const)

    if(!middleware() && newAvatarMiddlewareHelper) {
      newAvatarMiddlewareHelper.destroy()
    }

    return () => {
      const canHaveSomeButtons = !(this.chat.type === ChatType.Pinned || this.chat.type === ChatType.Scheduled || this.chat.type === ChatType.Welcome || this.chat.type === ChatType.Static || this.chat.type === ChatType.Logs)
      const canHaveSearch = canHaveSomeButtons || this.chat.type === ChatType.Logs

      if(this.btnSearch) {
        this.btnSearch.classList.toggle('hide', !canHaveSearch)
      }

      if(this.avatar !== newAvatar) {
        if(newAvatar) {
          this.person.prepend(newAvatar.node)
        }

        if(this.avatar) {
          this.avatarMiddlewareHelper?.destroy()
          this.avatar.node.remove()
        }

        this.avatar = newAvatar
        this.avatarMiddlewareHelper = newAvatarMiddlewareHelper
        this.container.classList.toggle('has-avatar', !!newAvatar)
      }

      const canHaveMore = canHaveSomeButtons || this.chat.type === ChatType.Logs

      if(this.btnMore) {
        this.btnMore.classList.toggle('hide', !canHaveMore)
      }

      this.revealPreparedPinnedMessage()
      setTitleCallback()
      setStatusCallback?.()

      this.subtitle.classList.toggle('hide', !setStatusCallback)

      this.verifyButtons()

      this.container.classList.remove('hide')

      // `:1505-1507`, `:1522-1528`
      if(!setRequestsCallback.cached) {
        this.plates!.requests.unset(peerId)
        void setRequestsCallback.result.then((callback) => {
          if(!middleware()) {
            return
          }

          callback()
        })
      } else {
        setRequestsCached?.()
      }

      this.plates?.live?.setPeerId(peerId)
      this.plates?.groupCall?.setPeerId(peerId)

      this.container.classList.toggle('show-back-button', needArrowBack)
    }
  }

  public async setTitleManual(count?: number) {
    const { peerId, threadId } = this.chat
    let titleEl: HTMLElement | undefined
    this.titleMiddlewareHelper?.destroy()
    const middlewareHelper = this.titleMiddlewareHelper = getMiddleware()
    const middleware = middlewareHelper.get()
    if(this.chat.type === ChatType.Pinned) {
      if(count === undefined) titleEl = i18n('Loading')
      else titleEl = i18n('PinnedMessagesCount', [count])

      if(count === undefined) {
        // tweb :1562-1584 — счёт берётся у того же поиска закрепов, из которого
        // строится лента экрана (`core/pinnedMessages.ts::getPinnedMessage`)
        void getPinnedMessage(this.managers, peerId, this.chat.threadId).then(({ count }) => {
          if(!middleware()) return
          this.setTitle(count)

          // ! костыль х2, это нужно делать в другом месте
          if(!count) {
            void this.chat.appImManager.setPeer() // * close tab

            // ! костыль, это скроет закреплённые сообщения сразу, вместо того, чтобы ждать пока анимация перехода закончится
            const originalChat = this.chat.appImManager.chat
            if(originalChat.topbar.pinnedMessage) {
              originalChat.topbar.pinnedMessage.setHidden(true)
            }
          }
        })
      }
    } else if(this.chat.type === ChatType.Scheduled) {
      titleEl = i18n(peerId === rootScope.myId ? 'Reminders' : 'ScheduledMessages')
    } else if(this.chat.type === ChatType.Discussion) {
      titleEl = this.messagesCounter({
        middleware,
        key: 'Chat.Title.Comments',
        minusFirst: this.chat.isForum,
      }).element
    } else if(this.chat.type === ChatType.Chat || this.chat.type === ChatType.Saved || this.chat.type === ChatType.Static || this.chat.type === ChatType.Logs) {
      const usePeerId = this.chat.type === ChatType.Saved ? threadId as PeerId : peerId

      titleEl = new PeerTitle({
        peerId: usePeerId,
        dialog: true,
        withIcons: !threadId,
        meAsNotes: this.chat.type === ChatType.Saved,
        topic: this.chat.type === ChatType.Saved ? undefined : this.forumTopic, // Б-57: `threadId`
        middleware,
        managers: this.managers,
      }).element
    }

    // всегда колбэк, не `undefined` (tweb :1617-1619)
    return () => {
      // заголовком уже владеет более новый `setTitleManual` — он погасил нашу зону
      if(!middleware()) {
        return
      }

      replaceContent(this.title, titleEl ?? '')
    }
  }

  public setTitle(count?: number) {
    void this.setTitleManual(count).then((setTitleCallback) => setTitleCallback())
  }

  /** tweb `:1645-1683` */
  public setFloating = () => {
    const containers = [
      this.pinnedMessage,
      ...(this.plates?.all || []),
    ].filter(Boolean) as TopbarPlateController[]
    const TOPBAR_GAP = 8
    const PLATE_DIVIDER = 1

    const visible = containers.filter((container) => container.isVisible())
    const count = visible.length

    // Un-hide the wrapper BEFORE measuring any 'auto' plate height below. The
    // wrapper is `display: none` while no plate is visible (count === 0), and an
    // ancestor's `display: none` zeroes its descendants' offsetHeight.
    this.floatingPlatesWrapper.classList.toggle('hide', count === 0)

    let platesHeight = 0
    for(const container of visible) {
      platesHeight += container.height === 'auto' ? container.container.offsetHeight : container.height
    }

    const floatingHeight = count > 0 ? platesHeight + Math.max(0, count - 1) * PLATE_DIVIDER + TOPBAR_GAP : 0
    const reservedFloatingHeight = this.chat.container.classList.contains('is-search-active') ? 0 : floatingHeight
    this.container.dataset.floating = '' + count
    this.chat.container.style.setProperty(
      '--pinned-floating-height',
      `calc(${reservedFloatingHeight}px + var(--topbar-floating-call-height) + var(--topbar-floating-audio-height))`,
    )
    this.chat.updatePinnedFloatingHeight(reservedFloatingHeight)
  }

  /** Ключ окна этого чата — у tweb `historyStorage` (`chat.getHistoryStorage()`). */
  private get storageKey() {
    return winKey(this.chat.peerId, this.chat.threadId)
  }

  /** tweb `:1685-1716`, расхождение 5. */
  private messagesCounter({
    middleware,
    key,
    minusFirst,
  }: {
    middleware: Middleware,
    key: LangPackKey,
    minusFirst?: boolean
  }) {
    const storageKey = this.storageKey
    let count = mirrorHistoryCount(storageKey)
    const el = new I18n.IntlElement(count === undefined ? {
      key: 'Loading',
    } : {
      key,
      args: [count - (minusFirst ? 1 : 0)],
    })

    middleware.onDestroy(subscribeMirror(() => {
      const newCount = mirrorHistoryCount(storageKey)
      if(newCount === count || newCount === undefined) {
        return
      }

      count = newCount
      el.compareAndUpdate({ key, args: [count - (minusFirst ? 1 : 0)] })
    }))

    return el
  }

  private createStatus() {
    if(!this.subtitle || (this.chat.type !== ChatType.Chat && this.chat.type !== ChatType.Saved)) return
    const middlewareHelper = getMiddleware()
    const middleware = middlewareHelper.get()
    const listenerSetter = new ListenerSetter()

    let prepare: (needClear: boolean) => Promise<(() => void) | undefined>
    if(this.chat.type === ChatType.Saved || this.peerId === rootScope.myId) {
      const el = this.messagesCounter({
        middleware,
        key: 'messages',
      })

      prepare = async() => {
        return () => replaceContent(this.subtitle, el.element)
      }
    } else if(this.chat.threadId) {
      // tweb :1737-1743 — тема форума: «в <группа>»
      prepare = async() => {
        const title = new PeerTitle({ peerId: this.peerId, dialog: true, middleware, managers: this.managers }).element
        const span = i18n('TopicProfileStatus', [title])

        return () => replaceContent(this.subtitle, span)
      }
    } else {
      const peerId = this.peerId

      // * `peer_typings` / `user_update` (расхождение 4)
      listenerSetter.addCleanup(useChatsStore.subscribe((state, prev) => {
        if(state.typing[peerId] !== prev.typing[peerId] || state.presence[peerId] !== prev.presence[peerId]) {
          setAuto()
        }
      }))

      let peer = cachedPeer(peerId)
      listenerSetter.addCleanup(subscribePeerMirror(() => {
        const newPeer = cachedPeer(peerId)
        if(newPeer !== peer) {
          peer = newPeer
          setAuto()
        }
      }))

      const interval = window.setInterval(() => setAuto(), 60e3)

      middleware.onDestroy(() => {
        clearInterval(interval)
      })

      prepare = (needClear) => {
        return this.chat.appImManager.setPeerStatus({
          peerId,
          element: this.subtitle,
          needClear,
          middleware,
          managers: this.managers,
        })
      }
    }

    middleware.onDestroy(() => {
      listenerSetter.removeAll()
    })

    const setAuto = () => {
      void prepare(false).then((callback) => middleware() && callback?.())
    }

    return {
      prepare,
      destroy: () => middlewareHelper.destroy(),
    }
  }

  /** tweb `:1849-1872` — `setAutoDeletePeriodFor` у нас `Chat.setAutoDeletePeriod`. */
  private async createAutoDeleteSubmenu() {
    const options = getDefaultOptions({
      offLabel: () => i18n('Never'),
    })

    const menu = await ButtonMenu({
      buttons: [
        ...options.map((option): ButtonMenuItemOptionsVerifiable => ({
          iconElement: option.value === 0 ? Icon('auto_delete_circle_off') : createAutoDeleteIcon(option.value),
          regularText: option.label(),
          onClick: () => {
            void this.chat.setAutoDeletePeriod(option.value)
          },
        })),
        {
          icon: 'tools',
          text: 'Other',
          onClick: () => this.chat.openAutoDeleteMessagesCustomTimePopup(),
        },
      ],
    })

    return menu
  }
}
