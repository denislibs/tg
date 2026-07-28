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
import { newPersistManager } from './managers/persistManager'
import { newChatThemesManager } from './managers/chatThemesManager'
import { newSessionsManager } from './managers/sessionsManager'
import { newCallsManager } from './managers/callsManager'
import { newLivestreamManager } from './managers/livestreamManager'
import { newConnectionManager } from './realtime/connectionManager'
import { newSyncEngine } from './realtime/syncEngine'
import { createSecretManager } from './managers/secretManager'
import { RT, type TypingAction, type NewMessageEvt } from './realtime/events'
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
// id текущего пользователя в воркере: нужен, чтобы кэшировать `mine` реакций
// (событие reaction несёт user_id реагирующего). Разрешаем лениво через /me после
// загрузки токена; при смене аккаунта перезагрузка воркера обнулит его заново.
let meId: number | null = null
void tokens.ready().then(() => auth.me()).then((u) => { meId = u?.id ?? null }).catch(() => {})
// decryptSecret дергает secret лениво — стрелка вызывается только на fetch истории
// (после инициализации модуля), поэтому forward-ссылка на объявленный ниже secret безопасна.
// broadcast объявлен ниже — стрелка дергает его лениво (оптимистичные мутации
// tweb-модели: менеджер применяет к SSOT и бродкастит эхо всем вкладкам).
const messages = newMessagesManager({ rest, decryptSecret: (chatId, encBody) => secret.decryptMessage(chatId, encBody), getMeId: () => meId, broadcast: (event, payload) => broadcast(event, payload) })
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
// Единый writer офлайн-стора: диалоги/me/папки/черновики теперь пишет воркер (не
// каждая вкладка со своего main-соединения). Без rest — чистый IndexedDB.
const persist = newPersistManager()

// every connected tab's port — events broadcast to all
const ports: SuperMessagePort[] = []
const broadcast = (event: string, payload: unknown) => { for (const p of ports) p.emit(event, payload) }

// P0-2: пер-чатовый максимум seq, уже доставленного вживую в этой сессии воркера.
// Живёт в SharedWorker → переживает reload вкладки. При catch-up после reconnect
// /sync повторно отдаёт уже доставленные сообщения (live-путь не двигает pts —
// это на бэке); такие помечаем backfill:true, и звук/нотификации их пропускают
// (иначе дубль уведомления/звука/непрочитанных на каждый reconnect).
// Персистится в IDB (не только память) — переживает РЕСТАРТ воркера (закрытие/
// переоткрытие браузера), иначе после рестарта catch-up переотдал бы уже
// доставленные сообщения и звук/нотиф/непрочитанные сработали бы повторно (P0-2).
const deliveredSeq = new Map<number, number>()
const deliveredReady = idbGet<Record<string, number>>('deliveredSeq')
  // Мерж, не перезапись: живой кадр мог обогнать async-загрузку и уже поднять
  // in-memory значение — не откатываем его назад (иначе catch-up переотдаст).
  .then((o) => { if (o) for (const k in o) deliveredSeq.set(Number(k), Math.max(deliveredSeq.get(Number(k)) ?? 0, o[k])) })
  .catch(() => {})
let persistTimer: ReturnType<typeof setTimeout> | null = null
const persistDelivered = (): void => {
  if (persistTimer) return
  persistTimer = setTimeout(() => { persistTimer = null; void idbSet('deliveredSeq', Object.fromEntries(deliveredSeq)) }, 1000)
}
// High-water pts применённых live-реакций (реакция — дельта count±1; catch-up
// переотдаёт уже применённую live-реакцию → повтор удвоил бы счётчик). Кадр
// reaction и элемент /sync несут pts (per-user монотонный) → catch-up с pts <=
// max пропускаем. Персистится: переживает рестарт воркера.
let maxReactionPts = 0
const reactionReady = idbGet<number>('maxReactionPts')
  .then((v) => { if (typeof v === 'number') maxReactionPts = Math.max(maxReactionPts, v) })
  .catch(() => {})
let rpTimer: ReturnType<typeof setTimeout> | null = null
const recordReactionPts = (payload: unknown): void => {
  const pts = (payload as { pts?: number })?.pts
  if (typeof pts !== 'number' || pts <= maxReactionPts) return
  maxReactionPts = pts
  if (rpTimer) return
  rpTimer = setTimeout(() => { rpTimer = null; void idbSet('maxReactionPts', maxReactionPts) }, 1000)
}
// Живое новое сообщение: запомнить как доставленное, отразить в SSOT, разослать.
const emitLive = (payload: unknown): void => {
  const e = payload as NewMessageEvt
  const prev = deliveredSeq.get(e.chat_id) ?? 0
  // Дыра в per-chat seq (пропущен живой кадр) → точечный catch-up добирает
  // пропущенное по порядку (P0-4 для сообщений). Только при известном prev>0.
  if (prev > 0 && e.seq > prev + 1) void sync.catchUp()
  deliveredSeq.set(e.chat_id, Math.max(prev, e.seq))
  persistDelivered()
  messages.cacheLive(payload as never)
  broadcast(RT.newMessage, payload)
}

// Диспетчер catch-up other_update ПО ЯВНОМУ ТИПУ (`t`), а не по наличию поля
// (P0-3: раньше `'field' in o`-эвристика молча уводила апдейт в чужую ветку, если
// бэк добавит лишнее поле). Апдейт из catch-up тоже отражаем в SSOT воркера —
// иначе после reconnect он виден в живом UI, но теряется при переоткрытии чата из
// кэша (P0-1). В кэш пускаем только идемпотентные (edit/delete/star=absolute/
// media_read/factcheck). reaction — count±1-ДЕЛЬТА: catch-up переотдаёт уже
// применённую live-реакцию → повтор удвоил бы счётчик; полный фикс — глобальный pts
// (Tier 2), пока broadcast-only.
const CATCHUP: Record<string, { rt: string; cache?: (p: never) => void }> = {
  read: { rt: RT.read },
  // reaction — спец-обработка в dispatchOther (дедуп по pts), не здесь.
  star_reaction: { rt: RT.starReaction, cache: (p) => messages.cacheStarReaction(p) },
  edit_message: { rt: RT.editMessage, cache: (p) => messages.cacheEdit(p) },
  delete_message: { rt: RT.deleteMessage, cache: (p) => messages.cacheDelete(p) },
  media_read: { rt: RT.mediaRead, cache: (p) => messages.cacheMediaRead(p) },
  factcheck_update: { rt: RT.factCheckUpdate, cache: (p) => messages.cacheFactCheck(p) },
  pin_message: { rt: RT.pinMessage },
  chat_removed: { rt: RT.chatRemoved },
}
function dispatchOther(item: unknown) {
  const su = item as { t?: string; pts?: number; d?: unknown }
  if (!su?.t) return
  // Реакция-дельта: пропускаем catch-up-повтор уже применённой live-реакции
  // (pts <= high-water). Иначе применяем и двигаем high-water (пропущенная офлайн).
  if (su.t === 'reaction') {
    if (typeof su.pts === 'number' && su.pts <= maxReactionPts) return // дубль live-реакции
    // Пропущенная офлайн реакция (pts>max): отражаем в SSOT воркера (как все catch-up
    // апдейты), иначе она ревертнётся при переоткрытии чата из кэша. Дубли сюда не
    // доходят (отсечены выше) — двойного счёта нет.
    messages.cacheReaction(su.d as never)
    broadcast(RT.reaction, su.d)
    recordReactionPts(su)
    return
  }
  const h = CATCHUP[su.t]
  if (!h) return
  h.cache?.(su.d as never)
  broadcast(h.rt, su.d)
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
  reaction:          { rt: RT.reaction,        cache: (p) => messages.cacheReaction(p) },
  star_reaction:     { rt: RT.starReaction,    cache: (p) => messages.cacheStarReaction(p) },
  // Юзер сменил профиль: чиним кэш пиров воркера ДО broadcast, иначе прямые
  // getUsers (мимо peersStore) отдавали бы устаревшую карточку.
  user_update:       { rt: RT.userUpdate,      cache: (p) => peers.applyUserUpdate(p) },
}
const PASS_THROUGH: Record<string, string> = {
  message_ack: RT.ack, message_error: RT.messageError, pin_message: RT.pinMessage,
  read: RT.read, chat_removed: RT.chatRemoved,
  typing: RT.typing, presence: RT.presence,
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
  onNewMessage: (m) => {
    const e = (m as { d: NewMessageEvt }).d // /sync теперь шлёт {t, pts, d}
    // Уже доставляли (в этой сессии ИЛИ прошлой — deliveredSeq персистится) →
    // backfill: в стор попадёт (dedup), но звук/нотиф/непрочитанные не повторятся.
    if (e.seq <= (deliveredSeq.get(e.chat_id) ?? 0)) { broadcast(RT.newMessage, { ...e, backfill: true }); return }
    // Пропущенное в офлайне — доставляем как новое (и кэшируем в SSOT).
    deliveredSeq.set(e.chat_id, e.seq); persistDelivered()
    messages.cacheLive(e as never)
    broadcast(RT.newMessage, e)
  },
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
  onReady: () => { void Promise.all([deliveredReady, reactionReady]).then(() => sync.catchUp()) },
  onState: (s) => broadcast(RT.state, { state: s }),
  onFrame: (type, payload) => {
    // new_message: возможна E2E-расшифровка enc_body перед кэшем/broadcast → bespoke.
    if (type === 'new_message') {
      const p = payload as { chat_id?: number; enc_body?: string; text?: string; entities?: unknown; secret_media?: unknown }
      if (p.enc_body && p.chat_id) {
        void secret.decryptMessage(p.chat_id, p.enc_body).then((dec) => {
          if (dec) { p.text = dec.text; p.entities = dec.entities; if (dec.media) p.secret_media = dec.media }
          emitLive(payload)
        })
      } else {
        emitLive(payload)
      }
      return
    }
    // Кадры с отражением в кэше истории воркера ДО broadcast.
    const cached = CACHE_THEN_BROADCAST[type]
    if (cached) {
      if (type === 'reaction') recordReactionPts(payload) // live-реакция → high-water для дедупа catch-up
      cached.cache(payload as never); broadcast(cached.rt, payload); return
    }
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
  async markMediaRead(args: { chatId: number; msgId: number }) {
    // Локально гасим точку media_unread в SSOT + эхо всем вкладкам (у отправителя
    // точка гаснет по его серверному media_read-кадру), затем шлём read_media серверу.
    messages.cacheMediaRead({ chat_id: args.chatId, msg_id: args.msgId })
    broadcast(RT.mediaRead, { chat_id: args.chatId, msg_id: args.msgId })
    conn.markMediaRead(args.chatId, args.msgId)
    return { ok: true }
  },
  // Оптимистичный бабл отправки: воркер — funnel жизненного цикла, бродкастит эхо
  // всем вкладкам → storeProjection (единственный писатель окна). Транспорт (outbox)
  // и reconcile ack/err — прежним путём (conn), ack/err воркер обогащает маршрутом.
  async appendPending(p: import('./realtime/events').PendingNewEvt) { broadcast(RT.pendingNew, p); return { ok: true } },
  async attachPendingMedia(args: { chatId: number; threadRootId?: number | null; clientMsgId: string; mediaId: number }) { broadcast(RT.pendingMedia, { chat_id: args.chatId, thread_root_id: args.threadRootId ?? null, client_msg_id: args.clientMsgId, media_id: args.mediaId }); return { ok: true } },
  async failPending(args: { chatId: number; threadRootId?: number | null; clientMsgId: string }) { broadcast(RT.pendingFail, { chat_id: args.chatId, thread_root_id: args.threadRootId ?? null, client_msg_id: args.clientMsgId }); return { ok: true } },
  async retryPending(args: { chatId: number; threadRootId?: number | null; clientMsgId: string }) { broadcast(RT.pendingRetry, { chat_id: args.chatId, thread_root_id: args.threadRootId ?? null, client_msg_id: args.clientMsgId }); return { ok: true } },
  async removePending(args: { chatId: number; threadRootId?: number | null; clientMsgId: string }) { broadcast(RT.pendingRemove, { chat_id: args.chatId, thread_root_id: args.threadRootId ?? null, client_msg_id: args.clientMsgId }); return { ok: true } },
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
    persist: persist as unknown as Record<string, (...a: unknown[]) => unknown>,
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
