// Шина realtime-событий воркера (main-thread). Единственный потребитель smp —
// «насос» в realtimeBridge — публикует сюда каждое событие; все прочие модули
// (Store-проектор, Sound, Notifications, будущие Analytics/Logger) подписываются
// на шину через eventBus.subscribe, а не на smp напрямую. Это сохраняет инвариант
// «один потребитель сокета» и делает добавление потребителя одной строкой.
import { RT } from './events'
import type {
  NewMessageEvt, EditMessageEvt, DeleteMessageEvt, PinMessageEvt, ReadEvt, MediaReadEvt,
  TypingEvt, PresenceEvt, ReactionEvt, StarReactionEvt, AckEvt, MessageErrorEvt, CallFrameEvt,
  ChatRemovedEvt, DraftUpdateEvt, ChatThemeUpdateEvt, ChatUpdateEvt, SuggestedPostEvt, BotCallbackAnswerEvt,
  GeoLiveUpdateEvt, WebPageUpdateEvt, FactCheckUpdateEvt, StoryNewEvt, StoryDeletedEvt,
  StoryReactionEvt, ConnState,
} from './events'
import type { RawPoll, RawChecklist, RawBoostStatus, RawGiveaway } from '../models'
import type { GroupCallFrame } from '../calls/groupCallEngine'
import type { LivestreamFrame } from '../calls/livestreamEngine'

// Единый типизированный каталог: событие RT → тип его payload. Подписчик получает
// точный тип без ручного каста. Добавить событие = одна строка здесь + в RT.
export interface RtEventMap {
  [RT.newMessage]: NewMessageEvt
  [RT.editMessage]: EditMessageEvt
  [RT.deleteMessage]: DeleteMessageEvt
  [RT.pinMessage]: PinMessageEvt
  [RT.read]: ReadEvt
  [RT.mediaRead]: MediaReadEvt
  [RT.typing]: TypingEvt
  [RT.presence]: PresenceEvt
  [RT.reaction]: ReactionEvt
  [RT.starReaction]: StarReactionEvt
  [RT.ack]: AckEvt
  [RT.messageError]: MessageErrorEvt
  [RT.call]: CallFrameEvt
  [RT.chatRemoved]: ChatRemovedEvt
  [RT.draftUpdate]: DraftUpdateEvt
  [RT.chatThemeUpdate]: ChatThemeUpdateEvt
  [RT.chatUpdate]: ChatUpdateEvt
  [RT.dialogPin]: { chat_id: number; pinned: boolean }
  [RT.dialogArchive]: { chat_id: number; archived: boolean }
  [RT.dialogMute]: { chat_id: number; muted: boolean }
  [RT.pollUpdate]: { chat_id: number; poll: RawPoll }
  [RT.checklistUpdate]: { chat_id: number; checklist: RawChecklist }
  [RT.boostUpdate]: { chat_id: number; status: RawBoostStatus }
  [RT.giveawayUpdate]: { chat_id: number; giveaway: RawGiveaway }
  [RT.suggestedPost]: SuggestedPostEvt
  [RT.balanceUpdate]: { balance: number }
  [RT.paidMediaUnlock]: NewMessageEvt
  [RT.groupCall]: GroupCallFrame
  [RT.livestream]: LivestreamFrame
  [RT.botCallbackAnswer]: BotCallbackAnswerEvt
  [RT.geoLiveUpdate]: GeoLiveUpdateEvt
  [RT.webPageUpdate]: WebPageUpdateEvt
  [RT.factCheckUpdate]: FactCheckUpdateEvt
  [RT.secretRequest]: { chat_id: number; initiator_id: number; responder_id: number }
  [RT.secretAccept]: { chat_id: number; state?: string; fingerprint?: string[] }
  [RT.secretReject]: { chat_id: number }
  [RT.storyNew]: StoryNewEvt
  [RT.storyDeleted]: StoryDeletedEvt
  [RT.storyReaction]: StoryReactionEvt
  [RT.state]: { state: ConnState }
}

type RtEvent = keyof RtEventMap
// payload для известного события — из карты; для прочего (rt:resync,
// media:upload_progress, «насос» со string-ключом) — unknown.
type PayloadOf<K extends string> = K extends RtEvent ? RtEventMap[K] : unknown

class EventBus {
  private subs = new Map<string, Array<(p: unknown) => void>>()

  /** Подписаться на событие. Возвращает функцию отписки. */
  subscribe<K extends string>(event: K, handler: (payload: PayloadOf<K>) => void): () => void {
    const arr = this.subs.get(event) ?? []
    arr.push(handler as (p: unknown) => void)
    this.subs.set(event, arr)
    return () => {
      const a = this.subs.get(event)
      if (!a) return
      const i = a.indexOf(handler as (p: unknown) => void)
      if (i >= 0) a.splice(i, 1)
    }
  }

  /** Опубликовать событие всем подписчикам (slice — на случай отписки во время доставки). */
  publish<K extends string>(event: K, payload: PayloadOf<K>): void {
    const arr = this.subs.get(event)
    if (!arr) return
    for (const h of arr.slice()) h(payload)
  }
}

export const eventBus = new EventBus()
