import { SuperMessagePort, type Endpoint } from '../rpc/superMessagePort'
import { createManagers } from '../rpc/managersProxy'
import type { ConnState, TypingAction } from '../core/realtime/events'
import type { MessageEntity } from '../core/models'
// Типы менеджеров выводятся из самих фабрик (единый источник правды): менять
// сигнатуру в *Manager.ts достаточно один раз — здесь она подхватится автоматически.
// realtime — не фабрика, а инлайн-объект в worker.ts, поэтому его контракт описан вручную ниже.
import type { newHealthManager } from '../core/managers/healthManager'
import type { newAuthManager } from '../core/managers/authManager'
import type { newProfileManager } from '../core/managers/profileManager'
import type { newPremiumManager } from '../core/managers/premiumManager'
import type { newChatsManager } from '../core/managers/chatsManager'
import type { newMessagesManager } from '../core/managers/messagesManager'
import type { newMediaManager } from '../core/managers/mediaManager'
import type { newPushManager } from '../core/managers/pushManager'
import type { newNotifyManager } from '../core/managers/notifyManager'
import type { newFoldersManager } from '../core/managers/foldersManager'
import type { newGroupsManager } from '../core/managers/groupsManager'
import type { newChannelsManager } from '../core/managers/channelsManager'
import type { newPeersManager } from '../core/managers/peersManager'
import type { newPresenceManager } from '../core/managers/presenceManager'
import type { newStoriesManager } from '../core/managers/storiesManager'
import type { newContactsManager } from '../core/managers/contactsManager'
import type { newPrivacyManager } from '../core/managers/privacyManager'
import type { newDraftsManager } from '../core/managers/draftsManager'
import type { newChatThemesManager } from '../core/managers/chatThemesManager'
import type { newSessionsManager } from '../core/managers/sessionsManager'
import type { newCallsManager } from '../core/managers/callsManager'
import type { newLivestreamManager } from '../core/managers/livestreamManager'
import type { newStarsManager } from '../core/managers/starsManager'
import type { newBoostsManager } from '../core/managers/boostsManager'
import type { newReportManager } from '../core/managers/reportManager'
import type { newStatsManager } from '../core/managers/statsManager'
import type { newBotsManager } from '../core/managers/botsManager'
import type { newStickersManager } from '../core/managers/stickersManager'
import type { newIVManager } from '../core/managers/ivManager'
import type { createSecretManager } from '../core/managers/secretManager'
import type { newPersistManager } from '../core/managers/persistManager'

// RPC всегда асинхронный: любой метод менеджера, синхронный он в воркере или нет,
// на UI-стороне возвращает Promise. Оборачиваем каждый метод в Promise<Awaited<…>>,
// чтобы выведенный из фабрики тип точно отражал поведение границы.
type AsyncManager<T> = {
  [K in keyof T]: T[K] extends (...args: infer A) => infer R
    ? (...args: A) => Promise<Awaited<R>>
    : T[K]
}
type MgrOf<F extends (...args: never[]) => unknown> = AsyncManager<ReturnType<F>>

// realtime живёт как инлайн-объект в worker.ts (не фабрика) → контракт вручную.
interface RealtimeApi {
  start(): Promise<{ state: ConnState }>
  sendMessage(args: { chatId: number; text: string; entities?: MessageEntity[] | null; clientMsgId: string; replyToId?: number | null; replyToPeerId?: number | null; replyQuoteText?: string | null; replyQuoteOffset?: number | null; mediaId?: number | null; type?: string; groupedId?: string; geo?: { lat: number; lng: number; title?: string; address?: string; livePeriod?: number; heading?: number }; contactUserId?: number; threadRootId?: number | null; encBody?: string; ttlSeconds?: number | null; silent?: boolean; effect?: string | null; paidMediaPrice?: number | null; sendAsChatId?: number | null }): Promise<{ ok: boolean }>
  markRead(args: { chatId: number; upToSeq: number }): Promise<{ ok: boolean }>
  markMediaRead(args: { chatId: number; msgId: number }): Promise<{ ok: boolean }>
  sendTyping(args: { chatId: number; action?: TypingAction }): Promise<{ ok: boolean }>
  sendCallFrame(args: { type: string; data: Record<string, unknown> }): Promise<{ ok: boolean }>
  subscribeChannel(args: { chatId: number }): Promise<{ ok: boolean }>
  unsubscribeChannel(args: { chatId: number }): Promise<{ ok: boolean }>
}

export interface Managers {
  health: MgrOf<typeof newHealthManager>
  auth: MgrOf<typeof newAuthManager>
  profile: MgrOf<typeof newProfileManager>
  premium: MgrOf<typeof newPremiumManager>
  chats: MgrOf<typeof newChatsManager>
  messages: MgrOf<typeof newMessagesManager>
  realtime: RealtimeApi
  secret: MgrOf<typeof createSecretManager>
  media: MgrOf<typeof newMediaManager>
  push: MgrOf<typeof newPushManager>
  notify: MgrOf<typeof newNotifyManager>
  folders: MgrOf<typeof newFoldersManager>
  groups: MgrOf<typeof newGroupsManager>
  channels: MgrOf<typeof newChannelsManager>
  peers: MgrOf<typeof newPeersManager>
  presence: MgrOf<typeof newPresenceManager>
  stories: MgrOf<typeof newStoriesManager>
  contacts: MgrOf<typeof newContactsManager>
  privacy: MgrOf<typeof newPrivacyManager>
  chatThemes: MgrOf<typeof newChatThemesManager>
  drafts: MgrOf<typeof newDraftsManager>
  sessions: MgrOf<typeof newSessionsManager>
  calls: MgrOf<typeof newCallsManager>
  livestream: MgrOf<typeof newLivestreamManager>
  stars: MgrOf<typeof newStarsManager>
  boosts: MgrOf<typeof newBoostsManager>
  report: MgrOf<typeof newReportManager>
  stats: MgrOf<typeof newStatsManager>
  bots: MgrOf<typeof newBotsManager>
  stickers: MgrOf<typeof newStickersManager>
  iv: MgrOf<typeof newIVManager>
  persist: MgrOf<typeof newPersistManager>
}

let cached: { smp: SuperMessagePort; managers: Managers } | null = null

export function startClient(): { smp: SuperMessagePort; managers: Managers } {
  if (cached) return cached
  let ep: Endpoint
  if (typeof SharedWorker !== 'undefined') {
    // The `new URL(...)` must be inline in the constructor call so Vite
    // recognizes and bundles the worker into its own chunk.
    const w = new SharedWorker(new URL('../core/worker.ts', import.meta.url), { type: 'module' })
    ep = w.port
  } else {
    ep = new Worker(new URL('../core/worker.ts', import.meta.url), { type: 'module' }) as unknown as Endpoint
  }
  const smp = new SuperMessagePort(ep)
  const managers = createManagers<Managers>(smp)
  cached = { smp, managers }
  return cached
}
