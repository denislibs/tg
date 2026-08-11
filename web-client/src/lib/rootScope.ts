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
  StoryReactionEvt, ConnState, PendingNewEvt, PendingMediaEvt, PendingRouteEvt, UserUpdateEvt,
} from '@core/realtime/events'
import type { RawPoll, RawChecklist, RawBoostStatus, RawGiveaway } from '@core/models'
import type { GroupCallFrame } from '@core/calls/groupCallEngine'
import type { LivestreamFrame } from '@core/calls/livestreamEngine'
import type { FolderUpdateEvt } from '@stores/foldersStore'
import type { MessageOp } from '@core/realtime/messageOps'

export type { EventMeta } from '@rpc/superMessagePort'
import type { EventMeta } from '@rpc/superMessagePort'

// Каталог 1:1 переносит бывший core/realtime/eventBus.ts:RtEventMap (ключ за ключом,
// удалён — все потребители переведены на rootScope), дополненный: pending*-событиями
// оптимистичной отправки, RT.folderUpdate/userUpdate (в RtEventMap их не было),
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
  // retryAt (Задача 1 порта ConnectionStatusComponent) — момент следующей попытки
  // реконнекта (мс, Date.now()), присутствует только при переходе в 'reconnecting'
  // с уже вычисленным backoff'ом (connectionManager.ts:scheduleReconnect).
  [RT.state]: [{ state: ConnState; retryAt?: number }]
  // tweb apiUpdatesManager.ts:459-467 (state_synchronizing/state_synchronized) —
  // начало/конец catch-up (/sync); автомат витрины (Задача 3) слушает пару.
  [RT.stateSynchronizing]: [null]
  [RT.stateSynchronized]: [null]

  // ── оптимистичная отправка (tweb pending): жизненный цикл бабла, синтетические
  //    клиентские события — вне funnel'а сервера, meta не несут ──
  [RT.pendingNew]: [PendingNewEvt]
  [RT.pendingMedia]: [PendingMediaEvt]
  [RT.pendingFail]: [PendingRouteEvt]
  [RT.pendingRetry]: [PendingRouteEvt]
  [RT.pendingRemove]: [PendingRouteEvt]

  // ── служебные ──
  'rt:resync': [null]
  'media:upload_progress': [{ id: string; loaded: number; total: number }]
  'state:mirror': [{ key: string; value: unknown }]

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
  private port: RootScopePort | null = null

  constructor() {
    super()
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
