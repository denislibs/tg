// Порт tweb `src/components/chat/input.ts` (812502980, 5718 строк) — класс `ChatInput`,
// строка ввода инстанса чата. Шаг К-4 ускоренного плана волны 7
// (`docs/superpowers/plans/2026-10-02-wave-7-carcass-first.md`): ЯДРО класса.
//
// Что портировано (адреса tweb):
//  - поля и конструктор `:210-482`, `construct` `:487-574`, кнопка «вниз» `:615-627`;
//  - плашка ответа/правки/пересылки: `constructReplyElements` `:629-650` (без меню),
//    `setTopInfo` `:5353-5426`, `clearHelper` `:5265-5317`, `t` `:5319-5330`;
//  - каркас `constructPeerHelpers` `:1055-1682`: меню вложений `:1115-1352` (пункты
//    «Фото или видео», «Файл», «Опрос», «Чек-лист»), кнопка отправки `:1398-1416`,
//    плашка управления `:1576-1681` (бот «Начать», «Без звука» канала);
//  - `setChatListeners` `:1688-1812` в объёме предметов (черновик, смена пира,
//    непрочитанное, удаление сообщений, диалог);
//  - `_center`/`center` `:1886-1970`, `startBot` `:1996`, `getNeededFakeContainer` `:2087`;
//  - черновики: `getCurrentInputAsDraft` `:2271`, `saveDraft` `:2315`, `setDraft` `:2412-2484`;
//  - `destroy`/`cleanup` `:2365-2410`, `finishPeerChange` `:2522-2797`;
//  - ввод: `getPlaceholderParams` `:2959`, `updateMessageInputPlaceholder` `:3020`,
//    `updateMessageInput` `:3048-3092`, высота `:3094-3127`, `attachMessageInputField`
//    `:3129-3167`, `attachMessageInputListeners` `:3177-3328`, `onMessageInput` `:3458-3532`;
//  - отправка: `onBtnSendClick` `:4086`, `onHelperCancel` `:4119`, `onHelperClick` `:4223`,
//    `getReplyTo` `:4301`, `clearInput` `:4310`, `updateSendBtn` `:4390-4442`,
//    `onMessageSent` `:4499`, `sendMessageWithForward` `:4536`, `sendMessage` `:4655`,
//    `sendMessageWithDocument` `:4749`;
//  - правка/пересылка/ответ: `initMessageEditing` `:4859`, `initMessagesForward` `:4963`,
//    `getChatInputReplyToFromMessage` `:5082`, `initMessageReply` `:5099`, `setReplyTo` `:5249`,
//    `setInputValue` `:5332`.
//
// В бэклоге (строки раздела 5 плана): запись голоса и кружков (Б-30), send-as (Б-31),
// меню отправки и расписание (Б-32), тултип разметки (Б-33), автокомплит (Б-34),
// эмодзи-дропдаун (Б-35), клавиатура бота и команды (Б-36), медленный режим и платные
// (Б-37), правка медиа (Б-38), меню плашек и превью ссылки (Б-72), плашки без предмета
// (Б-73).
//
// ОБЪЯВЛЕННЫЕ РАСХОЖДЕНИЯ С ОРИГИНАЛОМ
//  1. Пакет параметров отправки собирает `ChatInput.getMessageSendingParams()`, а не
//     `Chat` (tweb `chat.ts:1378`): в К-4 `chat.ts` правится только в блоке создания
//     ввода (его параллельно держит П-5). Поля пакета — наши (`core/managers/messages/
//     sendingParams.ts`).
//  2. Разметку (`parseMarkdown`) и резку длинного текста (`splitStringByLength` +
//     `sliceMessageEntities`) делает отправка здесь, а не менеджер: у tweb это тело
//     `appMessagesManager.sendText`/`editMessage` (:2670-2683), наш `messages.sendText`
//     шлёт кадр как есть.
//  3. Черновик — поле диалога в зеркале `chatsStore` (`core/dialogs/draft.ts`), а не
//     `appDraftsManager`: чтение — `getDraft`, сохранение — `managers.drafts.save` с
//     отсечкой равных (`syncDraft`), приезд — подписка на зеркало (вместо
//     `draft_updated`). Локальное снятие черновика отправкой (`sendText({clearDraft})`)
//     эмулирует `clearedDraft`: сервер сам снимает черновик после отправки
//     (`clearDraftAfterSend`), а до его кадра зеркало держит прежний. Черновиков тредов
//     нет — у ручки `/chats/{id}/draft` нет `threadId`.
//  4. Канал постит REST-ручкой (`managers.channels.post`), а не `sendText`; первое
//     сообщение пиру без диалога сначала заводит диалог (`managers.chats.createPrivate`) —
//     обе ветки перенесены из снесённого `useChatSend.ts`.
//  5. Права — наш `ChatRights`: `send_plain` → `send_messages`, стикеры/GIF/медиа →
//     `send_media`.
//  6. Кнопки без предмета не строятся: эмодзи (Б-35), подарок, предложенный пост,
//     автоудаление, клавиатура бота, отложенные (Б-32), упоминания/реакции/голоса
//     (Б-27 — угловые кнопки), «Вступить»/«Разблокировать»/премиум/заморозка/закреп/
//     «Открыть чат» на плашке (Б-73). Состояния ввода (`inputState`), эфемерный режим,
//     приветственные сообщения, звёзды, поток бота (`streamStoppable`) — без предмета.
//  7. `initMessageReply`/`initMessagesForward` берут сообщение у воркера
//     (`messages.getMessageByPeer`/`reloadMessage`); имя переславшего без пира
//     (`fwd_from.from_name`) не различается — отправитель берётся `fromId ?? peerId`.
//  8. Пустая правка (`sendMessage`, ветка `showDeleteMessagesPopup`) не делает ничего —
//     попап удаления у П-5 (`popups/deleteMessages`).
import type { Managers } from '@/client/bootstrap'
import type { AppImManager } from '@lib/appImManager'
import rootScope from '@lib/rootScope'
import I18n, { i18n, join, type FormatterArguments, type LangPackKey } from '@lib/langPack'
import { RT } from '@core/realtime/events'
import type { Dialog, DraftMessage, DraftMessageReal, MessageEntity, MyMessage } from '@core/models'
import { getMessageText } from '@core/models'
import type { MessageSendingParams } from '@core/managers/messages/sendingParams'
import type { MessageOp } from '@core/realtime/messageOps'
import type { Sticker } from '@core/managers/stickersManager'
import type { GifItem } from '@core/gifs'
import type { ChatRights } from '@core/peers/rights'
import { isUser } from '@core/peers/peerId'
import { cachedUser, isBroadcastPeer, isInChatPeer } from '@core/peerCache'
import { isBot as isBotPeer } from '@core/peers/predicates'
import { isPeerMuted } from '@core/dialogs/notifySettings'
import { draftsAreEqual, realDraft } from '@core/dialogs/draft'
import { mirrorWindow } from '@core/history/messagesMirror'
import appNavigationController, { type NavigationItem } from '@core/navigation/appNavigationController'
import { setTransition as SetTransition } from '@core/dom/setTransition'
import mediaSizes from '@core/dom/mediaSizes'
import { useChatsStore } from '@stores/chatsStore'
import parseEntities from '@lib/richtext/parseEntities'
import parseMarkdown from '@lib/richtext/parseMarkdown'
import { mergeEntities } from '@lib/richtext/entities'
import wrapDraftText from '@lib/richtext/wrapDraftText'
import splitStringByLength from '@helpers/string/splitStringByLength'
import sliceMessageEntities from '@helpers/sliceMessageEntities'
import ListenerSetter from '@helpers/listenerSetter'
import { getMiddleware, type MiddlewareHelper } from '@helpers/middleware'
import debounce, { type DebounceReturnType } from '@helpers/schedulers/debounce'
import { fastRaf } from '@helpers/schedulers'
import { attachClickEvent } from '@helpers/dom/clickEvent'
import cancelEvent from '@helpers/dom/cancelEvent'
import cancelSelection from '@helpers/dom/cancelSelection'
import findUpClassName from '@helpers/dom/findUpClassName'
import isInputEmpty from '@helpers/dom/isInputEmpty'
import isSendShortcutPressed from '@helpers/dom/isSendShortcutPressed'
import placeCaretAtEnd from '@helpers/dom/placeCaretAtEnd'
import getRichValueWithCaret from '@helpers/dom/getRichValueWithCaret'
import { handleMarkdownShortcut, processCurrentFormatting } from '@helpers/dom/markdown'
import toggleDisability from '@helpers/dom/toggleDisability'
import createBadge from '@helpers/createBadge'
import setBadgeContent from '@helpers/setBadgeContent'
import windowSize from '@helpers/windowSize'
import { IS_MOBILE } from '@environment/userAgent'
import IMAGE_MIME_TYPES_SUPPORTED from '@environment/imageMimeTypesSupport'
import VIDEO_MIME_TYPES_SUPPORTED from '@environment/videoMimeTypesSupport'
import Button from '@components/button'
import ButtonIcon from '@components/buttonIcon'
import ButtonCorner from '@components/buttonCorner'
import ButtonMenuToggle from '@components/buttonMenuToggle'
import type { ButtonMenuItemOptionsVerifiable } from '@components/buttonMenu'
import Icon from '@components/icon'
import InputFieldAnimated from '@components/inputFieldAnimated'
import { toastNew } from '@components/toast'
import PopupElement from '@components/popups/popupElement'
import PopupPeer from '@components/popups/popupPeer'
import showNewMediaPopup, { getCurrentNewMediaPopup } from '@components/popups/newMedia'
import { openCreatePollPopup } from '@components/popups/createPoll.bridge'
import showChecklistPopup from '@components/popups/checklist.bridge'
import wrapReply from '@components/wrappers/reply'
import wrapMessageForReply from '@components/wrappers/messageForReply'
import AttachMenuButton from './attachMenuButton.solid'
import ChatInputPlate from './controlPlate.solid'
import PeerTitle from './peerTitle'
import type Chat from './chat'
import { ChatType } from './chatType'

/** tweb `:182` — что сказать, когда действие запрещено (расхождение 5). */
export const POSTING_NOT_ALLOWED_MAP: { [action in ChatRights]?: LangPackKey } = {
  send_media: 'GlobalAttachMediaRestricted',
  send_messages: 'GlobalSendMessageRestricted',
}

type ChatInputHelperType = 'edit' | 'webpage' | 'forward' | 'reply'

type ChatSendBtnIcon = 'send' | 'record' | 'record-video' | 'edit' | 'schedule' | 'forward' | 'stop'
export type ChatInputReplyTo = Pick<MessageSendingParams, 'replyToMsgId' | 'replyToQuote' | 'replyToPeerId'>

/** tweb `AttachedMediaType` (`chat/utils.ts`) */
export type AttachedMediaType = 'media' | 'document'

const CLASS_NAME = 'chat-input'
const PEER_EXCEPTIONS = new Set<ChatType>([ChatType.Scheduled, ChatType.Stories, ChatType.Saved, ChatType.Welcome])

/** tweb `config.message_length_max` — у нас константа бэкенда (`maxMessageRunes`). */
const MESSAGE_LENGTH_MAX = 4096

/** tweb `:2006-2015` — длина паузы между «печатает». */
const TYPING_THROTTLE_MS = 6000

export default class ChatInput {
  public messageInput!: HTMLElement
  public messageInputField!: InputFieldAnimated
  private inputHeightDelta = 0
  private helperVisible = false
  public fileInput!: HTMLInputElement
  public inputMessageContainer!: HTMLDivElement
  public btnSend!: HTMLButtonElement
  private lastTimeType = 0

  public chatInput!: HTMLElement
  public inputContainer!: HTMLElement
  public rowsWrapper!: HTMLDivElement
  public newMessageWrapper!: HTMLDivElement
  public btnSendContainer!: HTMLDivElement

  public attachMenu!: InstanceType<typeof AttachMenuButton>
  private attachMenuButtons!: ButtonMenuItemOptionsVerifiable[]

  private replyElements: {
    container: HTMLElement,
    cancelBtn: HTMLElement,
    iconBtn: HTMLElement,
    content: HTMLElement,
  } = {} as ChatInput['replyElements']

  public forwarding?: { [fromPeerId: PeerId]: number[] }
  public replyToMsgId: MessageSendingParams['replyToMsgId']
  public replyToQuote: MessageSendingParams['replyToQuote']
  public replyToPeerId: MessageSendingParams['replyToPeerId']
  public editMsgId?: number
  public editMessage?: MyMessage
  public sendSilent?: true
  public startParam?: string

  public helperType?: Exclude<ChatInputHelperType, 'webpage'>
  /** tweb `:322` — перерисовать плашку (превью ссылки возвращает прежнюю, Б-72) */
  public helperFunc?: () => void | Promise<void>

  public willAttachType?: AttachedMediaType

  public listenerSetter: ListenerSetter
  private middlewareHelper: MiddlewareHelper

  private goDownBtn!: HTMLElement
  private goDownUnreadBadge!: HTMLElement

  private saveDraftDebounced!: DebounceReturnType<() => void>

  private fakeRowsWrapper!: HTMLDivElement

  private botStartBtn!: HTMLButtonElement
  private channelMuteBtn!: HTMLButtonElement
  private rowsWrapperWrapper!: HTMLDivElement
  private controlContainer!: HTMLElement
  private fakeSelectionWrapper!: HTMLDivElement

  private fakeWrapperTo?: HTMLElement
  private toggleControlButtonDisability?: () => void

  private restoreInputLock?: () => void

  /** True while `finishPeerChange` runs — suppresses animated plate centering. */
  private peerChanging = false

  private inputHelperNavigationItem?: NavigationItem

  /** Точка отсчёта подписки на зеркало диалогов (`setChatListeners`): диалог открытого пира. */
  private lastDialogPeerId?: PeerId
  private lastDialog?: Dialog

  /**
   * Расхождение 3 шапки: черновик диалога, который отправка уже сняла локально
   * (tweb `sendText({clearDraft: true})` → `appDraftsManager.clearDraft`). Пока зеркало
   * держит этот же объект черновика, `getDraft` его не отдаёт.
   */
  private clearedDraft?: { peerId: PeerId, draft: DraftMessage | undefined }

  constructor(
    public chat: Chat,
    private appImManager: AppImManager,
    public managers: Managers,
    private className = 'chat-input-main',
  ) {
    this.listenerSetter = new ListenerSetter()
    this.middlewareHelper = getMiddleware()
  }

  /** tweb `:487-574` */
  public construct() {
    const className2 = this.className

    this.chatInput = document.createElement('div')
    this.chatInput.classList.add(CLASS_NAME, className2, 'hide')

    this.inputContainer = document.createElement('div')
    this.inputContainer.classList.add(`${CLASS_NAME}-container`, `${className2}-container`)

    this.rowsWrapperWrapper = document.createElement('div')
    this.rowsWrapperWrapper.classList.add('rows-wrapper-wrapper')

    this.rowsWrapper = document.createElement('div')
    this.rowsWrapper.classList.add(...[
      'rows-wrapper',
      `${CLASS_NAME}-wrapper`,
      `${className2}-wrapper`,
      this.chat.type !== ChatType.Stories && 'chat-rows-wrapper',
    ].filter(Boolean) as string[])

    this.rowsWrapperWrapper.append(this.rowsWrapper)

    const fakeRowsWrapper = this.fakeRowsWrapper = document.createElement('div')
    fakeRowsWrapper.classList.add('fake-wrapper', 'fake-rows-wrapper')

    const fakeSelectionWrapper = this.fakeSelectionWrapper = document.createElement('div')
    fakeSelectionWrapper.classList.add('fake-wrapper', 'fake-selection-wrapper')

    this.inputContainer.append(this.rowsWrapperWrapper, fakeRowsWrapper, fakeSelectionWrapper)
    this.chatInput.append(this.inputContainer)

    this.constructGoDownButton()

    const c = this.controlContainer = document.createElement('div')
    c.classList.add('chat-input-control', 'chat-input-wrapper')
    this.inputContainer.append(c)
  }

  public getMiddleware(additionalCallback?: () => boolean) {
    return this.middlewareHelper.get(additionalCallback)
  }

  public createButtonIcon(...args: Parameters<typeof ButtonIcon>) {
    return ButtonIcon(...args)
  }

  /** tweb `:615-627` */
  private constructGoDownButton() {
    this.goDownBtn = ButtonCorner({
      icon: 'arrow_down',
      className: 'bubbles-corner-button chat-secondary-button bubbles-go-down hide',
    })
    this.inputContainer.append(this.goDownBtn)

    attachClickEvent(this.goDownBtn, (e) => {
      cancelEvent(e)
      this.chat.bubbles.onGoDownClick()
    }, { listenerSetter: this.listenerSetter })
  }

  /** tweb `:629-650` — меню плашки (`ButtonMenuSync` + `DropdownHover`) — Б-72. */
  private constructReplyElements() {
    this.replyElements.container = document.createElement('div')
    this.replyElements.container.classList.add('reply-wrapper', 'rows-wrapper-row')

    this.replyElements.content = document.createElement('div')
    this.replyElements.content.classList.add('reply-wrapper-content')

    this.replyElements.iconBtn = this.createButtonIcon('')
    this.replyElements.iconBtn.tabIndex = -1
    this.replyElements.iconBtn.setAttribute('aria-hidden', 'true')
    this.replyElements.cancelBtn = this.createButtonIcon('close reply-cancel', { noRipple: true, ariaLabel: 'Cancel' })

    this.replyElements.content.append(this.replyElements.iconBtn, this.replyElements.cancelBtn)
    this.replyElements.container.append(this.replyElements.content)

    attachClickEvent(this.replyElements.cancelBtn, this.onHelperCancel, { listenerSetter: this.listenerSetter })
    attachClickEvent(this.replyElements.content, this.onHelperClick, { listenerSetter: this.listenerSetter })
  }

  /** tweb `:1055-1682` — расхождение 6 шапки. */
  public constructPeerHelpers() {
    this.constructReplyElements()

    this.newMessageWrapper = document.createElement('div')
    this.newMessageWrapper.classList.add('new-message-wrapper', 'rows-wrapper-row')

    this.inputMessageContainer = document.createElement('div')
    this.inputMessageContainer.classList.add('input-message-container')

    this.goDownUnreadBadge = createBadge('span', 24, 'primary')
    this.goDownBtn.append(this.goDownUnreadBadge)

    this.attachMenuButtons = [{
      icon: 'image',
      text: 'Chat.Input.Attach.PhotoOrVideo',
      onClick: () => this.onAttachClick(false, true, true),
      verify: () => !this.editMsgId,
    }, {
      icon: 'document',
      text: 'Chat.Input.Attach.Document',
      onClick: () => this.onAttachClick(true),
      verify: () => !this.editMsgId,
    }, {
      icon: 'poll',
      text: 'Poll',
      onClick: async() => {
        const pollsAction: ChatRights = 'send_media'
        if(!(await this.chat.canSend(pollsAction))) {
          toastNew({ langPackKey: POSTING_NOT_ALLOWED_MAP[pollsAction]! })
          return
        }

        openCreatePollPopup({
          isBroadcast: this.chat.isBroadcast,
          onSubmit: (payload) => this.managers.messages.sendPoll(this.chat.peerId, {
            ...payload,
            clientMsgId: crypto.randomUUID(),
            ...this.getMessageSendingParams(),
          }),
        })
      },
      verify: () => {
        if(this.editMsgId) return false
        return !isUser(this.chat.peerId) || this.chat.isBot || this.chat.peerId === rootScope.myId
      },
    }, {
      icon: 'checkround',
      text: 'Checklist',
      onClick: async() => {
        if(!isUser(this.chat.peerId)) {
          const action: ChatRights = 'send_media'
          if(!(await this.chat.canSend(action))) {
            toastNew({ langPackKey: POSTING_NOT_ALLOWED_MAP[action]! })
            return
          }
        }

        showChecklistPopup({ chat: this.chat })
      },
      verify: () => !this.editMsgId,
    }]

    this.attachMenu = new AttachMenuButton()

    ButtonMenuToggle({
      container: this.attachMenu,
      buttonOptions: { noRipple: true },
      listenerSetter: this.listenerSetter,
      direction: 'top-right',
      buttons: this.attachMenuButtons,
    })
    this.attachMenu.classList.add('attach-file')

    this.fileInput = document.createElement('input')
    this.fileInput.type = 'file'
    this.fileInput.multiple = true
    this.fileInput.style.display = 'none'

    this.newMessageWrapper.append(this.attachMenu, this.inputMessageContainer, this.fileInput)

    this.rowsWrapper.append(this.replyElements.container)
    this.rowsWrapper.append(this.newMessageWrapper)

    this.btnSendContainer = document.createElement('div')
    this.btnSendContainer.classList.add('btn-send-container')

    this.btnSend = this.createButtonIcon() as HTMLButtonElement
    this.btnSend.classList.add('btn-circle', 'btn-send', 'animated-button-icon')
    const icons: [Parameters<typeof Icon>[0], string][] = [
      ['logo', 'send'],
      ['schedule', 'schedule'],
      ['check', 'edit'],
      ['microphone_filled', 'record'],
      ['recordround_filled', 'record-video'],
      ['forward_filled', 'forward'],
      ['stop', 'stop'],
    ]
    this.btnSend.append(...icons.map(([name, type]) => Icon(name, 'animated-button-icon-icon', 'btn-send-icon-' + type)))

    this.btnSendContainer.append(this.btnSend)

    // Move the morphing send/record button into the input row as the last button.
    this.newMessageWrapper.append(this.btnSendContainer)

    this.attachMessageInputField()

    this.setChatListeners()

    this.updateSendBtn()

    this.listenerSetter.add(this.fileInput)('change', (e: Event) => {
      const fileList = (e.target as HTMLInputElement).files
      const files = Array.from(fileList ?? [])
      if(!files.length) {
        return
      }

      const newMediaPopup = getCurrentNewMediaPopup()
      if(newMediaPopup) {
        newMediaPopup.addFiles(files)
      } else {
        showNewMediaPopup(this.chat, files, this.willAttachType ?? 'media')
      }

      this.fileInput.value = ''
    }, false)

    attachClickEvent(this.btnSend, this.onBtnSendClick, { listenerSetter: this.listenerSetter })

    this.saveDraftDebounced = debounce(() => this.saveDraft(), 2500, false, true)

    const makeControlButton = (langKey: LangPackKey, filled?: boolean) => {
      const button = Button(`btn-primary ${filled ? 'btn-color-primary' : 'btn-transparent'} text-bold chat-input-control-button chat-input-plate-button`) as HTMLButtonElement
      button.append(i18n(langKey))
      return button
    }

    this.botStartBtn = makeControlButton('BotStart')
    this.channelMuteBtn = makeControlButton('ChatList.Context.Mute')
    this.channelMuteBtn.classList.add('hide')

    attachClickEvent(this.botStartBtn, this.startBot, { listenerSetter: this.listenerSetter })
    attachClickEvent(this.channelMuteBtn, () => {
      const peerId = this.chat.peerId
      void this.managers.groups.setMute(peerId, !this.isPeerMuted(peerId))
    }, { listenerSetter: this.listenerSetter })

    const controlPlate = ChatInputPlate({
      center: [
        this.botStartBtn,
        this.channelMuteBtn,
      ],
    }) as HTMLElement

    this.controlContainer.append(controlPlate)
  }

  /** tweb `:1688-1812` — расхождение 3 шапки (черновик — подписка на зеркало). */
  private setChatListeners() {
    this.listenerSetter.add(this.appImManager)('peer_changing', (chat: Chat) => {
      if(this.chat === chat && (this.chat.type === ChatType.Chat || this.chat.type === ChatType.Discussion)) {
        this.saveDraft()
      }
    })

    // tweb `history_delete` (:1749-1764): удаление приезжает операцией окна.
    this.listenerSetter.add(rootScope)(RT.messageOp, ({ ops }: { ops: MessageOp[] }) => {
      if(!this.chat.peerId || PEER_EXCEPTIONS.has(this.chat.type)) return
      const removed = new Set<number>()
      for(const op of ops) {
        if(op.op === 'remove' && op.key === this.chat.messagesStorageKey) removed.add(op.msgId)
      }

      if(!removed.size) return
      if(this.editMsgId && removed.has(this.editMsgId)) {
        this.onMessageSent()
      }

      if(this.replyToMsgId && removed.has(this.replyToMsgId)) {
        this.clearHelper()
      }
    })

    // tweb `draft_updated` (:1711-1727), `dialogs_multiupdate` (:1772-1780),
    // `dialog_notify_settings` (:1805-1810) и непрочитанное кнопки «вниз»
    // (`setUnreadCount`, :2219) — одно зеркало диалогов.
    const unsubscribe = useChatsStore.subscribe(() => {
      const peerId = this.chat.peerId
      const dialog = this.getDialog(peerId)
      if(peerId !== this.lastDialogPeerId) {
        // пир сменился, а `finishPeerChange` ещё не отработал — точку отсчёта ставит он
        return
      }

      const prev = this.lastDialog
      if(dialog === prev) return
      this.lastDialog = dialog
      if(!peerId) return

      if(prev?.draft !== dialog?.draft) this.onDraftUpdated(dialog?.draft)
      if(!!prev !== !!dialog) void this.center(true)
      if(prev?.unread_count !== dialog?.unread_count || prev?.notify_settings !== dialog?.notify_settings) {
        this.setUnreadCount()
      }

      if(prev?.notify_settings !== dialog?.notify_settings) {
        this.updateChannelMuteButton()
      }
    })
    this.middlewareHelper.onDestroy(unsubscribe)
  }

  /** tweb `:1711-1727` */
  private onDraftUpdated(draft: DraftMessage | undefined) {
    if(PEER_EXCEPTIONS.has(this.chat.type) || this.chat.threadId) return
    if(!realDraft(draft)) {
      // a pending local save means the user is actively typing newer content —
      // let it win and sync normally instead of clobbering it with the remote clear.
      if(this.saveDraftDebounced.isDebounced()) return
      this.saveDraftDebounced.clearTimeout()
    }

    void this.setDraft(realDraft(draft), true)
  }

  private getDialog(peerId = this.chat.peerId) {
    return peerId ? useChatsStore.getState().dialogs.find((dialog) => dialog.peerId === peerId) : undefined
  }

  private isPeerMuted(peerId = this.chat.peerId) {
    return isPeerMuted(this.getDialog(peerId)?.notify_settings, Math.floor(Date.now() / 1000))
  }

  /** tweb `:1886-1966` */
  public _center(neededFakeContainer: HTMLElement | undefined, animate?: boolean) {
    if(!neededFakeContainer && !this.inputContainer.classList.contains('is-centering')) {
      return
    }

    if(neededFakeContainer === this.fakeWrapperTo) {
      return
    }

    const fakeSelectionWrapper = (neededFakeContainer || this.fakeWrapperTo)!
    const forwards = !!neededFakeContainer
    const oldFakeWrapperTo = this.fakeWrapperTo
    let transform = '', borderRadius = '', needTranslateX = 0
    const fakeSelectionRect = fakeSelectionWrapper.getBoundingClientRect()
    const fakeRowsRect = this.fakeRowsWrapper.getBoundingClientRect()
    const widthFrom = fakeRowsRect.width
    const widthTo = fakeSelectionRect.width

    if(widthFrom !== widthTo) {
      const scale = widthTo / widthFrom
      const initTranslateX = (widthFrom - widthTo) / 2
      needTranslateX = fakeSelectionRect.left - fakeRowsRect.left - initTranslateX

      if(forwards) {
        transform = `translateX(${needTranslateX}px) scaleX(${scale})`

        if(scale < 1) {
          const br = 16
          borderRadius = '' + (br + br * (1 - scale)) + 'px'
        }
      }
    }

    this.fakeWrapperTo = neededFakeContainer

    const duration = animate ? 200 : 0
    SetTransition({
      element: this.inputContainer,
      className: 'is-centering',
      forwards,
      duration,
    })
    SetTransition({
      element: this.rowsWrapperWrapper,
      className: 'is-centering-to-control',
      forwards: !!(forwards && neededFakeContainer && neededFakeContainer.classList.contains('chat-input-control')),
      duration,
    })
    this.rowsWrapper.style.transform = transform
    this.rowsWrapper.style.borderRadius = borderRadius

    return {
      transform,
      borderRadius,
      needTranslateX: oldFakeWrapperTo && (
        (
          neededFakeContainer &&
          neededFakeContainer.classList.contains('chat-input-control') &&
          oldFakeWrapperTo === this.fakeSelectionWrapper
        ) || oldFakeWrapperTo.classList.contains('chat-input-control')
      ) ? needTranslateX * -0.5 : needTranslateX,
      widthFrom,
      widthTo,
    }
  }

  /** tweb `:1962-1970` */
  public async center(animate = false) {
    // While a peer change is in progress the plate must switch instantly —
    // otherwise an animated centering races `finishPeerChange` and the control
    // plate flickers on chat switch.
    const animated = animate && !this.peerChanging
    return this._center(await this.getNeededFakeContainer(), animated)
  }

  /** tweb `:1972-1979` */
  public setStartParam(startParam?: string) {
    if(this.startParam === startParam) {
      return
    }

    this.startParam = startParam
    void this.center(true)
  }

  /** tweb `:1996-2016` — у нас «Начать» это `/start` обычным сообщением. */
  public startBot = () => {
    const { startParam } = this

    const toggle = this.toggleControlButtonDisability = toggleDisability([this.botStartBtn], true)
    const peerId = this.chat.peerId
    const middleware = this.getMiddleware(() => {
      return this.chat.peerId === peerId &&
        this.startParam === startParam &&
        this.toggleControlButtonDisability === toggle
    })

    void this.sendText('/start' + (startParam ? ' ' + startParam : ''), [], this.getMessageSendingParams()).then(() => {
      if(middleware()) {
        toggle()
        this.toggleControlButtonDisability = undefined
        this.setStartParam()
      }
    })
  }

  /**
   * tweb `chat.ts:1353-1367` (`Chat.isStartButtonNeeded`) — у нас здесь, `chat.ts` в К-4
   * не правится: бот без диалога и без истории.
   */
  private isStartButtonNeeded() {
    const { peerId } = this.chat
    if(!isUser(peerId) || !isBotPeer(cachedUser(peerId))) {
      return false
    }

    return !this.getDialog(peerId) && !mirrorWindow(this.chat.messagesStorageKey)?.length
  }

  /**
   * tweb `:2063-2075` — канал, куда нельзя писать: подписчик видит «Без звука».
   * «Вступить» (`joinBtn`) — Б-73.
   */
  private async isChannelControlNeeded() {
    if(this.chat.type !== ChatType.Chat || isUser(this.chat.peerId) || !isBroadcastPeer(this.chat.peerId)) {
      return false
    }

    return !(await this.chat.canSend('send_messages'))
  }

  /** tweb `:2079-2085` */
  private updateChannelMuteButton() {
    if(!this.channelMuteBtn) {
      return
    }

    this.channelMuteBtn.replaceChildren(i18n(this.isPeerMuted() ? 'ChatList.Context.Unmute' : 'ChatList.Context.Mute'))
  }

  /** tweb `:2087-2107` */
  public async getNeededFakeContainer(_startParam = this.startParam): Promise<HTMLElement | undefined> {
    if(this.chat.selection?.isSelecting) {
      return this.fakeSelectionWrapper
    } else if(
      this.isStartButtonNeeded() ||
      await this.isChannelControlNeeded()
    ) {
      return this.controlContainer
    }
  }

  /** tweb `:2219-2243` */
  public setUnreadCount() {
    if(!this.goDownUnreadBadge) {
      return
    }

    const dialog = this.chat.type === ChatType.Discussion || this.chat.threadId ? undefined : this.getDialog()
    const count = dialog?.unread_count
    setBadgeContent(this.goDownUnreadBadge, '' + (count || ''))
    this.goDownUnreadBadge.classList.toggle('badge-gray', this.isPeerMuted())
  }

  /** Черновик диалога — расхождение 3 шапки. */
  private getDraft(): DraftMessageReal | undefined {
    const { peerId } = this.chat
    const draft = this.getDialog(peerId)?.draft
    if(this.clearedDraft?.peerId === peerId && this.clearedDraft.draft === draft) {
      return undefined
    }

    return realDraft(draft)
  }

  /** tweb `:2271-2313` */
  public getCurrentInputAsDraft(ignoreEmptyValue?: boolean) {
    const { value, entities } = getRichValueWithCaret(this.messageInputField.input, true, false)

    let draft: DraftMessageReal | undefined
    if((value.length || ignoreEmptyValue) || this.replyToMsgId) {
      const replyTo = this.getReplyTo()
      draft = {
        _: 'draftMessage',
        date: Math.floor(Date.now() / 1000),
        message: value.trim(),
        entities: entities.length ? entities : undefined,
        reply_to: replyTo?.replyToMsgId ? {
          _: 'inputReplyToMessage',
          reply_to_msg_id: replyTo.replyToMsgId,
        } : undefined,
      }
    }

    return draft
  }

  /** tweb `:2315-2328` — `syncDraft` у нас — отсечка равных + `drafts.save`. */
  public saveDraft() {
    if(
      !this.chat.peerId ||
      this.editMsgId ||
      this.chat.threadId ||
      PEER_EXCEPTIONS.has(this.chat.type) ||
      !this.messageInputField
    ) {
      return
    }

    const draft = this.getCurrentInputAsDraft()
    if(draftsAreEqual(draft, this.getDraft())) {
      return
    }

    const peerId = this.chat.peerId
    this.clearedDraft = undefined
    void this.managers.drafts.save(
      peerId,
      draft?.message ?? '',
      draft?.reply_to?.reply_to_msg_id ?? null,
      draft?.entities,
    ).catch(() => {})
  }

  /** tweb `:2365-2388` */
  public destroy() {
    appNavigationController.removeItem(this.inputHelperNavigationItem!)
    this.listenerSetter.removeAll()
    this.middlewareHelper.destroy()
    this.saveDraftDebounced?.clearTimeout()
  }

  /** tweb `:2390-2410` */
  public cleanup(helperToo = true) {
    if(this.chat && !this.chat.peerId) {
      this.chatInput.classList.add('hide')
      this.goDownBtn.classList.add('hide')
    }

    cancelSelection()

    this.lastTimeType = 0
    this.startParam = undefined

    if(this.toggleControlButtonDisability) {
      this.toggleControlButtonDisability()
      this.toggleControlButtonDisability = undefined
    }

    if(this.messageInput) {
      void this.clearInput()
      if(helperToo) this.clearHelper()
    }
  }

  /** tweb `:2412-2484` */
  public async setDraft(draft?: DraftMessageReal, fromUpdate = true, force = false) {
    if(
      (!force && draft && !isInputEmpty(this.messageInput)) ||
      PEER_EXCEPTIONS.has(this.chat.type) ||
      this.chat.threadId
    ) {
      return false
    }

    if(!draft) {
      draft = this.getDraft()

      if(!draft) {
        if(fromUpdate && !this.saveDraftDebounced.isDebounced()) {
          void this.clearInput()
          this.clearHelper()
        }

        return fromUpdate
      }
    }

    const currentDraft = this.getCurrentInputAsDraft()
    if(draftsAreEqual(draft, currentDraft)) {
      return false
    }

    const myEntities = parseEntities(draft.message)
    const totalEntities = mergeEntities(draft.entities ?? [], myEntities) // ! only in this order, otherwise bold and emoji formatting won't work
    const wrappedDraft = wrapDraftText(draft.message, { entities: totalEntities, wrappingForPeerId: this.chat.peerId })

    if(fromUpdate) {
      this.clearHelper()
    }

    const draftReplyToMsgId = draft.reply_to?.reply_to_msg_id
    if(draftReplyToMsgId) {
      void this.initMessageReply({ replyToMsgId: draftReplyToMsgId })
    }

    this.setInputValue(wrappedDraft, fromUpdate, fromUpdate)
    return true
  }

  /** tweb `:2522-2797` — расхождение 6 шапки. */
  public async finishPeerChange(options: { peerId: PeerId, startParam?: string, middleware: () => boolean }) {
    const { peerId, startParam } = options

    this.peerChanging = true

    const { goDownBtn, chatInput, attachMenu } = this

    const [
      isBroadcast,
      isBot,
      canSend,
      canSendPlain,
      neededFakeContainer,
    ] = await Promise.all([
      isBroadcastPeer(peerId),
      isUser(peerId) && isBotPeer(cachedUser(peerId)),
      this.chat.canSend('send_messages'),
      this.chat.canSend('send_messages'),
      this.getNeededFakeContainer(startParam),
    ])

    const placeholderParams = this.messageInput ? await this.getPlaceholderParams(canSendPlain) : undefined

    return () => {
      this.lastDialogPeerId = peerId
      this.lastDialog = this.getDialog(peerId)

      chatInput.classList.remove('hide')

      goDownBtn.classList.toggle('is-broadcast', isBroadcast)
      goDownBtn.classList.remove('hide')

      this.setUnreadCount()

      let haveSomethingInControl = false

      {
        const cantPost = isBroadcast && !canSend && this.chat.type === ChatType.Chat && !isUser(peerId)
        const showMute = cantPost && isInChatPeer(peerId)
        const good = !haveSomethingInControl && showMute
        haveSomethingInControl ||= good

        this.channelMuteBtn.classList.toggle('hide', !good)
        if(good) {
          this.updateChannelMuteButton()
        }
      }

      this.botStartBtn.classList.toggle('hide', haveSomethingInControl || !isBot)

      if(this.messageInput) {
        this.updateMessageInput(
          canSend || haveSomethingInControl,
          canSendPlain,
          placeholderParams!,
        )
        this.messageInput.dataset.peerId = '' + peerId

        void Promise.all(this.attachMenuButtons.map((button) => button.verify ? button.verify() : true)).then((verified) => {
          if(!options.middleware()) return
          const visible = verified.some(Boolean)
          attachMenu.toggleAttribute('disabled', !visible)
          attachMenu.classList.toggle('btn-disabled', !visible)
        })
      }

      this.messageInputField?.onFakeInput(undefined, true)

      this.startParam = startParam

      this._center(neededFakeContainer, false)

      this.peerChanging = false
    }
  }

  /** tweb `:2959-3018` — без звёзд, монофорума, бот-форума и историй (нет предмета). */
  public async getPlaceholderParams(canSend?: boolean): Promise<{ key: LangPackKey, args?: FormatterArguments }> {
    canSend ??= await this.chat.canSend('send_messages')
    const { peerId, threadId, isForum } = this.chat
    let key: LangPackKey
    if(!canSend) {
      key = 'Channel.Persmission.MessageBlock'
    } else if(threadId && !isForum && !isUser(peerId)) {
      key = 'Comment'
    } else if(isBroadcastPeer(peerId)) {
      key = 'ChannelBroadcast'
    } else {
      key = 'Message'
    }

    return { key }
  }

  /** tweb `:3020-3040` */
  public updateMessageInputPlaceholder({ key, args = [] }: { key: LangPackKey, args?: FormatterArguments }) {
    const i = I18n.weakMap.get(this.messageInputField.placeholder!) as I18n.IntlElement | undefined
    if(!i) {
      return
    }

    const oldKey = i.key
    const oldArgs = i.args
    i.compareAndUpdateBool({ key, args })

    return { oldKey, oldArgs }
  }

  /** tweb `:3048-3092` */
  public updateMessageInput(
    canSend: boolean,
    canSendPlain: boolean,
    placeholderParams: Parameters<ChatInput['updateMessageInputPlaceholder']>[0],
  ) {
    const { chatInput, messageInput } = this
    const isHidden = chatInput.classList.contains('is-hidden')
    const willBeHidden = !canSend
    if(isHidden !== willBeHidden) {
      chatInput.classList.add('no-transition')
      chatInput.classList.toggle('is-hidden', !canSend)
      void chatInput.offsetLeft // reflow
      chatInput.classList.remove('no-transition')
    }

    const isEditingAndLocked = canSend && !canSendPlain && this.restoreInputLock

    if(!isEditingAndLocked) this.updateMessageInputPlaceholder(placeholderParams)

    if(isEditingAndLocked) {
      this.restoreInputLock = () => {
        this.updateMessageInputPlaceholder(placeholderParams)
        this.messageInput.contentEditable = 'false'
      }
    } else if(!canSend || !canSendPlain) {
      messageInput.contentEditable = 'false'

      if(!canSendPlain) {
        this.messageInputField.onFakeInput(undefined, true)
      }
    } else {
      this.restoreInputLock = undefined
      messageInput.contentEditable = 'true'
      void this.setDraft(undefined, false)

      if(!messageInput.innerHTML) {
        this.messageInputField.onFakeInput(undefined, true)
      }
    }

    this.updateSendBtn()
  }

  /** tweb `:3094-3097` */
  private notifyChatInputHeight() {
    const helperPx = this.helperVisible ? 48 : 0
    this.chat.updateChatInputHeight(this.inputHeightDelta + helperPx)
  }

  // tweb `:3099-3127` — единый источник `max-height` поля ввода.
  private static MESSAGE_INPUT_MAX_HEIGHT_DEFAULT = 440 // 27.5rem
  private static MESSAGE_INPUT_MAX_HEIGHT_MOBILE = 160 // 10rem
  private static MESSAGE_INPUT_MAX_HEIGHT_MIN = 36
  private static SHORT_VIEWPORT_HEIGHT = 480 // 30rem
  private static SHORT_VIEWPORT_RESERVED = 160 // 10rem reserved for chrome

  private computeMessageInputMaxHeight() {
    if(mediaSizes.isMobile) return ChatInput.MESSAGE_INPUT_MAX_HEIGHT_MOBILE
    if(windowSize.height <= ChatInput.SHORT_VIEWPORT_HEIGHT) {
      const available = windowSize.height - 2 * 16 - ChatInput.SHORT_VIEWPORT_RESERVED
      return Math.max(ChatInput.MESSAGE_INPUT_MAX_HEIGHT_MIN, available)
    }
    return ChatInput.MESSAGE_INPUT_MAX_HEIGHT_DEFAULT
  }

  private syncMessageInputMaxHeight = () => {
    this.messageInputField?.setMaxHeight(this.computeMessageInputMaxHeight())
  }

  /** tweb `:3129-3167` */
  private attachMessageInputField() {
    const oldInputField = this.messageInputField
    this.messageInputField = new InputFieldAnimated({
      placeholder: 'Message',
      name: 'message',
      withLinebreaks: true,
    })

    const DEFAULT_INPUT_HEIGHT = 37
    this.messageInputField.onChangeHeight = (newHeight) => {
      this.inputHeightDelta = Math.max(0, newHeight - DEFAULT_INPUT_HEIGHT)
      this.notifyChatInputHeight()
    }

    this.messageInputField.input.tabIndex = 0
    this.messageInputField.input.classList.replace('input-field-input', 'input-message-input')
    this.messageInputField.inputFake.classList.replace('input-field-input', 'input-message-input')
    this.messageInput = this.messageInputField.input
    this.attachMessageInputListeners()

    this.syncMessageInputMaxHeight()
    if(!oldInputField) {
      this.listenerSetter.add(mediaSizes)('resize', this.syncMessageInputMaxHeight)
    }

    if(oldInputField) {
      oldInputField.input.replaceWith(this.messageInputField.input)
      oldInputField.placeholder!.replaceWith(this.messageInputField.placeholder!)
      oldInputField.inputFake.replaceWith(this.messageInputField.inputFake)
    } else {
      this.inputMessageContainer.append(this.messageInputField.input, this.messageInputField.placeholder!, this.messageInputField.inputFake)
    }
  }

  /** tweb `:3177-3328` — без эмодзи-дропдауна, автокомплита и цитат (нет предмета). */
  private attachMessageInputListeners() {
    this.listenerSetter.add(this.messageInput)('keydown', (e: KeyboardEvent) => {
      const key = e.key

      if(isSendShortcutPressed(e)) {
        cancelEvent(e)
        void this.sendMessage()
      } else if(e.ctrlKey || e.metaKey) {
        handleMarkdownShortcut(this.messageInput, e)
      } else if((key === 'PageUp' || key === 'PageDown') && !e.shiftKey) { // * fix pushing page to left (Chrome Windows)
        e.preventDefault()

        if(key === 'PageUp') {
          const range = document.createRange()
          const sel = window.getSelection()!

          range.setStart(this.messageInput.childNodes[0] || this.messageInput, 0)
          range.collapse(true)

          sel.removeAllRanges()
          sel.addRange(range)
        } else {
          placeCaretAtEnd(this.messageInput)
        }
      }
    })

    attachClickEvent(this.messageInput, () => {
      if(!this.canSendPlain()) {
        toastNew({ langPackKey: POSTING_NOT_ALLOWED_MAP.send_messages! })
      }
    }, { listenerSetter: this.listenerSetter })

    this.listenerSetter.add(this.messageInput)('input', this.onMessageInput)
  }

  /** tweb `:3330-3332` */
  public canSendPlain() {
    return this.messageInput.isContentEditable && !this.chatInput.classList.contains('is-hidden')
  }

  /** tweb `:3458-3532` — без превью ссылки (Б-72), автокомплита (Б-34) и бейджа звёзд. */
  public onMessageInput = (e?: Event) => {
    const { value: richValue } = getRichValueWithCaret(this.messageInputField.input)

    const isEmpty = !richValue.trim()
    if(isEmpty) {
      // * Chrome has a bug - it will preserve the formatting if the input with monospace text is cleared
      // * so have to reset formatting
      if(document.activeElement === this.messageInput && !IS_MOBILE) {
        setTimeout(() => {
          // * re-check emptiness: a replace-style IME emits the delete (empty input) and the
          // * insert in the same task, so the input is filled again by the time this fires.
          if(document.activeElement === this.messageInput && this.isInputEmpty()) {
            this.messageInput.textContent = '1'
            placeCaretAtEnd(this.messageInput)
            this.messageInput.textContent = ''
          }
        }, 0)
      }
    } else {
      const time = Date.now()
      if((time - this.lastTimeType) >= TYPING_THROTTLE_MS && e?.isTrusted) {
        this.lastTimeType = time
        void this.managers.realtime.sendTyping({ peerId: this.chat.peerId })
      }
    }

    if(!this.editMsgId) {
      void this.saveDraftDebounced()
    }

    processCurrentFormatting(this.messageInput, undefined, (e as InputEvent | undefined)?.inputType as Parameters<typeof processCurrentFormatting>[2])

    this.updateSendBtn()
  }

  /** tweb `:3796` — фокус в поле (лента зовёт его при «ответить»). */
  public focus() {
    placeCaretAtEnd(this.messageInput)
  }

  /** tweb `:3813-3884` */
  public onAttachClick = async(documents?: boolean, photos?: boolean, videos?: boolean) => {
    this.fileInput.value = ''

    if(documents) {
      this.fileInput.removeAttribute('accept')
      this.willAttachType = 'document'
    } else {
      const accept = [...new Set([
        ...(photos ? IMAGE_MIME_TYPES_SUPPORTED : []),
        // * .mov is selectable even when not natively playable — the send popup converts it to mp4
        ...(videos ? [...VIDEO_MIME_TYPES_SUPPORTED, 'video/quicktime'] : []),
      ])].join(', ')

      this.fileInput.setAttribute('accept', accept || '*/*')
      this.willAttachType = 'media'
    }

    this.fileInput.click()
  }

  /** tweb `:4086-4117` — без записи (Б-30): пустое поле тоже «отправить». */
  private onBtnSendClick = (e: Event) => {
    cancelEvent(e)
    void this.sendMessage()
  }

  /** tweb `:4119-4221` — без превью ссылки (Б-72). */
  public onHelperCancel = async(e?: Event, force?: boolean) => {
    if(e) {
      cancelEvent(e)
    }

    if(this.helperType === 'edit' && !force) {
      const message = this.editMessage!
      const draft = this.getCurrentInputAsDraft(true)
      const originalDraft: DraftMessageReal = {
        _: 'draftMessage',
        date: draft?.date ?? 0,
        message: getMessageText(message),
        entities: message._ === 'message' && message.entities?.length ? message.entities : undefined,
      }

      if(!draftsAreEqual(draft, originalDraft)) {
        PopupElement.createPopup(PopupPeer, 'discard-editing', {
          buttons: [{
            langKey: 'Alert.Confirm.Discard',
            callback: () => {
              void this.onHelperCancel(undefined, true)
            },
          }],
          descriptionLangKey: 'Chat.Edit.Cancel.Text',
        }).show()

        return
      }
    } else if(this.helperType === 'reply') {
      void this.saveDraftDebounced()
    }

    this.clearHelper()
    this.updateSendBtn()
  }

  /** tweb `:4223-4244` — без меню плашки на таче (Б-72). */
  private onHelperClick = (e?: Event) => {
    if(e) cancelEvent(e)

    if(e && !findUpClassName(e.target as HTMLElement, 'reply')) return
    if(this.helperType === 'reply') {
      void this.chat.setMessageId({ lastMsgId: this.replyToMsgId ?? undefined })
    } else if(this.helperType === 'edit') {
      void this.chat.setMessageId({ lastMsgId: this.editMsgId })
    }
  }

  /** tweb `:4301-4308` */
  public getReplyTo(): ChatInputReplyTo | undefined {
    if(!this.replyToMsgId) {
      return
    }

    const { replyToMsgId, replyToQuote, replyToPeerId } = this
    return { replyToMsgId, replyToQuote, replyToPeerId }
  }

  /** tweb `:4310-4341` */
  public async clearInput(canSetDraft = true, fireEvent = true, clearValue = '') {
    this.messageInputField.setValueSilently(clearValue)

    let set = false
    if(canSetDraft) {
      set = await this.setDraft(undefined, false)
    }

    if(!set && fireEvent) {
      this.onMessageInput()
    }
  }

  /** tweb `:4343-4345` */
  public isInputEmpty() {
    return isInputEmpty(this.messageInput)
  }

  /** tweb `:4390-4442` — без записи (Б-30), историй и потока бота (нет предмета). */
  public updateSendBtn() {
    let icon: ChatSendBtnIcon

    if(this.editMsgId) icon = 'edit'
    else icon = this.chat.type === ChatType.Scheduled ? 'schedule' : 'send'

    ;(['send', 'record', 'record-video', 'edit', 'schedule', 'forward', 'stop'] as ChatSendBtnIcon[]).forEach((i) => {
      this.btnSend.classList.toggle(i, icon === i)
    })

    const sendBtnLabelKey: { [key in ChatSendBtnIcon]: LangPackKey } = {
      'send': 'Send',
      'record': 'UserRestrictionsSendVoices',
      'record-video': 'UserRestrictionsSendRound',
      'edit': 'Edit',
      'schedule': 'Chat.Send.ScheduledMessage',
      'forward': 'Forward',
      // the button stops a draft the server is still streaming in
      'stop': 'ChatAutomation.Stop',
    }
    this.btnSend.setAttribute('aria-label', I18n.format(sendBtnLabelKey[icon], true))
  }

  /** tweb `:4499-4533` — без недавних эмодзи (их ведёт дропдаун, Б-35). */
  public onMessageSent(clearInput = true, clearReply?: boolean) {
    this.sendSilent = undefined

    if(clearInput) {
      void this.clearInput()
    }

    if(clearReply || clearInput) {
      this.clearHelper()
    }

    this.updateSendBtn()
  }

  /** Пакет параметров отправки — tweb `chat.ts:1378-1402` (расхождение 1 шапки). */
  public getMessageSendingParams(): MessageSendingParams {
    const replyTo = this.getReplyTo()
    return {
      threadId: this.chat.threadId ?? null,
      replyToMsgId: replyTo?.replyToMsgId ?? null,
      replyToQuote: replyTo?.replyToQuote ?? null,
      replyToPeerId: replyTo?.replyToPeerId != null && replyTo.replyToPeerId !== this.chat.peerId ? replyTo.replyToPeerId : null,
      silent: this.sendSilent,
    }
  }

  /**
   * Текст в пир — тело tweb `appMessagesManager.sendText` (:2670-2683, :2850-2860):
   * длинный режется `splitStringByLength`, сущности кусков — `sliceMessageEntities`,
   * маркеры разбирает `parseMarkdown`. Расхождения 2 и 4 шапки.
   */
  private async sendText(value: string, entities: MessageEntity[], sendingParams: MessageSendingParams) {
    const { peerId } = this.chat
    if(isUser(peerId) && !this.getDialog(peerId)) {
      await this.managers.chats.createPrivate(peerId)
      void this.managers.dialogs.refresh().catch(() => {})
    }

    const splitted = splitStringByLength(value, MESSAGE_LENGTH_MAX)
    const isChannel = isBroadcastPeer(peerId)
    let partOffset = 0
    for(const part of splitted) {
      const partEntities = splitted.length > 1 && entities.length ? sliceMessageEntities(entities, partOffset, part.length) : entities
      partOffset += part.length
      const [text, parsedEntities] = parseMarkdown(part, partEntities)
      const clientMsgId = crypto.randomUUID()
      const sendEntities = parsedEntities.length ? parsedEntities : undefined
      if(isChannel) {
        void this.managers.channels.post(peerId, text, clientMsgId, sendEntities, { senderId: rootScope.myId, threadRootId: this.chat.threadId })
      } else {
        void this.managers.messages.sendText({
          peerId,
          text,
          entities: sendEntities,
          clientMsgId,
          ...sendingParams,
          optimistic: { senderId: rootScope.myId },
        })
      }
    }
  }

  /** tweb `:4536-4653` — без медленного режима и платных (Б-37). */
  public async sendMessageWithForward({
    sendingParams,
    value,
    entities,
    forwarding,
    forwardParams = {},
  }: {
    sendingParams: MessageSendingParams,
    value: string,
    entities: MessageEntity[],
    forwarding?: ChatInput['forwarding'],
    forwardParams?: { dropAuthor?: boolean, dropCaption?: boolean },
  }) {
    const trimmedValue = value.trim()

    let messageCount = 0
    if(forwarding) {
      for(const fromPeerId in forwarding) {
        messageCount += forwarding[+fromPeerId as PeerId].length
      }
    }

    messageCount += trimmedValue ? splitStringByLength(value, MESSAGE_LENGTH_MAX).length : 0

    if(trimmedValue) {
      void this.sendText(value, entities, sendingParams)
    }

    for(const fromPeerId in forwarding) {
      const mids = forwarding[+fromPeerId as PeerId]
      void this.managers.messages.forwardMessages(this.chat.peerId, +fromPeerId, mids, forwardParams).catch(() => {})
    }

    return { value, messageCount }
  }

  /** tweb `:4655-4747` — расхождения 3, 8 шапки. */
  public async sendMessage(force = false) {
    const { editMsgId, chat } = this
    if(chat.type === ChatType.Scheduled && !force && !editMsgId) {
      return
    }

    if(!editMsgId) {
      if(!(await this.chat.canSend('send_messages'))) {
        return
      }

      const { value, entities } = getRichValueWithCaret(this.messageInputField.input, true, false)
      const result = await this.sendMessageWithForward({
        value,
        entities,
        sendingParams: this.getMessageSendingParams(),
        forwarding: this.forwarding,
      })

      if(!result.messageCount) {
        return
      }

      this.saveDraftDebounced.clearTimeout()
      this.clearedDraft = { peerId: chat.peerId, draft: this.getDialog(chat.peerId)?.draft }
      this.onMessageSent(true)
      return
    }

    const { value, entities } = getRichValueWithCaret(this.messageInputField.input, true, false)
    const trimmedValue = value.trim()
    const message = this.editMessage!
    if(trimmedValue || (message._ === 'message' && message.media)) {
      const [text, parsedEntities] = parseMarkdown(value, entities)
      void this.managers.messages.editMessage(chat.peerId, editMsgId, text, parsedEntities.length ? parsedEntities : undefined)

      this.onMessageSent()
    }
  }

  /** tweb `:4749-4833` — расхождение 5 шапки; медленный режим и платные — Б-37. */
  public async sendMessageWithDocument({ document }: { document: Sticker | GifItem, target?: HTMLElement }): Promise<boolean> {
    const isSticker = '_' in document
    const flag: ChatRights = 'send_media'
    if(!isUser(this.chat.peerId) && !(await this.chat.canSend(flag))) {
      toastNew({ langPackKey: POSTING_NOT_ALLOWED_MAP[flag]! })
      return false
    }

    const { peerId } = this.chat
    const sendingParams = this.getMessageSendingParams()
    const clientMsgId = crypto.randomUUID()
    if(isUser(peerId) && !this.getDialog(peerId)) {
      await this.managers.chats.createPrivate(peerId)
      void this.managers.dialogs.refresh().catch(() => {})
    }

    if(isSticker) {
      void this.managers.messages.sendText({
        peerId,
        text: '',
        clientMsgId,
        mediaId: document.id,
        type: 'sticker',
        ...sendingParams,
        optimistic: { senderId: rootScope.myId, document },
      })
      void this.managers.stickers.use(document.id).catch(() => {})
    } else if(document.mediaId != null) {
      void this.managers.messages.sendText({
        peerId,
        text: '',
        clientMsgId,
        mediaId: document.mediaId,
        type: 'video',
        ...sendingParams,
        optimistic: {
          senderId: rootScope.myId,
          media: { width: document.width, height: document.height, mime: document.mime, size: document.size, name: document.fileName, animated: true },
        },
      })
    } else if(document.mp4Url) {
      // Tenor-результат: файл качаем и шлём ГИФКОЙ (tweb `sendFile({isAnimated: true})`);
      // отправленный — в сохранённые (`addRecentGif`).
      const mp4Url = document.mp4Url
      void fetch(mp4Url).then((res) => {
        if(!res.ok) throw new Error(`HTTP ${res.status}`)
        return res.blob()
      }).then(async(blob) => {
        const { mediaId } = await this.managers.messages.sendFile({
          peerId,
          clientMsgId,
          senderId: rootScope.myId,
          file: blob,
          type: 'video',
          mime: 'video/mp4',
          fileName: 'tenor.mp4',
          width: document.width,
          height: document.height,
          isMedia: true,
          isAnimated: true,
          ...sendingParams,
        })
        if(mediaId != null) void this.managers.stickers.saveGif(mediaId).catch(() => {})
      }).catch(() => {})
    } else {
      return false
    }

    this.onMessageSent(false, true)
    return true
  }

  /** tweb `:4859-4895` */
  public initMessageEditing(mid: number) {
    const message = this.chat.getMessage(mid)
    if(!message || message._ !== 'message') return

    const totalEntities = mergeEntities(message.entities ?? [], parseEntities(message.message))
    let input: DocumentFragment | undefined = wrapDraftText(message.message, { entities: totalEntities, wrappingForPeerId: this.chat.peerId })
    const f = async() => {
      let restoreInputLock: (() => void) | undefined
      if(!this.messageInput.isContentEditable) {
        const placeholderParams = await this.getPlaceholderParams(true)
        const { contentEditable } = this.messageInput
        this.messageInput.contentEditable = 'true'
        const { oldKey, oldArgs } = this.updateMessageInputPlaceholder(placeholderParams) ?? {}

        restoreInputLock = () => {
          this.messageInput.contentEditable = contentEditable
          if(oldKey) this.updateMessageInputPlaceholder({ key: oldKey, args: oldArgs })
        }
      }

      this.setTopInfo({
        type: 'edit',
        callerFunc: f,
        title: i18n('AccDescrEditing'),
        subtitle: wrapMessageForReply({ message, plain: false }),
        input,
        message,
      })

      this.editMsgId = mid
      this.editMessage = message
      input = undefined

      this.restoreInputLock = restoreInputLock
    }
    return f()
  }

  /** tweb `:4963-5080` — без меню опций (Б-72), расхождение 7 шапки. */
  public initMessagesForward(fromPeerIdsMids: { [fromPeerId: PeerId]: number[] }) {
    const f = async() => {
      const fromPeerIds = Object.keys(fromPeerIdsMids).map((fromPeerId) => +fromPeerId as PeerId)
      const smth: Set<PeerId> = new Set()
      let length = 0

      const messagesByPeer = await Promise.all(fromPeerIds.map(async(fromPeerId) => {
        const mids = fromPeerIdsMids[fromPeerId]
        const messages = await Promise.all(mids.map((mid) => this.managers.messages.getMessageByPeer(fromPeerId, mid)))
        messages.forEach((message) => {
          if(message) smth.add(message.fromId ?? message.peerId)
        })

        length += mids.length
        return messages
      }))

      const onlyFirstName = smth.size > 2
      const middleware = this.getMiddleware()
      const peerTitles = [...smth].map((peerId) => {
        return peerId === rootScope.myId ?
          i18n('Chat.Accessory.Forward.You') :
          new PeerTitle({ peerId, onlyFirstName, middleware, managers: this.managers }).element
      })

      const title = i18n('Chat.Accessory.Forward', [length])

      const senderTitles = document.createDocumentFragment()
      if(peerTitles.length < 3) {
        senderTitles.append(...join(peerTitles, false))
      } else {
        senderTitles.append(peerTitles[0], i18n('AndOther', [peerTitles.length - 1]))
      }

      const subtitleFragment = document.createDocumentFragment()
      const delimiter = ': '
      const firstMessage = messagesByPeer[0]?.[0]
      if(length === 1 && firstMessage) {
        subtitleFragment.append(
          senderTitles,
          delimiter,
          wrapMessageForReply({ message: firstMessage, plain: false }),
        )
      } else {
        subtitleFragment.append(
          i18n('Chat.Accessory.Forward.From'),
          delimiter,
          senderTitles,
        )
      }

      this.setTopInfo({
        type: 'forward',
        callerFunc: f,
        title,
        subtitle: subtitleFragment,
      })

      this.forwarding = fromPeerIdsMids
    }

    void f()
  }

  /** tweb `:5082-5097` */
  public getChatInputReplyToFromMessage(message: MyMessage, quote?: MessageSendingParams['replyToQuote']) {
    const result: ChatInputReplyTo = {
      replyToMsgId: message?.id,
    }

    if(quote) result.replyToQuote = quote
    return result
  }

  /** tweb `:5099-5203` — расхождение 7 шапки. */
  public async initMessageReply(replyTo: ChatInputReplyTo) {
    const current = this.getReplyTo()
    if(current && current.replyToMsgId === replyTo.replyToMsgId && current.replyToPeerId === replyTo.replyToPeerId && current.replyToQuote?.text === replyTo.replyToQuote?.text) {
      return
    }

    const { replyToMsgId, replyToQuote } = replyTo
    const replyToPeerId = replyTo.replyToPeerId ?? this.chat.peerId
    let message: MyMessage | undefined = replyToPeerId === this.chat.peerId ?
      this.chat.getMessage(replyToMsgId!) :
      undefined
    message ??= await this.managers.messages.getMessageByPeer(replyToPeerId, replyToMsgId!)

    const isSameReply = () => {
      const r = this.getReplyTo()
      return r?.replyToMsgId === replyToMsgId
    }

    const f = () => {
      let title: HTMLElement
      if(!message) { // load missing replying message
        title = i18n('Loading')

        void this.managers.messages.reloadMessage(replyToPeerId, replyToMsgId!).then((_message) => {
          if(!isSameReply()) {
            return
          }

          message = _message

          if(!message) {
            this.clearHelper('reply')
          } else {
            f()
          }
        })
      } else {
        const peerId = message.fromId ?? message.peerId
        title = new PeerTitle({ peerId, middleware: this.getMiddleware(), managers: this.managers }).element

        title = i18n(replyToQuote ? 'ReplyToQuote' : 'ReplyTo', [title])
      }

      this.setTopInfo({
        type: 'reply',
        callerFunc: f,
        title,
        message,
        setColorPeerId: message?.fromId,
        quote: message ? replyToQuote ?? undefined : undefined,
      })
      this.setReplyTo(replyTo)
    }
    f()
  }

  /** tweb `:5249-5263` */
  public setReplyTo(replyTo?: ChatInputReplyTo) {
    const { replyToMsgId, replyToQuote, replyToPeerId } = replyTo || {}
    this.replyToMsgId = replyToMsgId
    this.replyToQuote = replyToQuote
    this.replyToPeerId = replyToPeerId
    void this.center(true)
  }

  /** tweb `:5265-5317` */
  public clearHelper(type?: ChatInputHelperType, willHaveHelper?: boolean) {
    if(this.helperType === 'edit' && type !== 'edit') {
      void this.clearInput()
    }

    if(type !== 'reply') {
      this.setReplyTo(undefined)
      this.forwarding = undefined
    }

    this.editMsgId = this.editMessage = undefined
    this.helperType = this.helperFunc = undefined
    void this.saveDraftDebounced?.()

    if(this.restoreInputLock) {
      this.restoreInputLock()
      this.restoreInputLock = undefined
    }

    if(
      this.chat.container &&
      this.chat.container.classList.contains('is-helper-active') &&
      !willHaveHelper
    ) {
      appNavigationController.removeByType('input-helper')
      this.chat.container.classList.remove('is-helper-active')
      this.helperVisible = false
      this.notifyChatInputHeight()
      this.t()
    }
  }

  /** tweb `:5319-5330` */
  private t() {
    const className = 'is-toggling-helper'
    SetTransition({
      element: this.chat.container,
      className,
      forwards: true,
      duration: 150,
      onTransitionEnd: () => {
        this.chat.container.classList.remove(className)
      },
    })
  }

  /** tweb `:5332-5351` */
  public setInputValue(
    value: Parameters<InputFieldAnimated['setValueSilently']>[0],
    clear = true,
    focus = true,
  ) {
    value ||= ''

    if(clear) void this.clearInput(false, false, value as string)
    else this.messageInputField.setValueSilently(value)

    fastRaf(() => {
      if(focus) placeCaretAtEnd(this.messageInput)
      this.onMessageInput()
      this.messageInput.scrollTop = this.messageInput.scrollHeight
    })
  }

  /** tweb `:5353-5426` — без меню плашки (Б-72) и цвета автора (`wrappers/reply.ts`). */
  public setTopInfo({
    type,
    callerFunc,
    title,
    subtitle,
    setColorPeerId,
    input,
    message,
    quote,
  }: {
    type: ChatInputHelperType,
    callerFunc: () => void,
    input?: Parameters<InputFieldAnimated['setValueSilently']>[0],
    message?: MyMessage,
  } & Pick<Parameters<typeof wrapReply>[0], 'title' | 'subtitle' | 'setColorPeerId' | 'quote'>) {
    if(type !== 'webpage') {
      this.clearHelper(type, true)
      this.helperType = type
      this.helperFunc = callerFunc
    }

    const replyParent = this.replyElements.content
    const oldReply = replyParent.lastElementChild!.previousElementSibling!
    const haveReply = oldReply.classList.contains('reply')

    this.replyElements.iconBtn.replaceWith(this.replyElements.iconBtn = this.createButtonIcon((type === 'webpage' ? 'link' : type) + ' reply-icon', {
      noRipple: true,
    }))
    this.replyElements.iconBtn.tabIndex = -1
    this.replyElements.iconBtn.setAttribute('aria-hidden', 'true')
    const { container } = wrapReply({
      title,
      subtitle,
      setColorPeerId,
      message,
      quote,
    })

    if(haveReply) {
      oldReply.replaceWith(container)
    } else {
      replyParent.lastElementChild!.before(container)
    }

    if(!this.chat.container.classList.contains('is-helper-active')) {
      this.chat.container.classList.add('is-helper-active')
      this.helperVisible = true
      this.notifyChatInputHeight()
      this.t()
    }

    if(!IS_MOBILE) {
      appNavigationController.pushItem(this.inputHelperNavigationItem = {
        type: 'input-helper',
        onPop: () => {
          void this.onHelperCancel()
        },
        context: this.chat,
      })
    }

    if(input !== undefined) {
      this.setInputValue(input)
    }

    setTimeout(() => {
      this.updateSendBtn()
    }, 0)

    return container
  }
}
