/// <reference lib="webworker" />
import { SuperMessagePort, type Endpoint } from '../rpc/superMessagePort'
import { registerManagers } from '../rpc/managersProxy'
import { RestClient } from './net/restClient'
import { WsClient } from './net/wsClient'
import { newHealthManager } from './managers/healthManager'
import { TokenStore } from './auth/tokenStore'
import { newAuthManager } from './managers/authManager'
import { newProfileManager } from './managers/profileManager'
import { newPremiumManager } from './managers/premiumManager'
import { newChatsManager } from './managers/chatsManager'
import { newMessagesManager } from './managers/messagesManager'
import { newMediaManager } from './managers/mediaManager'
import { newPushManager } from './managers/pushManager'
import { newNotifyManager } from './managers/notifyManager'
import { newFoldersManager } from './managers/foldersManager'
import { newGroupsManager } from './managers/groupsManager'
import { newChannelsManager } from './managers/channelsManager'
import { newPeersManager } from './managers/peersManager'
import { newPresenceManager } from './managers/presenceManager'
import { newStoriesManager } from './managers/storiesManager'
import { newContactsManager } from './managers/contactsManager'
import { newPrivacyManager } from './managers/privacyManager'
import { newStarsManager } from './managers/starsManager'
import { newBoostsManager } from './managers/boostsManager'
import { newStickersManager } from './managers/stickersManager'
import { newReportManager } from './managers/reportManager'
import { newStatsManager } from './managers/statsManager'
import { newBotsManager } from './managers/botsManager'
import { newIVManager } from './managers/ivManager'
import { newDraftsManager } from './managers/draftsManager'
import { newChatThemesManager } from './managers/chatThemesManager'
import { newSessionsManager } from './managers/sessionsManager'
import { newCallsManager } from './managers/callsManager'
import { newLivestreamManager } from './managers/livestreamManager'
import { newConnectionManager } from './realtime/connectionManager'
import { newSyncEngine } from './realtime/syncEngine'
import { createSecretManager } from './managers/secretManager'
import { RT, type TypingAction } from './realtime/events'
import { idbGet, idbSet } from './store/idbKv'
import { persistScope } from './store/persist'

const tokens = new TokenStore()
// Скоуп нормализованного офлайн-стора по токену: при смене аккаунта данные
// предыдущего стираются, прежде чем воркер начнёт писать сообщения/юзеров.
void tokens.load().then(() => persistScope(tokens.get()))
// ready() гейтит REST-запросы до загрузки токена из IDB (иначе гонка «missing token»
// на старте, когда UI шлёт RPC раньше, чем поднялся токен воркера).
const rest = new RestClient('/api', () => tokens.get(), () => tokens.ready())
const auth = newAuthManager({ rest, store: tokens })
const profile = newProfileManager({ rest })
const premium = newPremiumManager({ rest })
const chats = newChatsManager({ rest })
// decryptSecret дергает secret лениво — стрелка вызывается только на fetch истории
// (после инициализации модуля), поэтому forward-ссылка на объявленный ниже secret безопасна.
const messages = newMessagesManager({ rest, decryptSecret: (chatId, encBody) => secret.decryptMessage(chatId, encBody) })
// broadcast объявлен ниже — замыкание дергает его лениво (к моменту первого
// аплоада порты уже подняты)
const media = newMediaManager({
  rest,
  onUploadProgress: (id, loaded, total) => broadcast('media:upload_progress', { id, loaded, total }),
})
const push = newPushManager({ rest })
const notify = newNotifyManager({ rest })
const folders = newFoldersManager({ rest })
// broadcast объявлен ниже — стрелка дергает его лениво (к моменту первой мутации
// порты уже подняты), как у media. Кросс-таб-эхо REST-мутаций без WS-эха бэка.
const groups = newGroupsManager({ rest, broadcast: (event, payload) => broadcast(event, payload) })
const channels = newChannelsManager({ rest })
const peers = newPeersManager({ rest })
const presence = newPresenceManager({ rest })
const stories = newStoriesManager({ rest })
const contacts = newContactsManager({ rest })
const privacy = newPrivacyManager({ rest })
const drafts = newDraftsManager({ rest })
const chatThemes = newChatThemesManager({ rest })
const sessions = newSessionsManager({ rest })
const calls = newCallsManager({ rest })
const livestream = newLivestreamManager({ rest })
const stars = newStarsManager({ rest })
const boosts = newBoostsManager({ rest })
const report = newReportManager({ rest })
const stats = newStatsManager({ rest })
const bots = newBotsManager({ rest })
const stickers = newStickersManager({ rest })
const iv = newIVManager({ rest })

// every connected tab's port — events broadcast to all
const ports: SuperMessagePort[] = []
const broadcast = (event: string, payload: unknown) => { for (const p of ports) p.emit(event, payload) }

// map an `other_update` from /sync to the right rt:* event
function dispatchOther(u: unknown) {
  const o = u as Record<string, unknown>
  if (!o) return
  if ('up_to_seq' in o) broadcast(RT.read, o)
  else if ('emoji' in o) broadcast(RT.reaction, o)
  else if ('total' in o) broadcast(RT.starReaction, o)
  else if ('edited_at' in o) broadcast(RT.editMessage, o)
  else if ('for_me' in o) broadcast(RT.deleteMessage, o)
  else if ('pinned' in o) broadcast(RT.pinMessage, o)
  else if ('removed' in o) broadcast(RT.chatRemoved, o)
  // media_read несёт только {chat_id, msg_id} — распознаётся последним, по остатку
  else if ('msg_id' in o) broadcast(RT.mediaRead, o)
}

// Реестр live-кадров WS — единый источник маршрутизации (заменяет длинный switch в
// onFrame). CACHE_THEN_BROADCAST: кадр сперва отражаем в кэше истории воркера (иначе
// переоткрытие чата отдаёт из кэша срез без свежего апдейта), затем broadcast.
// PASS_THROUGH: кадр транслируется в UI как есть. Bespoke-кадры (new_message с E2E,
// secret-handshake, обёртки звонков) остаются явными в onFrame.
const CACHE_THEN_BROADCAST: Record<string, { rt: string; cache: (p: never) => void }> = {
  edit_message:      { rt: RT.editMessage,     cache: (p) => messages.cacheEdit(p) },
  delete_message:    { rt: RT.deleteMessage,   cache: (p) => messages.cacheDelete(p) },
  paid_media_unlock: { rt: RT.paidMediaUnlock, cache: (p) => messages.cachePaidUnlock(p) },
  geo_live_update:   { rt: RT.geoLiveUpdate,   cache: (p) => messages.cacheGeoLive(p) },
  web_page_update:   { rt: RT.webPageUpdate,   cache: (p) => messages.cacheWebPage(p) },
  factcheck_update:  { rt: RT.factCheckUpdate, cache: (p) => messages.cacheFactCheck(p) },
  // P0-1: агрегаты, которые раньше были broadcast-only и терялись при переоткрытии
  // чата из кэша воркера (реакции/⭐ — в фазе 1b-2, нужен meId).
  media_read:        { rt: RT.mediaRead,       cache: (p) => messages.cacheMediaRead(p) },
  poll_update:       { rt: RT.pollUpdate,      cache: (p) => messages.cachePoll(p) },
  checklist_update:  { rt: RT.checklistUpdate, cache: (p) => messages.cacheChecklist(p) },
  giveaway_update:   { rt: RT.giveawayUpdate,  cache: (p) => messages.cacheGiveaway(p) },
}
const PASS_THROUGH: Record<string, string> = {
  message_ack: RT.ack, message_error: RT.messageError, pin_message: RT.pinMessage,
  read: RT.read, chat_removed: RT.chatRemoved,
  typing: RT.typing, presence: RT.presence, reaction: RT.reaction, star_reaction: RT.starReaction,
  draft_update: RT.draftUpdate, chat_theme_update: RT.chatThemeUpdate,
  dialog_pin: RT.dialogPin, dialog_archive: RT.dialogArchive,
  boost_update: RT.boostUpdate,
  suggested_post_update: RT.suggestedPost, balance_update: RT.balanceUpdate,
  bot_callback_answer: RT.botCallbackAnswer, story_new: RT.storyNew,
  story_deleted: RT.storyDeleted, story_reaction: RT.storyReaction,
  secret_chat_reject: RT.secretReject,
}

const ws = new WsClient('/ws')
const sync = newSyncEngine({
  rest, store: { get: idbGet, set: idbSet },
  onNewMessage: (m) => broadcast(RT.newMessage, m),
  onOtherUpdate: dispatchOther,
  onResync: () => broadcast('rt:resync', null),
})
const conn = newConnectionManager({
  ws, getToken: () => tokens.get(),
  // Unacked sends persist in IndexedDB: a reload doesn't lose queued messages —
  // they're restored into the outbox and resent on the next connect.
  outboxStore: {
    load: () => idbGet<import('./realtime/connectionManager').SendArgs[]>('outbox'),
    save: (list) => { void idbSet('outbox', list) },
  },
  onReady: () => { void sync.catchUp() },
  onState: (s) => broadcast(RT.state, { state: s }),
  onFrame: (type, payload) => {
    // new_message: возможна E2E-расшифровка enc_body перед кэшем/broadcast → bespoke.
    if (type === 'new_message') {
      const p = payload as { chat_id?: number; enc_body?: string; text?: string; entities?: unknown; secret_media?: unknown }
      if (p.enc_body && p.chat_id) {
        void secret.decryptMessage(p.chat_id, p.enc_body).then((dec) => {
          if (dec) { p.text = dec.text; p.entities = dec.entities; if (dec.media) p.secret_media = dec.media }
          messages.cacheLive(payload as never); broadcast(RT.newMessage, payload)
        })
      } else {
        messages.cacheLive(payload as never); broadcast(RT.newMessage, payload)
      }
      return
    }
    // Кадры с отражением в кэше истории воркера ДО broadcast.
    const cached = CACHE_THEN_BROADCAST[type]
    if (cached) { cached.cache(payload as never); broadcast(cached.rt, payload); return }
    // Секретный handshake: криптообработка в воркере до/вместо трансляции.
    if (type === 'secret_chat_request') {
      const p = payload as { chat_id?: number; initiator_pub?: string }
      if (p.chat_id && p.initiator_pub) secret.stashRequest(p.chat_id, p.initiator_pub)
      broadcast(RT.secretRequest, payload); return
    }
    if (type === 'secret_chat_accept') {
      const p = payload as { chat_id?: number; responder_pub?: string }
      if (p.chat_id && p.responder_pub) void secret.complete(p.chat_id, p.responder_pub)
      return
    }
    // Кадры-«обёртки» по префиксу (звонки/трансляции) → один RT с {t,d}.
    if (type.startsWith('livestream_')) { broadcast(RT.livestream, { t: type, d: payload }); return }
    if (type.startsWith('group_call_')) { broadcast(RT.groupCall, { t: type, d: payload }); return }
    if (type.startsWith('call_')) { broadcast(RT.call, { t: type, d: payload }); return }
    // Остальное — чистая трансляция в UI (см. PASS_THROUGH).
    const rt = PASS_THROUGH[type]
    if (rt) broadcast(rt, payload)
  },
})

// Секретные чаты живут в воркере: WebCrypto + keyStore + rest + conn + broadcast.
// upload проксирует в media-менеджер: ciphertext-блоб грузится как обычное медиа.
const secret = createSecretManager({
  rest, conn, broadcast,
  upload: (bytes, mime, size, fileName) => media.upload({ bytes, mime, size, fileName }),
})

const realtime = {
  async start() { await tokens.load(); conn.start(); return { state: conn.state() } },
  async sendMessage(args: { chatId: number; text: string; entities?: import('./models').MessageEntity[] | null; clientMsgId: string; replyToId?: number | null; replyToPeerId?: number | null; replyQuoteText?: string | null; replyQuoteOffset?: number | null; mediaId?: number | null; type?: string; groupedId?: string; encBody?: string; ttlSeconds?: number | null; silent?: boolean; effect?: string | null; paidMediaPrice?: number | null; sendAsChatId?: number | null }) { conn.sendMessage(args); return { ok: true } },
  async markRead(args: { chatId: number; upToSeq: number }) { conn.markRead(args.chatId, args.upToSeq); return { ok: true } },
  async markMediaRead(args: { chatId: number; msgId: number }) { conn.markMediaRead(args.chatId, args.msgId); return { ok: true } },
  async sendTyping(args: { chatId: number; action?: TypingAction }) { conn.sendTyping(args.chatId, args.action ?? 'typing'); return { ok: true } },
  async sendCallFrame(args: { type: string; data: Record<string, unknown> }) { conn.sendCallFrame(args.type, args.data); return { ok: true } },
  async subscribeChannel(args: { chatId: number }) { conn.subscribeChannel(args.chatId); return { ok: true } },
  async unsubscribeChannel(args: { chatId: number }) { conn.unsubscribeChannel(args.chatId); return { ok: true } },
}

function bind(ep: Endpoint) {
  const smp = new SuperMessagePort(ep)
  ports.push(smp)
  registerManagers(smp, {
    health: newHealthManager(rest),
    auth: auth as unknown as Record<string, (...a: unknown[]) => unknown>,
    profile: profile as unknown as Record<string, (...a: unknown[]) => unknown>,
    premium: premium as unknown as Record<string, (...a: unknown[]) => unknown>,
    chats: chats as unknown as Record<string, (...a: unknown[]) => unknown>,
    messages: messages as unknown as Record<string, (...a: unknown[]) => unknown>,
    realtime: realtime as unknown as Record<string, (...a: unknown[]) => unknown>,
    media: media as unknown as Record<string, (...a: unknown[]) => unknown>,
    push: push as unknown as Record<string, (...a: unknown[]) => unknown>,
    notify: notify as unknown as Record<string, (...a: unknown[]) => unknown>,
    folders: folders as unknown as Record<string, (...a: unknown[]) => unknown>,
    groups: groups as unknown as Record<string, (...a: unknown[]) => unknown>,
    channels: channels as unknown as Record<string, (...a: unknown[]) => unknown>,
    peers: peers as unknown as Record<string, (...a: unknown[]) => unknown>,
    presence: presence as unknown as Record<string, (...a: unknown[]) => unknown>,
    stories: stories as unknown as Record<string, (...a: unknown[]) => unknown>,
    contacts: contacts as unknown as Record<string, (...a: unknown[]) => unknown>,
    privacy: privacy as unknown as Record<string, (...a: unknown[]) => unknown>,
    drafts: drafts as unknown as Record<string, (...a: unknown[]) => unknown>,
    chatThemes: chatThemes as unknown as Record<string, (...a: unknown[]) => unknown>,
    sessions: sessions as unknown as Record<string, (...a: unknown[]) => unknown>,
    calls: calls as unknown as Record<string, (...a: unknown[]) => unknown>,
    livestream: livestream as unknown as Record<string, (...a: unknown[]) => unknown>,
    stars: stars as unknown as Record<string, (...a: unknown[]) => unknown>,
    boosts: boosts as unknown as Record<string, (...a: unknown[]) => unknown>,
    report: report as unknown as Record<string, (...a: unknown[]) => unknown>,
    stats: stats as unknown as Record<string, (...a: unknown[]) => unknown>,
    bots: bots as unknown as Record<string, (...a: unknown[]) => unknown>,
    stickers: stickers as unknown as Record<string, (...a: unknown[]) => unknown>,
    iv: iv as unknown as Record<string, (...a: unknown[]) => unknown>,
    secret: secret as unknown as Record<string, (...a: unknown[]) => unknown>,
  })
}

const g = self as unknown as {
  onconnect?: (e: MessageEvent) => void
  addEventListener: (t: string, cb: (e: MessageEvent) => void) => void
}
if ('onconnect' in g) {
  g.onconnect = (e: MessageEvent) => bind((e as MessageEvent & { ports: MessagePort[] }).ports[0])
} else {
  bind(g as unknown as Endpoint)
}
