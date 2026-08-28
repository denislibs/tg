/**
 * Контекстное меню сообщения — порт tweb `src/components/chat/contextMenu.ts`
 * (`ChatContextMenu`, 2347 строк) в объёме, у которого есть ПРЕДМЕТ: пункт
 * попадает в порт только если действие реально доступно приложению (менеджер,
 * попап или подсистема существуют). Разметку, порядок пунктов, условия показа
 * и позиционирование задаёт tweb — референс `docs/tweb/message-interactions.md`
 * §1.1-1.7.
 *
 * ─── Что портировано ────────────────────────────────────────────────────────
 *  • `attachTo` (:246-348): десктоп — `attachContextMenuListener` (правый клик),
 *    тач — обычный тап по баблу с отсевом по «плохим селекторам» (:289-307);
 *    подписка на `history_delete` закрывает открытое меню (:323-347);
 *  • `onContextMenu` (:350-585): `bubble-content-wrapper` → `bubble`, отсев
 *    дата-бабла, `preventDefault` только для мыши, выход при уже активном меню,
 *    `prepareForMessage` → `init` → `positionMenu` → `openBtnMenu`;
 *  • `prepareForMessage` (:427-518) в объёме доступных фактов;
 *  • `filterButtons` (:694-713), `setButtons` (:715-1315), `init` (:1490-1771),
 *    `canDownload`/`onDownloadClick` (:1434-1480, :2178-2190), `cleanup`,
 *    `destroy`;
 *  • обработчики пунктов (:1853-2065) — каждый там, где есть носитель действия.
 *
 * ─── Пункты tweb БЕЗ ПРЕДМЕТА (не выдуманы и не заглушены) ──────────────────
 *  • ограничения голосования в опросе (:860-873) — флагов `subscribers_only`/
 *    `countries_iso2` у нашего `Poll` нет вовсе;
 *  • сабменю пункта чеклиста (:888-896) и варианта опроса (:896-908) —
 *    `createSubmenuTrigger`/`floatingButtonMenu` не портированы, чек-листы
 *    (`messageMediaToDo`) лента не рисует;
 *  • `MessageScheduleSend`/`Selection.SendNow`/`MessageScheduleEditTime`
 *    (:908-938) — `ChatType.Scheduled` у императивной ленты нет: окно
 *    отложенных живёт отдельным экраном, а не типом чата;
 *  • `Quote` (:938-954) — `getRichSelection` стоит на `getRichValueWithCaret`
 *    (разбор contenteditable в текст+сущности), которого в проекте нет;
 *  • `ViewReplies`/`ViewAllReplies` (:965-997) — поля `replies`
 *    (`MessageReplies`) в нашей модели сообщения нет;
 *  • `AddToFavorites`/`SaveToGIFs` и парные им (:997-1007) — verify оригинала
 *    показывает пункт ТОЛЬКО при уже закэшированном списке избранного
 *    (`managers.acknowledged.*`), синхронного снимка избранных стикеров/гифок
 *    у нас нет, а сетевой запрос на каждое открытие меню — другое поведение;
 *  • `ChecklistAddTasks` (:1014-1024) — чек-листов нет;
 *  • `TranslateMessage` (:1095-1127) — verify это ОПРЕДЕЛЁННЫЙ язык сообщения
 *    (`detectLanguageForTranslation` → tinyld); детектора нет, а «показывать
 *    всегда» — расхождение React-версии, а не порт;
 *  • `PollStats.View` (:1184-1189) — статистики опроса нет ни в менеджере, ни
 *    в оверлее;
 *  • `Resend` (:1260-1265) — `repayRequest` (платные сообщения) отсутствует;
 *  • sponsored-блок (:107-183, :1292-1302) — рекламных сообщений нет;
 *  • «Message contains emoji pack(s)» (:1303-1314) — пункт показывает НАЗВАНИЕ
 *    набора по `document_id` кастом-эмодзи (`getCachedCustomEmojiDocuments`),
 *    связки «документ кастом-эмодзи → набор» в проекте нет;
 *  • спец-набор `ChatType.Logs` (:716-736) — админ-логов лента не показывает;
 *  • спец-набор тег-реакции «Избранного» (:738-795) и ветка `reaction-element`
 *    в `onContextMenu` (:392-413) — наши чипы это `div.reaction`, а не
 *    кастом-элементы `reaction-element`/`reactions-element` с `reactionCount`
 *    и `getContext()` (`components/chat/reactions.ts`);
 *  • `.reaction.is-paid` → `PopupStarReaction` (:386-390) — платных реакций
 *    лента не рисует;
 *  • спец-набор аватарки серии (:797-835) — САМА аватарка в ленте уже есть
 *    (`components/avatar.ts` + `ChatBubbles.createAvatar`), но её меню у
 *    оригинала состоит из пунктов о ПИРЕ («открыть профиль», «отправить
 *    сообщение», упоминание), а не о сообщении: это отдельный набор со своим
 *    носителем — навигацией по пирам, которой у ленты нет
 *    (`BubblesNavigation.openPeer` не передаётся, см. `VanillaFeed.tsx`).
 *
 * ─── Семь пунктов React-меню (строка долгов в `web-client/CLAUDE.md`) ───────
 * Снесённое меню React-ленты держало семь пунктов, которых здесь нет. Разбор
 * каждого: что это в ОРИГИНАЛЕ и чего не хватает. Четыре из семи пунктами
 * `ChatContextMenu` не являются вовсе — их не «забыли портировать», их
 * придумала React-версия либо они принадлежат другому компоненту tweb.
 *  • «Переотправить» упавшее сообщение — пункта «повторить сорванную отправку»
 *    у оригинала НЕТ. Единственный `Resend` (:1260-1265) — повторная ОПЛАТА
 *    платного сообщения (`handleRepay`, :2166-2176), он назван выше. Ручного
 *    повтора tweb не знает по построению: сорванную отправку переигрывает
 *    транспорт, а `message.error` даёт лишь право удалить бабл
 *    (`canDeleteMessage`, appMessagesManager.ts:5841-5848 — то же слагаемое
 *    `!is_outgoing || !!error`, что и в порте ниже). У нас упавшая отправка —
 *    флаг `failed` и ручки `messages.retryPending`/`cancelPending`
 *    (`core/managers/messages/pending.ts:569-586`), сейчас без единого
 *    вызывающего. Это расхождение НАШЕЙ модели отправки с оригиналом, а не
 *    пункт меню: изобретать кнопку, которой у tweb нет, здесь нельзя.
 *  • «Перевести» — пункт у оригинала есть (:1095-1127), ручка перевода есть и
 *    у нас (`messages.translate` → бэкенд `/translate`), но нет РЕШЕНИЯ
 *    ПОКАЗАТЬ: `verify: () => !!this.messageLanguage` (:1126), а
 *    `messageLanguage` — это `detectLanguageForTranslation`
 *    (`helpers/detectLanguageForTranslation.ts`) = настройка
 *    `translations.showInMenu` + `appConfig.translations_manual_enabled` +
 *    tinyld. Ни одного из трёх нет, то есть дословный порт дал бы ВЕЧНО
 *    ЛОЖНЫЙ verify — мёртвую кнопку; попап `@components/popups/translate`
 *    тоже не портирован. См. также пункт выше.
 *  • ⭐-реакция — пунктом меню не является: `PopupStarReaction` открывают два
 *    места, клик по чипу `.reaction.is-paid` (:385-390) и выбор `reactionPaid`
 *    в панели быстрых реакций (:1676-1677). Оба названы выше и в «Механике,
 *    которой здесь нет»; `messages.sendStarReaction` жив, но носитель у него
 *    платный чип, а не строка меню.
 *  • «Ответить в другом чате» — в `ChatContextMenu` такого пункта нет:
 *    `ReplyToAnotherChat` — это меню ПЛАШКИ ОТВЕТА композера
 *    (`chat/input.ts:647-651`, `onClick: () => this.changeReplyRecipient()`).
 *    Долг композера, не ленты.
 *  • «Кто просмотрел» — ПОРТИРОВАН, строка долга неверна: это оба пункта
 *    `localName: 'views'` (:875-887 личного чата и :1244-1259 группы), а
 *    «сколько просмотрело» пишет групповая ветка `init` (:1543-1644) —
 *    `messages.viewers` → «Seen by N»/«Nobody viewed».
 *  • «Сохранить GIF» — пункт у оригинала есть (:997-1002; парный — :1003-1007), ручки
 *    `stickers.saveGif`/`deleteGif` есть и у нас, но verify (:844-856) читает
 *    УЖЕ ЗАКЭШИРОВАННЫЙ список (`managers.acknowledged.appGifsManager
 *    .getGifs()`) и возвращает false, пока кэша нет; наш `stickers.savedGifs`
 *    — голый сетевой GET, а `filterButtons` ждёт verify ДО показа меню.
 *    Дословный порт — снова вечно ложный verify (мёртвая кнопка), запрос на
 *    каждый правый клик — другое поведение и задержка открытия меню. Тем же
 *    кэшем гейтится парный `Message.Context.RemoveGif` (:1003-1007), без него
 *    пункт всегда предлагал бы «сохранить» уже сохранённое.
 *  • «Copy Media» — такого пункта в tweb нет вовсе: ни ключа в `lang.ts`, ни
 *    записи картинки в буфер из меню (`helpers/clipboard.ts` умеет только
 *    текст и HTML; единственный `ClipboardItem` с картинкой во всём tweb —
 *    QR-код профиля, `popups/myQrCode.tsx:945`). Изобретение React-версии.
 *
 * ─── Механика, которой здесь нет ────────────────────────────────────────────
 *  • ПАНЕЛЬ БЫСТРЫХ РЕАКЦИЙ (`appendReactionsMenu`, :2229-2282, и весь
 *    `getReactionsMenuPadding`/`getReactionsOpenPosition`) — `ChatReactionsMenu`
 *    не портирован. Поэтому `menuPadding` не считается и в `positionMenu` не
 *    передаётся: без панели он в оригинале тоже `undefined`.
 *  • Long-press по реакции на таче (:249-280) — цель жеста (`reaction-element`)
 *    не существует, см. выше.
 *  • `PopupToggleReadDate` (:878-880) — попапа приватности «когда прочитано»
 *    нет; пункт read-date остаётся информационным, как и в React-версии.
 *  • `StackedAvatars` в групповой ветке `views` (:1596-1644) — компонента нет,
 *    пункт показывает только текст со счётчиком;
 *  • список за пунктом `views` группы у оригинала ОБЩИЙ: `PopupReactedList`
 *    рисует и реакции, и просмотревших — их одним ответом отдаёт
 *    `getMessageReactionsListAndReadParticipants` (:1586). У нас он теперь
 *    тоже общий: `popups.showReactedList` → `useMessageActions.showReactedUsers`
 *    сливает `messages.reactionUsers` и `messages.viewers` тем же правилом
 *    (реакции, следом не-реагировавшие просмотревшие);
 *  • `ContextMenuDeleteOptionText` (:1268-1279) — вторая строка под «Удалить»
 *    с датой самоуничтожения: компонент подписи не портирован, пункт остаётся
 *    однострочным (класс `with-subtitle` вместе с ним не ставится);
 *  • числа в подписях пунктов режима выделения (`Message.Context.Selection.*`
 *    у tweb это «Copy N messages») — падежные формы даёт langPack, которого
 *    нет: текст остаётся тем же, что и у одиночного пункта.
 *
 * ─── Адаптации ──────────────────────────────────────────────────────────────
 *  • `Chat`/`AppManagers` → узкие порт-интерфейсы (`ContextMenuChat`,
 *    `ContextMenuBubbles`, `ContextMenuManagers`, `ContextMenuPopups`) — тем
 *    же способом, каким лента объявляет `ChatContext`/`BubblesManagers`
 *    (`components/chat/bubbles.ts`);
 *  • `pFlags.is_outgoing` («ещё не отправлено») у нас — ДРОБНЫЙ номер
 *    (`isLocalMessageId`), `message.error` — флаг `failed`;
 *  • `PeerId.isUser()` → `isUser(peerId)` (`core/peers/peerId.ts`), права —
 *    `hasRightsPeer` (`core/peerCache.ts`), как и в `peerTitle.ts`;
 *  • `LangPackKey` + `i18n()` → строка через `useI18nStore.getState().t`:
 *    langPack не портирован (та же подмена в `components/buttonMenu.ts`);
 *  • `getAppWindow()`/`getOverlayRoot()` (окно Document PiP) → `window`/
 *    `document.body`;
 *  • поле `isLegacy` (`messagePeerId !== chat.peerId`, verify Reply/Pin/
 *    CopyMessageLink) не портировано: у ленты ОДНО окно и она сама пишет
 *    `bubble.dataset.peerId = chat.peerId` (bubbles.ts:890) — условие ложно
 *    по построению, то есть было бы мёртвой веткой;
 *  • ветка thread/comment в `getUrlToMessage` (:1780-1798) не портирована:
 *    наш `buildMessageLink` адресует пару «пир + номер», параметров
 *    `?thread=`/`?comment=` в его формате нет.
 */
import ButtonMenu, { type ButtonMenuItemOptions } from '@components/buttonMenu'
import Icon from '@components/icon'
import IS_TOUCH_SUPPORTED from '@environment/touchSupport'
import filterAsync from '@helpers/array/filterAsync'
import { copyTextToClipboard } from '@helpers/clipboard'
import contextMenuController from '@helpers/contextMenuController'
import { attachContextMenuListener } from '@helpers/dom/attachContextMenuListener'
import cancelEvent from '@helpers/dom/cancelEvent'
import { attachClickEvent } from '@helpers/dom/clickEvent'
import findUpClassName from '@helpers/dom/findUpClassName'
import isSelectionEmpty from '@helpers/dom/isSelectionEmpty'
import ListenerSetter from '@helpers/listenerSetter'
import { getMiddleware } from '@helpers/middleware'
import noop from '@helpers/noop'
import positionMenu from '@helpers/positionMenu'
import rootScope from '@lib/rootScope'
import { friendlyMsgTime } from '@core/format/friendlyTime'
import { isLocalMessageId, getServerMessageId } from '@core/history/messageId'
import { mirrorWindow } from '@core/history/messagesMirror'
import { getMediaFromMessage, type MyDocument } from '@core/media/messageMedia'
import { buildMessageLink } from '@core/messageLink'
import { getMessageText, type MyMessage, type MessageReal } from '@core/models'
import {
  cachedChat,
  cachedUser,
  hasRightsPeer,
  isBroadcastPeer,
  isChannelPeer,
  peerTitle,
} from '@core/peerCache'
import { isAnyChat, isUser, NULL_PEER_ID, SERVICE_PEER_ID } from '@core/peers/peerId'
import type { ReadDateResult } from '@core/managers/chatsManager'
import { useI18nStore } from '../../i18n'
import type ChatSelection from './selection'

/**
 * Срез `Chat`, которым пользуется меню — тот же приём, что `ChatContext` у
 * ленты (`bubbles.ts`): tweb передаёт в конструктор весь `Chat` (топбар, инпут,
 * поиск, выделение), у нас поимённо перечислено ровно нужное.
 */
export interface ContextMenuChat {
  peerId: PeerId
  /** ключ окна в зеркале — источник сообщений (tweb `chat.getMessageByPeer`
   *  ходит в `apiManagerProxy`, у нас окно лежит в `messagesMirror`) */
  messagesStorageKey: string
  /** tweb `chat.canSend()` — асинхронный, как в оригинале */
  canSend(): boolean | Promise<boolean>
  /** Порт tweb `!!chat.input.messageInput` (verify Reply/Edit): «композер
   *  существует», то есть в чат в принципе можно писать. */
  hasMessageInput(): boolean
  /** Порт `chat.input.initMessageReply(getChatInputReplyToFromMessage(message))`
   *  (:1861-1872). Наружу едет только номер: собрать плашку умеет владелец
   *  композера — ровно как у ленты (`ChatContext.initMessageReply`). */
  initMessageReply(mid: number): void
  /** Порт `chat.input.initMessageEditing(mid)` (:1912) */
  initMessageEditing(mid: number): void
  /** Порт `chat.initSearch({query, filterPeerId})` (:1046) */
  initSearch(options: { query?: string, filterPeerId?: PeerId }): void
  /**
   * Порт `chat.bubbles.canForward` (bubbles.ts:9802).
   *
   * ОПЦИОНАЛЕН, и это честная граница: факта `pFlags.noforwards` (ни у
   * сообщения, ни у пира) в нашей модели нет вовсе — та же дыра, что у
   * `SelectionManagers.cantForwardDeleteMids` (`selection.ts`). Не передан —
   * пересылать можно всё, как отвечает оригинал при отсутствии запретов.
   */
  canForward?(message: MyMessage): boolean
}

/**
 * Срез ЛЕНТЫ — по образцу `SelectionBubbles` (`selection.ts`). Меню нужна одна
 * её часть: живой режим выделения. В tweb он висит на `Chat`
 * (`chat.selection`), у нас владелец — лента (`ChatBubbles.selection`), потому
 * что она же создаёт его фабрикой хоста.
 */
export interface ContextMenuBubbles {
  readonly selection?: ChatSelection
}

/** Срез менеджеров — только те вызовы, которые делают пункты меню. */
export interface ContextMenuManagers {
  messages: {
    /** Порт `appPollsManager.sendVote(message, [])` (:2004) — снять голос */
    votePoll(peerId: number, pollId: number, options: number[]): Promise<unknown>
    /** Порт `appPollsManager.stopPoll(message)` (:2008) */
    closePoll(pollId: number): Promise<void>
    /** Порт `appMessagesManager.getMessageReadParticipants` — кто просмотрел
     *  (групповая ветка пункта `views`, :1596-1644) */
    viewers(peerId: number, msgId: number): Promise<number[]>
  }
  chats: {
    /** Порт `appMessagesManager.getOutboxReadDate` (:1518) */
    getReadDate(peerId: number, msgId: number): Promise<ReadDateResult>
  }
  media: {
    /** Порт `appDownloadManager.downloadToDisc({media})` (:2189) */
    downloadToDisc(message: MyMessage): void | Promise<void>
  }
}

/**
 * Срез НОСИТЕЛЕЙ ПОПАПОВ. В tweb это прямые `PopupElement.createPopup(...)` /
 * `showForwardPopup(...)` / таб правой колонки; ни одного из этих попапов в
 * ванильном виде у нас нет — их владелец React-хост, поэтому меню объявляет
 * намерение, а исполняет его реализация (та же граница, что у
 * `SelectionPlate` в `selection.ts`).
 */
export interface ContextMenuPopups {
  /** `PopupPinMessage(peerId, mid)` / `(…, true)` (:1994-2000) */
  showPinMessage(peerId: PeerId, mid: number, unpin?: boolean): void
  /** `PopupDeleteMessages(peerId, mids, chatType)` (:2056-2061) */
  showDeleteMessages(peerId: PeerId, mids: number[]): void
  /** `showForwardPopup({[peerId]: mids})` (:2028-2030) */
  showForward(fromPeerIdsMids: Record<number, number[]>): void
  /** `showMessageReport(peerId, mids, onSuccess?)` (:1216-1220) */
  showMessageReport(peerId: PeerId, mids: number[], onSuccess?: () => void): void
  /**
   * `PopupElement.createPopup(PopupReactedList, message)` (:1245-1251).
   *
   * ТРЕТИЙ аргумент — адаптация, а не порт: у tweb это МОДАЛЬНЫЙ попап по
   * центру экрана, которому якорь не нужен, а у нашей реализации список
   * позиционируемый (`ReactedUsersPopup` в `components/messages/ChatDialogs`,
   * его открывает `useMessageActions.showReactedUsers(msgId, x, y)`). Ровно тот
   * же якорь React-меню добывает перехватом последнего `MouseEvent` на
   * `.btn-menu-items` ради «Кто просмотрел» (в снесённом React-меню);
   * здесь событие приезжает прямо в `onClick` пункта (`buttonMenu.ts`
   * `ButtonMenuItemOptions.onClick`), перехватывать нечего.
   */
  showReactedList(peerId: PeerId, mid: number, at: { x: number, y: number }): void
  /** таб `AppStatisticsTab` правой колонки (:2108-2112) */
  showStatistics(peerId: PeerId, mid: number): void
  /** `confirmationPopup` + `InputField` редактора проверки фактов (:1916-1992) */
  showFactCheckEditor(peerId: PeerId, mid: number): void
}

/** Порт tweb `ChatContextMenuButton` (:99-105) в применимом составе:
 *  `isSponsored` выброшен вместе со sponsored-пунктами, `localName` сузился до
 *  `views` (ветки `emojis`/`sponsorInfo` предмета не имеют). */
type ChatContextMenuButton = ButtonMenuItemOptions & {
  verify: () => boolean | Promise<boolean>
  withSelection?: true
  localName?: 'views'
}

// `notDirect` (и поле `isOverBubble`, по которому он читается) не портированы:
// у самого tweb это МЁРТВАЯ ветка `filterButtons` — условие там записано как
// `this.isOverBubble || IS_TOUCH_SUPPORTED || true`, то есть ветка
// `button.notDirect && ...` недостижима (:705-707).

/** Селекторы, по которым обычный тап НЕ открывает меню — tweb :289-307,
 *  дословно. Ни один не выброшен: узла с таким классом у нас может ещё не
 *  быть, но список это ПРАВИЛО оригинала, а не перечень существующих узлов. */
const BAD_SELECTORS = [
  '.name',
  '.peer-title',
  '.reply',
  '.document',
  'audio-element',
  'a',
  '.bubble-beside-button',
  'replies-element',
  '[data-saved-from]:not(.bubble)',
  'poll-element',
  '.attachment',
  '.reply-markup-button',
  '.bubble-view-button',
  '.webpage',
  '.bubbles-group-avatar',
  '.bubble-service-button',
]

/** Точка клика по пункту меню — якорь позиционируемого попапа реализации
 *  (см. докблок `ContextMenuPopups.showReactedList`). */
function pointerPosition(e: MouseEvent | TouchEvent): { x: number, y: number } {
  const point = 'changedTouches' in e ? e.changedTouches[0] : e
  return { x: point.clientX, y: point.clientY }
}

export default class ChatContextMenu {
  private buttons: ChatContextMenuButton[] = []
  private element?: HTMLElement

  private isSelectable = false
  private isSelected = false
  private target: HTMLElement | null = null
  private isTargetAGroupedItem = false
  private isTextSelected = false
  private isAnchorTarget = false
  private isUsernameTarget = false
  private isEmailTarget = false
  private peerId: PeerId = NULL_PEER_ID
  private messagePeerId: PeerId = NULL_PEER_ID
  private mid = 0
  private message?: MyMessage
  private mainMessage?: MyMessage
  private groupedMessages?: MyMessage[]
  private selectedMessages?: MyMessage[]
  private noForwards = false
  private linkToMessage?: { url: string, isPrivate: boolean }
  private selectedMessagesText?: string

  // tweb :232-233 — заполняются уже открытым меню (ветки пункта `views`) и
  // читаются его же `onClick`/`checkForClose`.
  private canViewReadTime?: boolean
  private canOpenReactedList?: boolean

  private listenerSetter = new ListenerSetter()
  private attachListenerSetter = new ListenerSetter()
  private middleware = getMiddleware()

  constructor(
    private chat: ContextMenuChat,
    private bubbles: ContextMenuBubbles,
    private managers: ContextMenuManagers,
    private popups: ContextMenuPopups,
  ) {}

  /** tweb `this.chat.selection` — у нас владелец режима выделения это лента. */
  private get selection(): ChatSelection | undefined {
    return this.bubbles.selection
  }

  /** Порт `attachTo` (:246-348). */
  public attachTo(element: HTMLElement) {
    this.attachListenerSetter.removeAll()

    if(IS_TOUCH_SUPPORTED) {
      // tweb :282-315 — обычный тап по баблу открывает меню, если цель не
      // попала в «плохие селекторы».
      attachClickEvent(element, (e) => {
        if(this.selection?.isSelecting) {
          return
        }

        const good = !(e.target as HTMLElement).closest(BAD_SELECTORS.join(', '))
        if(good) {
          cancelEvent(e)
          this.onContextMenu(e)
        }
      }, { listenerSetter: this.attachListenerSetter })
    } else attachContextMenuListener({
      element,
      callback: this.onContextMenu,
      listenerSetter: this.attachListenerSetter,
    })

    // * handle message deletion (tweb :323-347)
    this.attachListenerSetter.add(rootScope)('history_delete', ({ peerId, msgs }) => {
      if(peerId !== this.chat.peerId) {
        return
      }

      if(this.mid && msgs.has(this.mid)) {
        contextMenuController.close()
        return
      }

      if(this.selection?.isSelecting && this.selectedMessages) {
        const hasDeletedSelectedMessage = this.selectedMessages.some((message) => msgs.has(message.id))
        if(hasDeletedSelectedMessage) {
          contextMenuController.close()
          return
        }
      }

      if(this.groupedMessages) {
        const hasDeletedGroupedMessage = this.groupedMessages.some((message) => msgs.has(message.id))
        if(hasDeletedGroupedMessage) {
          contextMenuController.close()
        }
      }
    })
  }

  /** Порт `onContextMenu` (:350-585). */
  public onContextMenu = (e: MouseEvent | TouchEvent) => {
    let bubble: HTMLElement | undefined | null, contentWrapper: HTMLElement | undefined | null

    try {
      const target = e.target as HTMLElement
      contentWrapper = findUpClassName(target, 'bubble-content-wrapper')
      bubble = contentWrapper ? contentWrapper.parentElement : findUpClassName(target, 'bubble')
    } catch {} // tweb :357 — `findUpClassName` по чужому target'у может бросить

    // tweb :362-363. Комментарий оригинала («context menu click by date
    // bubble») ВВОДИТ В ЗАБЛУЖДЕНИЕ, и повторять его нельзя: `bubble-first`
    // помечает не дата-бабл, а ПЛЕЙСХОЛДЕР пустого чата
    // (tweb bubbles.ts:10785, ветка `renderEmptyPlaceholder`). Дата-бабл несёт
    // `bubble service is-date` (tweb bubbles.ts:4801) и до обработчика не
    // доходит по другой причине — `pointer-events: none` у `.is-date`
    // (`styles/tweb/_chatBubble.scss:486`), о чём сам комментарий и пишет
    // второй половиной.
    if(!bubble || bubble.classList.contains('bubble-first')) return

    let element = this.element
    if(!('touches' in e) && 'preventDefault' in e) e.preventDefault()
    if(element && element.classList.contains('active')) {
      return false
    }
    // tweb :374 пишет `e.cancelBubble = true`; по спецификации это ровно
    // `stopPropagation()` (устаревший алиас), и зовём мы его, потому что у
    // алиаса нет сеттера вне браузера — событие в тестовой среде на записи
    // бросает `TypeError`.
    if(!('touches' in e)) e.stopPropagation()

    // Номер бабла — tweb :376. У неотправленного он дробный
    // (`generateTempMessageId`), поэтому `+` вместо `parseInt`.
    const bubbleElement = bubble
    let mid = +(bubbleElement.dataset.mid ?? NaN)
    if(!mid && mid !== 0) {
      return
    }

    /** Порт `prepareForMessage` (:427-518). */
    const prepareForMessage = async() => {
      const selection = this.selection
      this.isSelectable = !!selection?.canSelectBubble(bubbleElement)
      // tweb :430-431. Адрес бабла (`data-peer-id`) и адрес чата у нашей ленты
      // всегда совпадают — окно у неё одно (`bubbles.ts:890`), — но читаем мы
      // именно узел: это адрес ИМЕННО ЭТОГО сообщения.
      const bubblePeerId = bubbleElement.dataset.peerId
      this.messagePeerId = bubblePeerId ? +bubblePeerId : this.chat.peerId
      this.peerId = this.messagePeerId
      this.target = e.target as HTMLElement
      this.isTextSelected = !isSelectionEmpty()
      this.isAnchorTarget = this.target.tagName === 'A' && (
        (this.target as HTMLAnchorElement).target === '_blank' ||
        this.target.classList.contains('anchor-url')
      )
      this.isEmailTarget = this.isAnchorTarget && (this.target as HTMLAnchorElement).href.startsWith('mailto:')
      this.isUsernameTarget = this.target.tagName === 'A' && this.target.classList.contains('mention')

      // * если открыть контекстное меню для альбома не по бабблу, и последний
      // элемент не выбран, чтобы показать остальные пункты (tweb :477-489).
      // Номера альбома tweb берёт выше по телу (:472) безусловно — там это
      // await к менеджеру; у нас обход зеркала, и он делается по месту.
      if(selection?.isSelecting && !contentWrapper && mid) {
        const mids = this.getMidsByMid(mid)
        if(mids.length > 1) {
          const selectedMid = selection.isMidSelected(this.messagePeerId, mid) ?
            mid :
            mids.find((m) => selection.isMidSelected(this.messagePeerId, m))
          if(selectedMid) {
            mid = selectedMid
          }
        }
      }

      const groupedItem = findUpClassName(this.target, 'grouped-item')
      this.isTargetAGroupedItem = !!groupedItem
      this.mid = groupedItem ? +(groupedItem.dataset.mid ?? NaN) : mid

      this.isSelected = !!selection?.isMidSelected(this.messagePeerId, this.mid)
      this.message = this.getMessageByPeer(this.mid)
      const groupedId = this.message?._ === 'message' ? this.message.grouped_id : undefined
      this.groupedMessages = groupedId ? this.getMessagesByGroupedId(groupedId) : undefined
      if(!groupedItem && this.groupedMessages) this.message = this.getMainGroupedMessage(this.groupedMessages)
      this.mainMessage = this.groupedMessages ? this.getMainGroupedMessage(this.groupedMessages) : this.message
      this.selectedMessages = selection?.isSelecting ? this.getSelectedMessages() : undefined
      this.noForwards = !!this.message &&
        !(this.selectedMessages || [this.message]).every((message) => this.canForward(message))
      this.canOpenReactedList = undefined
      this.canViewReadTime = undefined
      this.linkToMessage = this.getUrlToMessage()
      this.selectedMessagesText = this.getSelectedMessagesText()
    }

    const openMenu = async() => {
      await prepareForMessage()

      const initResult = await this.init()
      if(!initResult) {
        return
      }

      element = initResult.element
      const { cleanup, destroy } = initResult

      // tweb :550 — сторона РАСКРЫТИЯ: у входящего влево, у исходящего вправо.
      const side: 'left' | 'right' = bubbleElement.classList.contains('is-in') ? 'left' : 'right'
      // `menuPadding` не передаётся: его считает только панель быстрых реакций
      // (:1693), которой в порте нет — в оригинале без неё он тоже undefined.
      positionMenu(e, element, side)

      contextMenuController.openBtnMenu(element, () => {
        this.mid = 0
        this.peerId = NULL_PEER_ID
        this.target = null
        this.canViewReadTime = undefined
        this.canOpenReactedList = undefined
        cleanup()

        setTimeout(() => {
          destroy()
        }, 300)
      })
    }

    void openMenu()
  }

  /** Порт `cleanup` (:682-686) без панели реакций. */
  public cleanup() {
    this.listenerSetter.removeAll()
    this.middleware.clean()
  }

  /** Порт `destroy` (:688-691). */
  public destroy() {
    this.cleanup()
    this.attachListenerSetter.removeAll()
  }

  /** Порт `filterButtons` (:694-713) без sponsored-ветки. */
  private async filterButtons(buttons: ChatContextMenuButton[]) {
    return filterAsync(buttons, async(button) => {
      let good: boolean

      if(this.selection?.isSelecting && !button.withSelection) {
        good = false
      } else {
        good = await button.verify()
      }

      return !!good
    })
  }

  /** Порт `setButtons` (:715-1315) — состав и ПОРЯДОК оригинала. */
  private setButtons() {
    const t = useI18nStore.getState().t

    this.buttons = [{
      // tweb :875-887 — пункт `views` личного чата: дата прочтения исходящего.
      // `onClick` оригинала открывает `PopupToggleReadDate`, когда время
      // скрыто приватностью; попапа у нас нет — пункт информационный.
      onClick: noop,
      verify: () => isUser(this.peerId) && this.canViewMessageReadParticipants(),
      localName: 'views',
      checkForClose: () => {
        return this.canViewReadTime !== undefined
      },
    }, {
      icon: 'reply',
      text: t('Reply'),
      onClick: this.onReplyClick,
      verify: async() => !!this.message &&
        !this.isOutgoing(this.message) &&
        this.chat.hasMessageInput() &&
        (this.canForward(this.message) || !!await this.chat.canSend()),
    }, {
      icon: 'edit',
      text: t('Edit'),
      onClick: this.onEditClick,
      verify: () => this.canEditMessage(this.message, 'text') && this.chat.hasMessageInput(),
    }, {
      icon: 'factcheck',
      // tweb :1026 — текст зависит от наличия проверки у ГЛАВНОГО сообщения
      text: (this.mainMessage as MessageReal | undefined)?.factcheck ? t('Edit Fact Check') : t('Add Fact Check'),
      onClick: this.onEditFactCheckClick,
      verify: () => !!this.mainMessage && this.canUpdateFactCheck(this.mainMessage),
    }, {
      icon: 'copy',
      text: t('Copy'),
      onClick: this.onCopyClick,
      verify: () => !this.noForwards &&
        !!this.message && !!getMessageText(this.message) &&
        !this.isTextSelected &&
        (!this.isAnchorTarget || getMessageText(this.message) !== this.target?.innerText),
    }, {
      icon: 'copy',
      text: t('Copy Selected Text'),
      onClick: this.onCopyClick,
      verify: () => !this.noForwards && !!this.message && !!getMessageText(this.message) && this.isTextSelected,
    }, {
      icon: 'search',
      text: t('Search Selected'),
      onClick: () => {
        const selection = window.getSelection()
        this.chat.initSearch({ query: selection?.toString() })
      },
      verify: () => !!this.message && !!getMessageText(this.message) && this.isTextSelected,
    }, {
      icon: 'copy',
      text: t('Copy'),
      onClick: this.onCopyClick,
      verify: () => {
        if(!this.isSelected || this.noForwards) {
          return false
        }

        return !!this.selectedMessages?.some((message) => !!getMessageText(message))
      },
      withSelection: true,
    }, {
      icon: 'copy',
      text: this.isEmailTarget ? t('Copy Email') : t('Copy Link'),
      onClick: this.onCopyAnchorLinkClick,
      verify: () => this.isAnchorTarget,
      withSelection: true,
    }, {
      icon: 'copy',
      text: t('Copy Username'),
      onClick: () => {
        void copyTextToClipboard(this.target?.textContent ?? '')
      },
      verify: () => this.isUsernameTarget,
      withSelection: true,
    }, {
      icon: 'copy',
      text: t('Copy Hashtag'),
      onClick: () => {
        void copyTextToClipboard(this.target?.textContent ?? '')
      },
      verify: () => !!this.target?.classList.contains('anchor-hashtag'),
      withSelection: true,
    }, {
      icon: 'link',
      text: t('Copy Message Link'),
      onClick: this.onCopyLinkClick,
      verify: () => isChannelPeer(this.peerId) &&
        !!this.message &&
        !this.isOutgoing(this.message),
    }, {
      icon: 'pin',
      text: t('Pin'),
      onClick: this.onPinClick,
      verify: () => !!this.message &&
        !this.isOutgoing(this.message) &&
        this.message._ !== 'messageService' &&
        !this.message.pFlags.pinned &&
        this.canPinMessage(this.message.peerId),
    }, {
      icon: 'unpin',
      text: t('Unpin'),
      onClick: this.onUnpinClick,
      verify: () => !!this.message?.pFlags.pinned && this.canPinMessage(this.message.peerId),
    }, {
      icon: 'download',
      text: t('Download'),
      onClick: () => ChatContextMenu.onDownloadClick(this.managers, this.message, this.noForwards),
      verify: () => ChatContextMenu.canDownload(this.message, this.target, this.noForwards),
    }, {
      icon: 'checkretract',
      text: t('Retract Vote'),
      onClick: this.onRetractVote,
      verify: () => {
        const media = this.getPollMedia()
        if(!media || media.poll.pFlags?.closed) return false

        // tweb :1160 `poll.chosenIndexes.length`; у нас «мой голос» — флаг
        // ВАРИАНТА в итогах (`PollAnswerVoters.pFlags.chosen`).
        // `revoting_disabled` в нашей модели опроса нет вовсе.
        return !!media.results.results?.some((r) => r.pFlags?.chosen)
      },
    }, {
      icon: 'stop',
      text: t('Stop Poll'),
      onClick: this.onStopPoll,
      verify: () => {
        const media = this.getPollMedia()
        return this.canEditMessage(this.message, 'poll') &&
          !!media &&
          !media.poll.pFlags?.closed &&
          !!this.message && !this.isOutgoing(this.message)
      },
    }, {
      icon: 'statistics',
      text: t('Statistics'),
      onClick: this.onStatisticsClick,
      verify: this.canViewMessageStatistics,
    }, {
      icon: 'forward',
      text: t('Forward'),
      // let forward the message if it's outgoing but not ours (like a changelog)
      onClick: this.onForwardClick,
      verify: () => !this.noForwards &&
        !!this.message &&
        (!this.isOutgoing(this.message) || this.message.fromId === SERVICE_PEER_ID) &&
        this.message._ !== 'messageService',
    }, {
      icon: 'forward',
      text: t('Forward'),
      onClick: this.onForwardClick,
      // tweb :1202 сверяется с кнопкой плашки (`selectionForwardBtn` +
      // её `disabled`); плашка у нас — порт-интерфейс без узлов, а факта
      // «нельзя переслать выбранное» не существует (см. `selection.ts`),
      // поэтому остаётся сам признак «есть выбранное».
      verify: () => this.isSelected && !!this.selection?.length(),
      withSelection: true,
    }, {
      icon: 'download',
      text: t('Download'),
      onClick: () => ChatContextMenu.onDownloadClick(this.managers, this.selectedMessages, this.noForwards),
      verify: () => !!this.selectedMessages &&
        ChatContextMenu.canDownload(this.selectedMessages, null, this.noForwards),
      withSelection: true,
    }, {
      icon: 'flag',
      text: t('Report'),
      onClick: () => {
        const selection = this.selection
        const selectedMids = selection?.isSelecting && this.isSelected ?
          selection.selectedMids.get(this.messagePeerId) :
          undefined
        this.popups.showMessageReport(
          this.messagePeerId,
          selectedMids?.size ? [...selectedMids] : [this.mid],
          selectedMids?.size ? () => selection?.cancelSelection() : undefined,
        )
      },
      verify: () => !!this.message &&
        !this.message.pFlags.out &&
        this.message._ === 'message' &&
        !this.isOutgoing(this.message) &&
        isChannelPeer(this.messagePeerId),
      withSelection: true,
    }, {
      icon: 'select',
      text: t('Select'),
      onClick: this.onSelectClick,
      verify: () => !!this.message && this.message._ !== 'messageService' && !this.isSelected && this.isSelectable,
      withSelection: true,
    }, {
      icon: 'select',
      text: t('Clear Selection'),
      onClick: this.onClearSelectionClick,
      verify: () => this.isSelected,
      withSelection: true,
    }, {
      // tweb :1244-1260 — пункт `views` группы/канала: «кто отреагировал /
      // просмотрел», клик открывает список.
      onClick: (e) => {
        if(this.canOpenReactedList && this.message) {
          this.popups.showReactedList(this.messagePeerId, this.message.id, pointerPosition(e))
        }
      },
      verify: () => !isUser(this.peerId) &&
        (!!this.message?.reactions?.recent_reactions?.length || this.canViewMessageReadParticipants()),
      localName: 'views',
    }, {
      icon: 'delete',
      className: 'danger',
      text: t('Delete'),
      onClick: this.onDeleteClick,
      verify: () => this.canDeleteMessage(this.message),
    }, {
      icon: 'delete',
      className: 'danger',
      text: t('Delete'),
      onClick: this.onDeleteClick,
      // tweb :1287 сверяется с `selectionDeleteBtn.disabled` — см. Forward выше
      verify: () => this.isSelected && !!this.selection?.length(),
      withSelection: true,
    }]
  }

  /** Порт `init` (:1490-1771) без панели реакций и пункта эмодзи-наборов. */
  private async init() {
    this.cleanup()
    this.setButtons()

    const filteredButtons = await this.filterButtons(this.buttons)
    if(!filteredButtons.length) {
      return
    }

    const element = this.element = await ButtonMenu({
      buttons: filteredButtons,
      listenerSetter: this.listenerSetter,
    })
    element.id = 'bubble-contextmenu'
    element.classList.add('contextmenu')

    const viewsButton = filteredButtons.find((button) => button.localName === 'views')
    if(viewsButton && this.message && isUser(this.peerId)) {
      // tweb :1506-1541 — иконка `checks`, шиммер-лоадер на месте текста,
      // разделитель под пунктом, затем ответ `getOutboxReadDate`.
      viewsButton.element?.prepend(Icon('checks', 'btn-menu-item-icon'))
      const loader = document.createElement('div')
      loader.classList.add('btn-menu-item-loader', 'shimmer')
      viewsButton.textElement?.append(loader)

      viewsButton.element?.after(document.createElement('hr'))
      const delimiter = viewsButton.element?.nextElementSibling

      const middleware = this.middleware.get()
      const { id } = this.message
      void this.managers.chats.getReadDate(this.peerId, id).then((result) => {
        if(!middleware()) {
          return
        }

        // tweb различает успех и ошибку `YOUR_PRIVACY_RESTRICTED`; у нас тот же
        // третий исход приезжает значением (`ReadDateResult`, chatsManager.ts).
        if(!result) {
          delimiter?.remove()
          viewsButton.element?.remove()
          return
        }

        if('restricted' in result) {
          this.canViewReadTime = false
          const when = document.createElement('span')
          when.classList.add('show-when')
          when.textContent = useI18nStore.getState().t('show when')
          loader.replaceWith(useI18nStore.getState().t('Read'), ' ', when)
          return
        }

        this.canViewReadTime = true
        loader.replaceWith(friendlyMsgTime(result.readAt, useI18nStore.getState().lang))
      })
    } else if(viewsButton && this.message) {
      // tweb :1543-1644 — групповая ветка. Портирован её каркас: иконка
      // (`reactions` либо `checks`), текст со счётчиком и признак «список
      // можно открыть». `StackedAvatars` и падежные формы i18n — см. шапку.
      const reactions = this.message.reactions
      const recentReactions = reactions?.recent_reactions
      const isViewingReactions = !!recentReactions?.length
      const reactedLength = reactions ? reactions.results.reduce((acc, r) => acc + r.count, 0) : 0

      viewsButton.element?.prepend(Icon(isViewingReactions ? 'reactions' : 'checks', 'btn-menu-item-icon'))

      const t = useI18nStore.getState().t
      const middleware = this.middleware.get()
      const { id } = this.message
      if(isViewingReactions) {
        this.canOpenReactedList = true
        viewsButton.textElement?.replaceChildren(`${t('Reacted')} ${reactedLength}`)
      } else {
        viewsButton.textElement?.replaceChildren(t('Loading'))
        void this.managers.messages.viewers(this.messagePeerId, id).then((viewers) => {
          if(!middleware()) {
            return
          }

          if(!viewers.length) {
            viewsButton.textElement?.replaceChildren(t('Nobody viewed'))
            return
          }

          this.canOpenReactedList = true
          viewsButton.textElement?.replaceChildren(`${t('Seen by')} ${viewers.length}`)
        })
      }
    }

    document.body.append(element)

    return {
      element,
      cleanup: () => {
        this.cleanup()
      },
      destroy: () => {
        element.remove()
      },
    }
  }

  // ── Факты сообщения ────────────────────────────────────────────────────────

  /** Окно чата в зеркале — источник сообщений (tweb `chat.getMessageByPeer`). */
  private getMessageByPeer(mid: number): MyMessage | undefined {
    return mirrorWindow(this.chat.messagesStorageKey)?.find((m) => m.id === mid)
  }

  /** Порт `appMessagesManager.getMessagesByGroupedId` (альбом), тот же обход,
   *  что у ленты (`bubbles.ts::groupedMessages`). */
  private getMessagesByGroupedId(groupedId: number): MyMessage[] {
    const window = mirrorWindow(this.chat.messagesStorageKey)
    if(!window) return []
    return window
      .filter((m) => m._ === 'message' && m.grouped_id === groupedId)
      .sort((a, b) => a.id - b.id)
  }

  /** Порт `getMainGroupedMessage` — ПЕРВОЕ по возрастанию номера. */
  private getMainGroupedMessage(messages: MyMessage[]): MyMessage | undefined {
    return messages[0]
  }

  /** Порт `chat.getMidsByMid` (:472) — номера всего альбома либо один номер. */
  private getMidsByMid(mid: number): number[] {
    const message = this.getMessageByPeer(mid)
    const groupedId = message?._ === 'message' ? message.grouped_id : undefined
    if(!groupedId) return [mid]
    return this.getMessagesByGroupedId(groupedId).map((m) => m.id)
  }

  /** Порт `chat.selection.getSelectedMessages` (:492). В нашем `ChatSelection`
   *  метода нет (у него не было ни одного вызывающего, см. его шапку) — тот же
   *  обход делается здесь: выбранные номера + окно зеркала. */
  private getSelectedMessages(): MyMessage[] {
    const selection = this.selection
    if(!selection) return []
    const messages: MyMessage[] = []
    for(const [peerId, mids] of selection.selectedMids) {
      if(peerId !== this.chat.peerId) continue
      for(const mid of mids) {
        const message = this.getMessageByPeer(mid)
        if(message) messages.push(message)
      }
    }

    return messages
  }

  /** Порт `pFlags.is_outgoing` — «ещё не отправлено». У нас это дробный номер
   *  (`generateTempMessageId`), а не флаг. */
  private isOutgoing(message: MyMessage): boolean {
    return isLocalMessageId(message.id)
  }

  /** Порт `chat.bubbles.canForward` (bubbles.ts:9802) через порт-интерфейс. */
  private canForward(message: MyMessage | undefined): boolean {
    if(!message || message._ !== 'message') return false
    return this.chat.canForward ? this.chat.canForward(message) : true
  }

  /** Порт `appPeersManager.canPinMessage` (appPeersManager.ts:38-40). */
  private canPinMessage(peerId: PeerId): boolean {
    return isUser(peerId) || hasRightsPeer(peerId, 'pin_messages')
  }

  /** Порт `appMessagesManager.canDeleteMessage` (:5841-5848). Из четырёх
   *  слагаемых оригинала выпало одно — базовая группа (`chat._ === 'chat'`):
   *  такого конструктора бэкенд не производит вовсе (`core/peers/peerId.ts`). */
  private canDeleteMessage(message: MyMessage | undefined): boolean {
    return !!message && (
      isUser(message.peerId) ||
      !!message.pFlags.out ||
      hasRightsPeer(message.peerId, 'delete_messages')
    ) && (!this.isOutgoing(message) || !!(message as MessageReal).failed)
  }

  /** Порт `appMessagesManager.canMessageBeEdited` (:5773-5804).
   *
   *  Не портированы (фактов нет): `via_bot_id` и `messageMediaToDo` в модели
   *  отсутствуют. */
  private canMessageBeEdited(message: MyMessage | undefined, kind: 'text' | 'poll'): boolean {
    if(!message) return false
    if(this.isOutgoing(message)) return false

    const goodMedias = ['messageMediaPhoto', 'messageMediaDocument', 'messageMediaWebPage']
    if(kind === 'poll') {
      goodMedias.push('messageMediaPoll')
    }

    if(message._ !== 'message' ||
      message.fwd_from ||
      (message.media && goodMedias.indexOf(message.media._) === -1) ||
      this.isBot(message.fromId)) {
      return false
    }

    if(message.media?._ === 'messageMediaDocument') {
      const doc = message.media.document as MyDocument | undefined
      if(!doc || doc.type === 'sticker' || doc.type === 'round') {
        return false
      }
    }

    return true
  }

  /** Порт `appUsersManager.isBot` через зеркало карточек. */
  private isBot(peerId: PeerId | undefined): boolean {
    if(peerId === undefined) return false
    const user = cachedUser(peerId)
    return user?._ === 'user' && !!user.pFlags?.bot
  }

  /** Порт `appMessagesManager.canEditMessage` (:5806-5839).
   *
   *  Не портированы: ограничение по времени (`config.edit_time_limit` — своего
   *  `appConfig` у нас нет), монофорумы и миграция базовой группы. Право
   *  `send_plain` оригинала здесь `send_messages` — гранулярных запретов новых
   *  слоёв в нашем `ChatRights` нет (`core/peers/rights.ts`). */
  private canEditMessage(message: MyMessage | undefined, kind: 'text' | 'poll' = 'text'): boolean {
    if(!message || !this.canMessageBeEdited(message, kind)) {
      return false
    }

    // * second rule for saved messages, because there is no 'out' flag
    if(message.peerId === rootScope.myId) {
      return true
    }

    const { peerId } = message
    return isBroadcastPeer(peerId) ?
      hasRightsPeer(peerId, 'edit_messages') :
      (
        isAnyChat(peerId) && kind === 'text' ?
          (hasRightsPeer(peerId, 'send_messages') || hasRightsPeer(peerId, 'send_media')) :
          true
      ) && !!message.pFlags.out
  }

  /** Порт `appMessagesManager.canViewMessageReadParticipants` (:9109-9130) в
   *  объёме имеющихся фактов: `pFlags.unread`, боты, монофорумы и
   *  `pm_read_date_expire_period`/`read_dates_private` у нас не живут. */
  private canViewMessageReadParticipants(): boolean {
    const message = this.message
    if(
      !message ||
      this.isOutgoing(message) ||
      !message.pFlags.out ||
      message.peerId === rootScope.myId ||
      isBroadcastPeer(message.peerId)
    ) {
      return false
    }

    return true
  }

  /** Порт `canViewMessageStatistics` (:2113-2117). `appProfileManager
   *  .canViewStatistics` у нас — право `just_admin` (`useGroupInfo.ts`). */
  private canViewMessageStatistics = () => {
    return isBroadcastPeer(this.messagePeerId) &&
      hasRightsPeer(this.messagePeerId, 'just_admin') &&
      !!this.message && !this.isOutgoing(this.message)
  }

  /** Порт `appMessagesManager.canUpdateFactCheck` (:10797-10809) без
   *  `appConfig.can_edit_factcheck` — своего `appConfig` у нас нет. */
  private canUpdateFactCheck(message: MyMessage): boolean {
    if(!isBroadcastPeer(message.peerId)) {
      return false
    }

    return message._ === 'message' && hasRightsPeer(message.peerId, 'just_admin')
  }

  /** Опрос кликнутого сообщения — общий предикат пунктов «отменить голос» и
   *  «остановить опрос». */
  private getPollMedia() {
    const message = this.message
    if(message?._ !== 'message' || message.media?._ !== 'messageMediaPoll') return undefined
    return message.media
  }

  /** Порт `canDownload` (:1434-1480). Не портирована ветка сенситив-медиа
   *  (:1474-1477): ни `restriction_reason`, ни `hasSensitiveSpoiler` у нас
   *  нет. */
  public static canDownload(
    message: MyMessage | MyMessage[] | undefined,
    withTarget?: HTMLElement | null,
    noForwards?: boolean,
  ): boolean {
    if(Array.isArray(message)) {
      return message.some((m) => ChatContextMenu.canDownload(m, withTarget, noForwards))
    }

    if(!message || !ChatContextMenu.canSaveMessageMedia(message, noForwards)) {
      return false
    }

    const media = message._ === 'message' ? message.media : undefined
    const isPhoto = media?._ === 'messageMediaPhoto'
    const document = media?._ === 'messageMediaDocument' ? media.document : undefined
    let isGoodType = false

    if(isPhoto) {
      isGoodType = true
    } else {
      if(!document) {
        return false
      }

      isGoodType = true
    }

    let hasTarget = !withTarget || !!IS_TOUCH_SUPPORTED

    if(isGoodType && withTarget) {
      hasTarget ||= !!(findUpClassName(withTarget, 'document') ||
        findUpClassName(withTarget, 'audio') ||
        findUpClassName(withTarget, 'media-sticker-wrapper') ||
        findUpClassName(withTarget, 'media-photo') ||
        findUpClassName(withTarget, 'media-video'))
    }

    return isGoodType && hasTarget
  }

  /** Порт `canSaveMessageMedia` (`utils/messages/canSaveMessageMedia.ts`).
   *  `pFlags.noforwards` (у сообщения) и `extended_media` инвойса в нашей
   *  модели отсутствуют, поэтому запрет приезжает только аргументом. */
  private static canSaveMessageMedia(message: MyMessage, noForwards?: boolean): boolean {
    if(isLocalMessageId(message.id)) {
      return false
    }

    if(!noForwards) {
      return true
    }

    const document = message._ === 'message' && message.media?._ === 'messageMediaDocument' ?
      message.media.document as MyDocument | undefined :
      undefined
    if(!document) {
      return false
    }

    return !(['video', 'gif', 'round', 'sticker'] as (MyDocument['type'])[]).includes(document.type)
  }

  /** Порт `getUrlToMessage` (:1773-1802). Ссылка наша (`core/messageLink.ts`):
   *  публичного `t.me` у клона нет, зато формат разбирает наш же клиент. */
  private getUrlToMessage(): { url: string, isPrivate: boolean } | undefined {
    if(!this.message || isUser(this.messagePeerId)) {
      return
    }

    const chat = cachedChat(this.messagePeerId)
    const username = chat?._ === 'channel' ? chat.username : undefined
    return {
      url: buildMessageLink({
        origin: location.origin,
        pathname: location.pathname,
        peerId: this.messagePeerId,
        username,
        seq: getServerMessageId(this.message.id),
      }),
      isPrivate: !username,
    }
  }

  /** Порт `getSelectedMessagesText` (:1804-1851) в текстовой части: сортировка
   *  по времени отправки и мета «имя, [дата]» при нескольких сообщениях.
   *
   *  Html-вариант (`prepareTextWithEntitiesForCopying` → `wrapRichText` +
   *  `documentFragmentToHTML`) не портирован вместе с самим хелпером — см.
   *  шапку `helpers/clipboard.ts`. */
  private getSelectedMessagesText(): string | undefined {
    if(!isSelectionEmpty()) {
      return
    }

    let rawMessages: MyMessage[]
    if(!this.selection?.isSelecting) {
      const message = this.getMessageWithText()
      if(!message) {
        return
      }

      rawMessages = [message]
    } else {
      rawMessages = this.getSelectedMessages()
    }

    // sort by send time so the copied text follows the chronological order,
    // not the selection order (tweb :1832)
    const messages = rawMessages
      .filter((message) => !!getMessageText(message))
      .sort((a, b) => a.date - b.date || a.id - b.id)

    if(!messages.length) {
      return
    }

    if(messages.length === 1) {
      return getMessageText(messages[0])
    }

    return messages.map((message) => {
      // tweb :1846 `getPeerTitle({peerId, plainText: true})` — у нас тот же
      // синхронный вопрос к зеркалу карточек (`core/peerCache.ts`).
      const title = message.fromId === undefined ? '' : peerTitle(message.fromId)
      const date = new Date(message.date * 1000).toLocaleString()
      return `${title}, [${date}]\n${getMessageText(message)}`
    }).join('\n\n')
  }

  /** Порт `getMessageWithText` (:1482-1484) — текст альбома лежит у того его
   *  элемента, у которого он есть. */
  private getMessageWithText(): MyMessage | undefined {
    const grouped = this.groupedMessages?.find((message) => !!getMessageText(message))
    return grouped || this.message
  }

  // ── Обработчики пунктов ────────────────────────────────────────────────────

  /** Порт `onReplyClick` (:1861-1872) без ветки reply-picker
   *  (`createReplyPicker` — «ответить в чат, куда писать нельзя»: своего
   *  пикера у ванильного меню нет). */
  private onReplyClick = () => {
    if(!this.message) return
    this.chat.initMessageReply(this.message.id)
  }

  /** Порт `onEditClick` (:1898-1914) без чек-листов и suggested-постов. */
  private onEditClick = () => {
    const message = this.getMessageWithText()
    if(!message) return
    this.chat.initMessageEditing(this.isTargetAGroupedItem ? this.mid : message.id)
  }

  /** Порт `onEditFactCheckClick` (:1916-1992): у оригинала попап собирается
   *  прямо здесь (`confirmationPopup` + `InputField`), у нас его владелец —
   *  реализация порта. */
  private onEditFactCheckClick = () => {
    const message = this.mainMessage
    if(!message) return
    this.popups.showFactCheckEditor(message.peerId, message.id)
  }

  /** Порт `onCopyClick` (:1994-2001). */
  private onCopyClick = () => {
    if(isSelectionEmpty()) {
      if(this.selectedMessagesText) {
        void copyTextToClipboard(this.selectedMessagesText)
      }
    } else {
      document.execCommand('copy')
    }
  }

  /** Порт `onCopyAnchorLinkClick` (:2003-2007). */
  private onCopyAnchorLinkClick = () => {
    let href = (this.target as HTMLAnchorElement).href
    href = href.replace(/^mailto:/, '')
    void copyTextToClipboard(href)
  }

  /** Порт `onCopyLinkClick` (:2009-2014) — тост + копирование. */
  private onCopyLinkClick = () => {
    if(!this.linkToMessage) return
    const { url, isPrivate } = this.linkToMessage
    const t = useI18nStore.getState().t
    rootScope.dispatchEvent(
      'ui:toast',
      isPrivate ? t('Link copied. This link will only work for chat members.') : t('Link copied to clipboard'),
    )
    void copyTextToClipboard(url)
  }

  /** Порт `onPinClick`/`onUnpinClick` (:2016-2022). */
  private onPinClick = () => {
    this.popups.showPinMessage(this.messagePeerId, this.mid)
  }

  private onUnpinClick = () => {
    this.popups.showPinMessage(this.messagePeerId, this.mid, true)
  }

  /** Порт `onRetractVote`/`onStopPoll` (:2024-2030). */
  private onRetractVote = () => {
    const media = this.getPollMedia()
    if(!media) return
    void this.managers.messages.votePoll(this.messagePeerId, media.poll.id, [])
  }

  private onStopPoll = () => {
    const media = this.getPollMedia()
    if(!media) return
    void this.managers.messages.closePoll(media.poll.id)
  }

  /** Порт `onStatisticsClick` (:2108-2112). */
  private onStatisticsClick = () => {
    if(!this.message) return
    this.popups.showStatistics(this.messagePeerId, this.message.id)
  }

  /** Порт `onForwardClick` (:2032-2044). Ветка selection у оригинала кликает
   *  по кнопке плашки; у нас плашка это порт-интерфейс без узлов, поэтому
   *  попап forward открывается тем же вызовом, что и из неё. */
  private onForwardClick = () => {
    const peerId = this.messagePeerId
    if(this.selection?.isSelecting) {
      const mids = this.selection.getSelectedMids()
      if(mids.length) {
        this.popups.showForward({ [peerId]: mids })
      }

      return
    }

    const mids = this.isTargetAGroupedItem ? [this.mid] : this.getMidsByMid(this.mid)
    this.popups.showForward({ [peerId]: mids })
  }

  /** Порт `onSelectClick` (:2046-2048). */
  private onSelectClick = () => {
    if(!this.target) return
    const element = findUpClassName(this.target, 'grouped-item') || findUpClassName(this.target, 'bubble')
    if(element) {
      this.selection?.toggleByElement(element)
    }
  }

  /** Порт `onClearSelectionClick` (:2050-2052). */
  private onClearSelectionClick = () => {
    this.selection?.cancelSelection()
  }

  /** Порт `onDeleteClick` (:2054-2065) — та же развилка «выбранное / это
   *  сообщение», что у forward. */
  private onDeleteClick = () => {
    const peerId = this.messagePeerId
    if(this.selection?.isSelecting) {
      const mids = this.selection.getSelectedMids()
      if(mids.length) {
        this.popups.showDeleteMessages(peerId, mids)
      }

      return
    }

    if(!this.message) return
    const mid = this.message.id
    this.popups.showDeleteMessages(peerId, this.isTargetAGroupedItem ? [mid] : this.getMidsByMid(mid))
  }

  /** Порт `onDownloadClick` (:2178-2190). Носитель скачивания — менеджер
   *  медиа (у оригинала `appDownloadManager`), поэтому он приезжает
   *  аргументом: сам метод статический, как в tweb. */
  public static onDownloadClick(
    managers: ContextMenuManagers,
    messages: MyMessage | MyMessage[] | undefined,
    noForwards?: boolean,
  ): void {
    if(Array.isArray(messages)) {
      messages.forEach((message) => ChatContextMenu.onDownloadClick(managers, message, noForwards))
      return
    }

    if(!messages || !ChatContextMenu.canDownload(messages, undefined, noForwards)) {
      return
    }

    if(!getMediaFromMessage(messages)) {
      return
    }

    void managers.media.downloadToDisc(messages)
  }
}
