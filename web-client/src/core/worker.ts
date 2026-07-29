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
import { newRealtime } from './realtime/realtime'
import { newSyncEngine } from './realtime/syncEngine'
import { newCursor, classifyPts } from './realtime/cursor'
import { newPendingPts } from './realtime/pendingPts'
import { createSecretManager } from './managers/secretManager'
import { RT, type NewMessageEvt } from './realtime/events'
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
const health = newHealthManager(rest)
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
// ── Wave 3 funnel ────────────────────────────────────────────────────────────
// Единая точка применения ВСЕХ логируемых апдейтов (и live-кадр, и элемент /sync).
// Плотный монотонный pts из курсора решает: дубль / следующий / дыра. Эфемерные
// кадры (typing/presence/calls/…) сюда НЕ заходят — их onFrame транслирует как есть.
const cursor = newCursor({ get: idbGet, set: idbSet })
let cursorReady = false
void cursor.ready().then(() => { cursorReady = true })

// Единый реестр маршрутизации логируемых типов: cache (в SSOT воркера, ДО broadcast —
// иначе переоткрытие чата из кэша теряет апдейт) + rt (имя события для UI). Замена
// прежних CACHE_THEN_BROADCAST + CATCHUP. new_message — спец-обработка (E2E/deliveredSeq),
// см. routeNewMessage.
const APPLY: Record<string, { rt: string; cache?: (p: never) => void }> = {
  read:              { rt: RT.read },
  media_read:        { rt: RT.mediaRead,       cache: (p) => messages.cacheMediaRead(p) },
  edit_message:      { rt: RT.editMessage,     cache: (p) => messages.cacheEdit(p) },
  delete_message:    { rt: RT.deleteMessage,   cache: (p) => messages.cacheDelete(p) },
  pin_message:       { rt: RT.pinMessage },
  reaction:          { rt: RT.reaction,        cache: (p) => messages.cacheReaction(p) },
  star_reaction:     { rt: RT.starReaction,    cache: (p) => messages.cacheStarReaction(p) },
  factcheck_update:  { rt: RT.factCheckUpdate, cache: (p) => messages.cacheFactCheck(p) },
  chat_removed:      { rt: RT.chatRemoved },
  draft_update:      { rt: RT.draftUpdate },
  dialog_pin:        { rt: RT.dialogPin },
  dialog_archive:    { rt: RT.dialogArchive },
  dialog_mute:       { rt: RT.dialogMute },
  poll_update:       { rt: RT.pollUpdate,      cache: (p) => messages.cachePoll(p) },
  checklist_update:  { rt: RT.checklistUpdate, cache: (p) => messages.cacheChecklist(p) },
  giveaway_update:   { rt: RT.giveawayUpdate,  cache: (p) => messages.cacheGiveaway(p) },
  boost_update:      { rt: RT.boostUpdate },
  chat_theme_update: { rt: RT.chatThemeUpdate },
  chat_update:       { rt: RT.chatUpdate },
  folder_update:     { rt: RT.folderUpdate },
  web_page_update:   { rt: RT.webPageUpdate,   cache: (p) => messages.cacheWebPage(p) },
  paid_media_unlock: { rt: RT.paidMediaUnlock, cache: (p) => messages.cachePaidUnlock(p) },
  balance_update:    { rt: RT.balanceUpdate },
  // Юзер сменил профиль: чиним кэш пиров воркера ДО broadcast, иначе прямые
  // getUsers (мимо peersStore) отдавали бы устаревшую карточку.
  user_update:       { rt: RT.userUpdate,      cache: (p) => peers.applyUserUpdate(p) },
}
// Эфемерные кадры (без pts): транслируются в UI как есть, НИКОГДА не гейтятся
// курсором/catch-up. Bespoke-кадры (secret-handshake, обёртки звонков) — явно в onFrame.
const PASS_THROUGH: Record<string, string> = {
  message_ack: RT.ack, message_error: RT.messageError,
  typing: RT.typing, presence: RT.presence,
  geo_live_update: RT.geoLiveUpdate,
  suggested_post_update: RT.suggestedPost,
  bot_callback_answer: RT.botCallbackAnswer, story_new: RT.storyNew,
  story_deleted: RT.storyDeleted, story_reaction: RT.storyReaction,
  secret_chat_reject: RT.secretReject,
}

// Отражение логируемого апдейта в SSOT + broadcast (без арифметики pts — её делает
// applyUpdate). `d` — полезная нагрузка (для live это весь payload с d.pts, для /sync
// это item.d). new_message — спец-путь (E2E/deliveredSeq-мост).
function dispatch(t: string, pts: number | undefined, d: unknown, live: boolean): void {
  if (t === 'new_message') { routeNewMessage(d as NewMessageEvt, live); return }
  const h = APPLY[t]
  if (!h) return
  // Мост maxReactionPts (Wave 4 удалит): high-water поддерживаем, но дедуп теперь
  // на курсоре, а реакции абсолютны (реплей идемпотентен) — так что это belt-only.
  if (t === 'reaction' && typeof pts === 'number') recordReactionPts({ pts })
  h.cache?.(d as never)
  broadcast(h.rt, d)
}

// Новое сообщение → SSOT + broadcast. Мост deliveredSeq (Wave 4 удалит) поддерживаем;
// backfill (гашение звука/нотиф/непрочитанных) нужен только на /sync-пути для кадров,
// уже доставленных в ПРОШЛОЙ сессии воркера (курсор их не отсёк, т.к. pts тогда не
// было) — на live-пути дедуп полностью на курсоре, backfill не нужен.
function routeNewMessage(e: NewMessageEvt, live: boolean): void {
  const prev = deliveredSeq.get(e.chat_id) ?? 0
  if (!live && e.seq <= prev) { broadcast(RT.newMessage, { ...e, backfill: true }); return }
  deliveredSeq.set(e.chat_id, Math.max(prev, e.seq)); persistDelivered()
  messages.cacheLive(e as never)
  broadcast(RT.newMessage, e)
}

// Буфер out-of-order живых кадров (порт pendingPtsUpdates tweb). Дыру в pts не
// гоним сразу в /sync — придерживаем кадр и ждём, пока её закроют следующие живые
// кадры (наш источник переупорядочивания — async-decrypt секретов, см. onFrame).
const pendingPts = newPendingPts()
// tweb: SYNC_DELAY=6мс — там апдейты синхронны, «дырка» закрывается в том же тике.
// У нас переупорядочивание даёт асинхронная расшифровка (WebCrypto, десятки мс),
// поэтому ждём дольше, прежде чем уйти в catch-up. Реальную потерю кадра (publish
// упал) буфер пересидеть не сможет — по таймауту чистимся и добираем через /sync.
const PTS_SYNC_DELAY = 250
let ptsSyncTimer: ReturnType<typeof setTimeout> | null = null
function schedulePtsSync(): void {
  if (ptsSyncTimer) return
  ptsSyncTimer = setTimeout(() => {
    ptsSyncTimer = null
    if (!pendingPts.has()) return
    pendingPts.clear()      // как tweb: getDifference сбрасывает pendingPtsUpdates
    void sync.catchUp()
  }, PTS_SYNC_DELAY)
}
function clearPtsSync(): void {
  if (ptsSyncTimer) { clearTimeout(ptsSyncTimer); ptsSyncTimer = null }
  pendingPts.clear()
}
// Слить подряд идущие буферные кадры после того, как живой next закрыл дыру.
function drainPending(): void {
  if (!pendingPts.has()) return
  pendingPts.drain(() => cursor.get().pts, (item) => {
    dispatch(item.t, item.pts, item.d, true)
    cursor.advance(item.pts)
  })
  if (!pendingPts.has() && ptsSyncTimer) { clearTimeout(ptsSyncTimer); ptsSyncTimer = null }
}

// Единый funnel. live=true — WS-кадр (pts внутри payload), live=false — элемент /sync
// (pts сверху). Арифметика курсора: dup→drop, next→apply+advance, gap(live)→буфер.
function applyUpdate(t: string, pts: number | undefined, d: unknown, live: boolean): void {
  // Без pts — эфемерный/устаревший бэк: транслируем как есть, не гейтим.
  if (typeof pts !== 'number') { dispatch(t, pts, d, live); return }
  if (live) {
    // Гейт гидратации: до загрузки курсора из IDB не применяем вслепую — catch-up
    // (он ждёт cursor.ready()) добёрет по порядку.
    if (!cursorReady) { void sync.catchUp(); return }
    // Гейт syncLoading: пока идёт catch-up, живые кадры с pts отбрасываем — diff
    // переотдаст их по порядку; после catch-up pts===cursor+1 продолжит live.
    if (sync.isSyncing()) return
    const cls = classifyPts(cursor.get().pts, pts)
    if (cls === 'dup') return
    if (cls === 'gap') {
      // Out-of-order живой кадр: буферизуем и ждём, что дыру закроют следующие
      // кадры (тогда drainPending применит по порядку без round-trip). Переполнение
      // буфера — дыра слишком велика, чтобы пересидеть → сразу catch-up.
      if (!pendingPts.push({ t, pts, d })) { clearPtsSync(); void sync.catchUp(); return }
      schedulePtsSync()
      return
    }
    dispatch(t, pts, d, true)
    cursor.advance(pts)
    drainPending()
    return
  }
  // /sync-путь: применяем строго вперёд, дубли (уже применённые live) отсекаем.
  if (classifyPts(cursor.get().pts, pts) === 'dup') return
  dispatch(t, pts, d, false)
  cursor.advance(pts)
}

const ws = new WsClient('/ws')
const sync = newSyncEngine({
  rest, cursor,
  onUpdate: (item) => applyUpdate(item.t, item.pts, item.d, false),
  // Полный resync ставит курсор на серверный pts — придержанные out-of-order кадры
  // теперь либо дубли, либо оторванная «будущая» дыра; сбрасываем, чтобы не всплыли.
  onResync: () => { clearPtsSync(); broadcast('rt:resync', null) },
})
const conn = newConnectionManager({
  ws, getToken: () => tokens.get(),
  // Unacked sends persist in IndexedDB: a reload doesn't lose queued messages —
  // they're restored into the outbox and resent on the next connect.
  outboxStore: {
    load: () => idbGet<import('./realtime/connectionManager').SendArgs[]>('outbox'),
    save: (list) => { void idbSet('outbox', list) },
  },
  // onReady: только гарантируем гидратацию мостов/курсора (гейт первого apply).
  // Сам catch-up на (ре)коннекте инициирует hello-кадр (fast-reconnect без REST,
  // если pts совпал). Ждём ещё deliveredReady/reactionReady — мост Wave 4.
  onReady: () => { void Promise.all([cursor.ready(), deliveredReady, reactionReady]) },
  onState: (s) => broadcast(RT.state, { state: s }),
  onFrame: (type, payload) => {
    // hello — первый кадр WS: {pts,date}. pts===cursor → быстрый reconnect без REST;
    // иначе catch-up доберёт разницу. cursor.ready() гейтит сравнение до гидратации.
    if (type === 'hello') {
      const p = payload as { pts?: number; date?: number }
      if (typeof p?.pts === 'number') {
        const want = p.pts
        // Реконнект с расхождением pts: catch-up добёрет разницу — придержанные
        // out-of-order кадры теперь оторваны от новой базы, сбрасываем (инвариант
        // tweb: getDifference чистит pendingPtsUpdates), чтобы не всплыли позже.
        void cursor.ready().then(() => { if (want !== cursor.get().pts) { clearPtsSync(); void sync.catchUp() } })
      }
      return
    }
    // new_message: возможна E2E-расшифровка enc_body перед funnel → bespoke.
    if (type === 'new_message') {
      const p = payload as { chat_id?: number; enc_body?: string; text?: string; entities?: unknown; secret_media?: unknown; pts?: number }
      if (p.enc_body && p.chat_id) {
        void secret.decryptMessage(p.chat_id, p.enc_body).then((dec) => {
          if (dec) { p.text = dec.text; p.entities = dec.entities; if (dec.media) p.secret_media = dec.media }
          applyUpdate('new_message', p.pts, payload, true)
        })
      } else {
        applyUpdate('new_message', p.pts, payload, true)
      }
      return
    }
    // Логируемый кадр (несёт pts) → единый funnel: дедуп/gap/cache/broadcast.
    if (APPLY[type]) { applyUpdate(type, (payload as { pts?: number })?.pts, payload, true); return }
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

const realtime = newRealtime({ conn, tokens, messages, broadcast })

// Единый реестр менеджеров — единственный источник правды. UI-тип Managers
// (bootstrap.ts) выводится из этого объекта (WorkerRegistry), поэтому рассинхрон
// «забыл в одном списке» невозможен by construction (как Managers в tweb).
const registry = {
  health, auth, profile, premium, chats, messages, realtime, media, push, notify,
  folders, groups, channels, peers, presence, stories, contacts, privacy, drafts,
  chatThemes, sessions, calls, livestream, stars, boosts, report, stats, bots,
  stickers, iv, secret, persist,
}
export type WorkerRegistry = typeof registry

function bind(ep: Endpoint) {
  const smp = new SuperMessagePort(ep)
  ports.push(smp)
  registerManagers(smp, registry)
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
