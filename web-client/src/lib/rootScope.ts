// src/lib/rootScope.ts — порт tweb rootScope.ts:29-315. Каталог событий приложения
// (BroadcastEvents) + класс шины (RootScope) поверх вендореного EventListenerBase.
//
// В tweb каталог — «событие → один payload» (rootScope.ts:29-246), слушатель
// выводится как `(e: payload) => void` (:248-250). Нам нужен второй аргумент
// (meta — pts/catchUp funnel'а), и EventListenerBase доставляет его штатно
// (dispatchEvent(name, ...args)), поэтому каталог здесь — кортеж аргументов:
// [payload] для обычных событий, [payload, EventMeta?] для тех, что идут через
// funnel курсора воркера (все `logged`-типы src/core/realtime/eventCatalog.ts +
// new_message — см. пометки ниже).
import EventListenerBase from '@helpers/eventListenerBase'
import { RT } from '@core/realtime/events'
import type {
  NewMessageEvt, EditMessageEvt, DeleteMessageEvt, PinMessageEvt, ReadEvt, MediaReadEvt,
  TypingEvt, PresenceEvt, ReactionEvt, StarReactionEvt, AckEvt, MessageErrorEvt, CallFrameEvt,
  ChatRemovedEvt, DraftUpdateEvt, ChatThemeUpdateEvt, ChatUpdateEvt, SuggestedPostEvt, BotCallbackAnswerEvt,
  GeoLiveUpdateEvt, WebPageUpdateEvt, FactCheckUpdateEvt, StoryNewEvt, StoryDeletedEvt,
  StoryReactionEvt, ConnState, UserUpdateEvt,
} from '@core/realtime/events'
import type { Message, RawPoll, RawChecklist, RawBoostStatus, RawGiveaway } from '@core/models'
import type { GroupCallFrame } from '@core/calls/groupCallEngine'
import type { LivestreamFrame } from '@core/calls/livestreamEngine'
import type { FolderUpdateEvt } from '@stores/foldersStore'
import type { MessageOp } from '@core/realtime/messageOps'
import type { PeerOp } from '@core/managers/peersManager'
import type { DialogOp } from '@core/dialogs/dialogOps'
import type { User } from '@core/managers/authManager'
import type { MediaTokenInfo, MediaUrlEvt } from '@core/managers/mediaManager'
import type { StickerSet } from '@core/managers/stickersManager'

export type { EventMeta } from '@rpc/superMessagePort'
import type { EventMeta } from '@rpc/superMessagePort'

// Каталог 1:1 переносит бывший core/realtime/eventBus.ts:RtEventMap (ключ за ключом,
// удалён — все потребители переведены на rootScope), дополненный:
// RT.folderUpdate/userUpdate (в RtEventMap их не было),
// служебными rt:resync/media:upload_progress/state:mirror и бывшими UI-командами
// core/hooks/uiEvents.ts (toast, savedTagsChanged; тоже удалён).
export type BroadcastEvents = {
  // ── funnel курсора (logged, несут pts) — второй элемент кортежа EventMeta? ──
  [RT.newMessage]: [NewMessageEvt, EventMeta?]
  // Операции над окнами сообщений (Stage 1B.2, Task 3) — летит РЯДОМ с
  // RT.newMessage, тем же meta (та же точка funnel'а курсора).
  [RT.messageOp]: [{ ops: MessageOp[] }, EventMeta?]
  [RT.editMessage]: [EditMessageEvt, EventMeta?]
  [RT.deleteMessage]: [DeleteMessageEvt, EventMeta?]
  [RT.pinMessage]: [PinMessageEvt, EventMeta?]
  [RT.read]: [ReadEvt, EventMeta?]
  [RT.mediaRead]: [MediaReadEvt, EventMeta?]
  [RT.reaction]: [ReactionEvt, EventMeta?]
  [RT.starReaction]: [StarReactionEvt, EventMeta?]
  [RT.chatRemoved]: [ChatRemovedEvt, EventMeta?]
  [RT.draftUpdate]: [DraftUpdateEvt, EventMeta?]
  [RT.chatThemeUpdate]: [ChatThemeUpdateEvt, EventMeta?]
  [RT.chatUpdate]: [ChatUpdateEvt, EventMeta?]
  [RT.folderUpdate]: [FolderUpdateEvt, EventMeta?]
  [RT.userUpdate]: [UserUpdateEvt, EventMeta?]
  // Операции над карточками пиров (Stage 1C.2, Task 2) — публикует peersManager
  // воркера. Без EventMeta: кадр порождает не funnel курсора, а сам менеджер (в
  // т.ч. на обычный ответ /users, у которого никакого pts нет).
  [RT.peerOp]: [{ ops: PeerOp[] }]
  // Stage «владение диалогами» (этап 1) — публикует dialogsManager воркера. Без
  // EventMeta по той же причине, что и rt:peer_op: не funnel курсора.
  [RT.dialogOp]: [{ ops: DialogOp[] }]
  [RT.dialogPin]: [{ chat_id: number; pinned: boolean }, EventMeta?]
  [RT.dialogArchive]: [{ chat_id: number; archived: boolean }, EventMeta?]
  [RT.dialogMute]: [{ chat_id: number; muted: boolean }, EventMeta?]
  [RT.pollUpdate]: [{ chat_id: number; poll: RawPoll }, EventMeta?]
  [RT.checklistUpdate]: [{ chat_id: number; checklist: RawChecklist }, EventMeta?]
  [RT.boostUpdate]: [{ chat_id: number; status: RawBoostStatus }, EventMeta?]
  [RT.giveawayUpdate]: [{ chat_id: number; giveaway: RawGiveaway }, EventMeta?]
  [RT.balanceUpdate]: [{ balance: number }, EventMeta?]
  [RT.paidMediaUnlock]: [NewMessageEvt, EventMeta?]
  [RT.webPageUpdate]: [WebPageUpdateEvt, EventMeta?]
  [RT.factCheckUpdate]: [FactCheckUpdateEvt, EventMeta?]

  // ── ephemeral (без pts, прямая трансляция) и bespoke (спец-обработка на onFrame) ──
  [RT.typing]: [TypingEvt]
  [RT.presence]: [PresenceEvt]
  [RT.ack]: [AckEvt]
  [RT.messageError]: [MessageErrorEvt]
  [RT.call]: [CallFrameEvt]
  [RT.suggestedPost]: [SuggestedPostEvt]
  [RT.groupCall]: [GroupCallFrame]
  [RT.livestream]: [LivestreamFrame]
  [RT.botCallbackAnswer]: [BotCallbackAnswerEvt]
  [RT.geoLiveUpdate]: [GeoLiveUpdateEvt]
  [RT.secretRequest]: [{ chat_id: number; initiator_id: number; responder_id: number }]
  [RT.secretAccept]: [{ chat_id: number; state?: string; fingerprint?: string[] }]
  [RT.secretReject]: [{ chat_id: number }]
  [RT.storyNew]: [StoryNewEvt]
  [RT.storyDeleted]: [StoryDeletedEvt]
  [RT.storyReaction]: [StoryReactionEvt]
  // ВНИМАНИЕ читающему payload любого из трёх событий ниже: он НЕ источник правды
  // (см. events.ts:RT.state и докблок realtime.ts:getStatus — там же точная
  // граница, что тут 1:1 с tweb, а что нет). Автомат (Задача 3) обязан на
  // получение ЛЮБОГО из трёх звать managers.realtime.getStatus() и брать значение
  // оттуда — иначе получим два источника факта, ровно тот дубль, который
  // параллельно вычищает этап 1C.2.
  //
  // Для RT.state эта pull-дисциплина 1:1 с tweb: `connectionStatus.ts:47-51` на
  // `connection_status_change` игнорирует payload и пуллит getConnectionStatus()
  // (:87-91) отдельным запросом. Для RT.stateSynchronizing/RT.stateSynchronized —
  // НЕ порт: у tweb (:53-64) `this.updating` берётся из самого факта события
  // (никакого pull), `updating` вообще не входит в getConnectionStatus()
  // (`rootScope.ts:293` отдаёт только карту `connectionStatus`). Пуллить и здесь
  // тоже — наше сознательное расширение той же дисциплины на вторую ось
  // (обоснование — докблок getStatus в realtime.ts), не факт оригинала.
  [RT.state]: [{ state: ConnState; retryAt?: number }]
  // tweb apiUpdatesManager.ts:460-469 (state_synchronizing/state_synchronized) —
  // начало/конец catch-up (/sync); автомат витрины (Задача 3) слушает пару.
  // Payload — null (1:1 с tweb rootScope.ts:131-132: 'state_synchronized' объявлен
  // как `void`, без payload — обработчики только переключают флаг).
  [RT.stateSynchronizing]: [null]
  [RT.stateSynchronized]: [null]
  // Stage 1C.2 (Task 1): `me` — воркер единственный владелец (workerCore.ts::
  // setMe), payload — полный снимок пользователя (null — разлогинен).
  [RT.me]: [User | null]
  // Stage 1C.2 (Task 1, раунд 4): намерение перехода сессии (порт tweb
  // `logging_out`, см. докблок в core/realtime/events.ts). `migrateTo` — id
  // аккаунта, на который переехала сессия; null — активного не осталось.
  [RT.loggingOut]: [{ migrateTo: number | null }]
  // Симметричный кадр входа (порт tweb `account_logged_in`): активная сессия
  // ПОЯВИЛАСЬ, `userId` — кто вошёл.
  [RT.loggedIn]: [{ userId: number }]
  // Stage 1C.2 (Task 3): медиа-токен — воркер единственный владелец
  // (mediaManager::fetchToken), payload — снимок {token, expiresAt}. Витрина
  // (core/mediaUrl.ts) его только зеркалит, своего расписания не держит.
  [RT.mediaToken]: [MediaTokenInfo]
  // Task 6 (медиа-суперпорт, стадия C): objectURL скачанного медиа — воркер
  // единственный владелец (mediaManager::downloadMediaURL), payload — снимок
  // {id, thumb, url, size}. Витрина (core/mediaCache.ts) его только зеркалит.
  [RT.mediaUrl]: [MediaUrlEvt]

  // Пяти событий rt:pending_* здесь больше нет: жизненный цикл неотправленного
  // бабла живёт в менеджере воркера (core/managers/messages/pending.ts) и
  // объявляется наружу теми же MessageOp (RT.messageOp выше), что и любое другое
  // изменение окна.

  // ── история окна сообщений (порт tweb rootScope.ts:77-88, имена и формы 1:1) ──
  // Порождает их НЕ воркер, а зеркало окон главного потока
  // (core/history/messagesMirror.ts) при переигрывании MessageOp: «в этом
  // хранилище появилось/изменилось/исчезло вот это сообщение». Подписчик —
  // императивная лента (порт chat/bubbles.ts:765, 882, 1104, 1860, 1903).
  //
  // `storageKey` у tweb — ключ MessagesStorage (`${peerId}_history`); у нас —
  // ключ окна (winKey: "chatId" | "chatId:threadRoot"), то же назначение:
  // подписчик сверяет его со своим окном и чужие пропускает.
  // `tempId` — id временного (оптимистичного) сообщения, которое заменил
  // серверный ответ (tweb pendingData.tempId); `history_update` в tweb значит
  // ровно смену идентификатора, а не правку содержимого — правку объявляет
  // `message_edit`.
  // `mid` у tweb — id сообщения внутри пира; у нас ту же роль адреса в операциях
  // играет `Message.id` (у неотправленного бабла он отрицательный, а `seq` —
  // выдумка владельца, поэтому адресуем именно по id).
  // Опущены относительно формы tweb: `sequential` в `history_update` (у нас нет
  // источника этого признака — в tweb он из pendingData).
  'history_append': [{ storageKey: string; message: Message }]
  'history_update': [{ storageKey: string; message: Message; tempId?: number }]
  'message_edit': [{ storageKey: string; peerId: number; mid: number; message: Message }]
  'history_delete': [{ peerId: number; msgs: Set<number> }]

  // ── служебные ──
  'rt:resync': [null]
  // done — аплоад завершился (успех/ошибка/отмена): кольцо на бабле снимается.
  // Границы аплоада объявляет владелец (messages.sendFile в воркере), а не вкладка.
  'media:upload_progress': [{ id: string; loaded: number; total: number; done?: boolean }]
  'state:mirror': [{ key: string; value: unknown }]

  // ── стикеры ──
  // Порт tweb rootScope.ts:120-121: appStickersManager.toggleStickerSet шлёт
  // 'stickers_installed'/'stickers_deleted' с самим набором, и по ним
  // пересчитываются ВСЕ витрины наборов сразу (панель пикера
  // emoticonsDropdown/tabs/stickers.ts:247,271, экран поиска
  // sidebarLeft/tabs/stickersAndEmoji.tsx:252,258, открытый попап набора
  // popups/stickers.tsx:114-115). Единственный отправитель у нас —
  // core/stickers/toggleStickerSet.ts.
  'stickers_installed': [StickerSet]
  'stickers_deleted': [StickerSet]

  // ── UI-команды (бывший core/hooks/uiEvents.ts, удалён) ──
  'ui:toast': [string]
  'ui:savedTagsChanged': [void]
}

export type BroadcastEventsListeners = {
  [K in keyof BroadcastEvents]: (...args: BroadcastEvents[K]) => void
}

/** Порт в воркер. Отдельным сеттером, а не импортом bootstrap: rootScope не
 *  должен тянуть за собой поднятие SharedWorker (его импортируют и тесты). */
interface RootScopePort { emit(event: string, payload: unknown, meta?: EventMeta): void }

export class RootScope extends EventListenerBase<BroadcastEventsListeners> {
  /** Порт tweb `rootScope.myId` (rootScope.ts:253): id текущего пользователя
   *  публичным полем шины. Императивной ленте (`chat/bubbles.ts`, порт tweb —
   *  там `rootScope.myId` читают bubbles.ts:740, 813, 928, 2719, 4236) нужен
   *  синхронный доступ к своей личности, а тянуть в неё zustand нельзя.
   *  Начальное значение у tweb — `NULL_PEER_ID`; у нас id — обычное число, и
   *  «никого» это 0.
   *
   *  РАСХОЖДЕНИЕ С TWEB, СОЗНАТЕЛЬНОЕ. В оригинале поле пишет сам rootScope из
   *  своей подписки на `user_auth` (rootScope.ts:265-267). У нас так нельзя:
   *  это завело бы ВТОРОГО писателя факта `me` мимо проектора, вопреки таблице
   *  владения фактами (web-client/CLAUDE.md). Пишет ровно та же единственная
   *  точка, что пишет `chatsStore.meId` — проектор на событие `rt:me`
   *  (`client/realtime/storeProjection.ts`): один писатель на два зеркала, как
   *  `[RT.messageOp]` там же пишет и стор, и `messagesMirror`. Держит пин
   *  `stores/noDuplicateMe.test.ts` (скан `.myId = `). */
  public myId: number

  private port: RootScopePort | null = null

  constructor() {
    super()
    this.myId = 0
    // Порождённое вкладкой событие уходит и локальным подписчикам, и в воркер —
    // тот ретранслирует его ОСТАЛЬНЫМ вкладкам (tweb rootScope.ts:280-290).
    // Принятое из воркера ре-эмитится через dispatchEventSingle, иначе кольцо.
    this.dispatchEvent = (name, ...args) => {
      super.dispatchEvent(name, ...args)
      this.port?.emit(name as string, args[0], args[1] as EventMeta | undefined)
    }
  }

  public setPort(port: RootScopePort | null) { this.port = port }

  public dispatchEventSingle<T extends keyof BroadcastEventsListeners>(
    name: T,
    ...args: Parameters<BroadcastEventsListeners[T]>
  ) {
    super.dispatchEvent(name, ...args)
  }
}

/** Фабрика для воркерного инстанса (Stage 1C.1): воркеру нужна СВОЯ шина того же
 *  класса, не главнопоточный синглтон ниже — иначе события воркера утекли бы в UI
 *  того же процесса (в SharedWorker классов вообще один на всех вкладок, но для
 *  dedicated-воркера/тестов инстанс должен быть отдельным). */
export function createRootScope(): RootScope {
  return new RootScope()
}

const rootScope = new RootScope()
export default rootScope
