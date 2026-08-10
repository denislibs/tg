/// <reference lib="webworker" />
import { SuperMessagePort, type Endpoint, type EventMeta } from '../rpc/superMessagePort'
import { registerManagers } from '../rpc/managersProxy'
import { RestClient } from './net/restClient'
import { createTransport } from './net/createTransport'
import { ChannelRpc } from './net/dnp/channelRpc'
import { newFileDownload } from './net/dnp/fileDownload'
import { newFileUpload } from './net/dnp/fileUpload'
import { attachStreamBridge } from './net/dnp/streamBridge'
import { AppConfig } from '../config/app'
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
import { newCursor } from './realtime/cursor'
import { newChannelFunnel, type ChannelDiff } from './realtime/channelFunnel'
import { newGlobalFunnel } from './realtime/globalFunnel'
import { createSecretManager } from './managers/secretManager'
import { RT, type NewMessageEvt } from './realtime/events'
import type { MessageOp } from './realtime/messageOps'
import { PASS_THROUGH, type LoggedWsType } from './realtime/eventCatalog'
import { idbGet, idbSet } from './store/idbKv'
import { persistScope } from './store/persist'

const tokens = new TokenStore()
// Скоуп нормализованного офлайн-стора по токену: при смене аккаунта данные
// предыдущего стираются, прежде чем воркер начнёт писать сообщения/юзеров.
void tokens.load().then(() => persistScope(tokens.get()))
// ready() гейтит REST-запросы до загрузки токена из IDB (иначе гонка «missing token»
// на старте, когда UI шлёт RPC раньше, чем поднялся токен воркера).
// Транспорт создаём здесь (раньше — на строке ~250), чтобы RestClient получил канал.
// createTransport() — чистое создание объекта, connect() зовётся позже connectionManager'ом.
const ws = createTransport()
// channelRpc активен только при DNP-ON; иначе RestClient идёт через fetch.
const channelRpc = AppConfig.dnp.enabled ? new ChannelRpc(ws) : undefined
// fileDownload активен только при DNP-ON: скачивание медиа чанками через канал (media.contentBlob).
const fileDownload = AppConfig.dnp.enabled ? newFileDownload(ws) : undefined
// fileUpload активен только при DNP-ON: загрузка медиа чанками через канал (media.upload).
const fileUpload = AppConfig.dnp.enabled ? newFileUpload(ws) : undefined
const rest = new RestClient('/api', () => tokens.get(), () => tokens.ready(), channelRpc)
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
const messages = newMessagesManager({ rest, decryptSecret: (chatId, encBody) => secret.decryptMessage(chatId, encBody), getMeId: () => meId })
// broadcast объявлен ниже — замыкание дергает его лениво (к моменту первого
// аплоада порты уже подняты)
const media = newMediaManager({
  rest,
  onUploadProgress: (id, loaded, total) => broadcast('media:upload_progress', { id, loaded, total }),
  fileDownload,
  fileUpload,
})
const push = newPushManager({ rest })
const notify = newNotifyManager({ rest })
const folders = newFoldersManager({ rest })
// broadcast объявлен ниже — стрелка дергает его лениво (к моменту первой мутации
// порты уже подняты), как у media. Кросс-таб-эхо REST-мутаций без WS-эха бэка.
const groups = newGroupsManager({ rest })
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
// broadcast объявлен ниже — стрелка дергает его лениво (к моменту первой записи
// State порты уже подключены). Зеркало ключа уходит ВО ВСЕ вкладки: порт tweb
// appStateManager.setKeyValueToStorage → invokeVoid('mirror', …), которая без
// указания порта рассылается по всем sendPorts (superMessagePort.ts:379).
const persist = newPersistManager((key, value) => broadcast('state:mirror', { key, value }))

// every connected tab's port — events broadcast to all
const ports: SuperMessagePort[] = []
const broadcast = (event: string, payload: unknown, meta?: EventMeta) => { for (const p of ports) p.emit(event, payload, meta) }

// ── Wave 3 funnel ────────────────────────────────────────────────────────────
// Точка применения: реестр APPLY + dispatch (логируемые апдейты: SSOT + broadcast).
// Арифметика pts (дубль/следующий/дыра, буфер, таймер) — в realtime/globalFunnel.ts.
// Эфемерные кадры (typing/presence/calls/…) сюда НЕ заходят — их onFrame транслирует как есть.
const cursor = newCursor({ get: idbGet, set: idbSet })
let cursorReady = false
void cursor.ready().then(() => { cursorReady = true })

// Единый реестр маршрутизации логируемых типов: cache (в SSOT воркера, ДО broadcast —
// иначе переоткрытие чата из кэша теряет апдейт) + rt (имя события для UI). Замена
// прежних CACHE_THEN_BROADCAST + CATCHUP. new_message — спец-обработка (E2E-расшифровка
// + cacheLive), см. routeNewMessage.
// Ключи APPLY типизированы как LoggedWsType (из eventCatalog) — пропуск/лишний
// логируемый тип ловит компилятор, реестры не дрейфуют.
// cache может вернуть MessageOp[] (Stage 1B.3, Task 3: media_read/web_page_update/
// factcheck_update/paid_media_unlock/delete_message — по образцу cacheLive, см.
// dispatch ниже) — тогда dispatch рассылает их ОТДЕЛЬНЫМ кадром RT.messageOp, как
// routeNewMessage. edit_message/geo_live_update оставлены на прежнем пути (сырой
// кадр) — см. комментарии у messages.cacheEdit/cacheGeoLive в messagesManager.ts.
const APPLY: Record<LoggedWsType, { rt: string; cache?: (p: never) => MessageOp[] | void }> = {
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
// Эфемерные кадры (PASS_THROUGH) и логируемые (APPLY) выводятся из eventCatalog —
// единого реестра WS-типов. Bespoke-кадры (hello/секрет-handshake/обёртки звонков)
// обрабатываются явно в onFrame.

// Отражение логируемого апдейта в SSOT + broadcast (без арифметики pts — её делает
// applyUpdate). `d` — полезная нагрузка (для live это весь payload, для /sync это
// item.d). new_message — спец-путь (E2E-расшифровка + bespoke cacheLive).
// Stage 1B.3 (Task 3): если cache() вернул операции — рассылаем их ДО сырого кадра
// (тот же порядок, что у routeNewMessage): проектор берёт окно операцией, сырой
// кадр остаётся параллельно для того, что операциями не покрыто (переключение
// обратимо одной строкой, как и было в 1B.2).
function dispatch(t: string, d: unknown, meta?: EventMeta): void {
  if (t === 'new_message') { routeNewMessage(d as NewMessageEvt, meta); return }
  const h = APPLY[t as LoggedWsType]
  if (!h) return
  const ops = h.cache?.(d as never)
  if (ops && ops.length) broadcast(RT.messageOp, { ops }, meta)
  broadcast(h.rt, d, meta)
}

// Новое сообщение → SSOT + broadcast. Дедуп и порядок — на курсоре в applyUpdate
// (дубль с pts<=cursor сюда уже не доходит), поэтому спец-belt'ов дедупа сообщений
// больше нет: catch-up-реплей отсекается funnel'ом до этой точки.
// Stage 1B.2 (Task 3): cacheLive теперь возвращает операции, породившиеся в SSOT
// (по одной на затронутое окно) — рассылаем их ОТДЕЛЬНЫМ кадром RT.messageOp В
// ДОПОЛНЕНИЕ к rt:new_message. Оба кадра пока летят: старый путь (разбор кадра на
// главном потоке) остаётся рабочим, новый (replay операций) переключается отдельной
// задачей — откат одной строкой, если что-то пойдёт не так.
function routeNewMessage(e: NewMessageEvt, meta?: EventMeta): void {
  const ops = messages.cacheLive(e as never)
  broadcast(RT.messageOp, { ops }, meta)
  broadcast(RT.newMessage, e, meta)
}

// Per-channel pts-конверт (Волна 5): каналы гейтятся против собственного
// channel_pts, а не общего пер-юзерного курсора. dispatch — тот же (SSOT+broadcast),
// difference — типизированный конверт, курсор персистится в IDB (chpts:{id}).
const channelFunnel = newChannelFunnel({
  dispatch,
  getDifference: (chatId, sincePts) => rest.get<ChannelDiff>(`/channels/${chatId}/difference`, { pts: sincePts }),
  loadPts: (chatId) => idbGet<number>(`chpts:${chatId}`).then((v) => (typeof v === 'number' ? v : null)),
  savePts: (chatId, pts) => { void idbSet(`chpts:${chatId}`, pts) },
})

const sync = newSyncEngine({
  rest, cursor,
  onUpdate: (item) => funnel.applyUpdate(item.t, item.pts, item.d, false),
  // Полный resync ставит курсор на серверный pts — придержанные out-of-order кадры
  // теперь либо дубли, либо оторванная «будущая» дыра; сбрасываем, чтобы не всплыли.
  // Канальные in-memory курсоры тоже забываем — переоткрытие пересидирует из IDB.
  onResync: () => { funnel.clear(); channelFunnel.reset(); broadcast('rt:resync', null) },
})
// Единый (пер-юзерный) funnel — арифметика dup/next/gap + буфер придержанных кадров
// (Wave 3), вынесенная в модуль с явными зависимостями (Task 1). dispatch остаётся
// здесь (знает про APPLY/routeNewMessage/broadcast), funnel про менеджеры не знает.
const funnel = newGlobalFunnel({
  dispatch,
  cursor,
  isCursorReady: () => cursorReady,
  isSyncing: () => sync.isSyncing(),
  catchUp: () => { void sync.catchUp() },
})
const conn = newConnectionManager({
  ws, getToken: () => tokens.get(),
  // Unacked sends persist in IndexedDB: a reload doesn't lose queued messages —
  // they're restored into the outbox and resent on the next connect.
  outboxStore: {
    load: () => idbGet<import('./realtime/connectionManager').SendArgs[]>('outbox'),
    save: (list) => { void idbSet('outbox', list) },
  },
  // onReady: гарантируем гидратацию курсора из IDB (гейт первого apply). Сам
  // catch-up на (ре)коннекте инициирует hello-кадр (fast-reconnect без REST,
  // если pts совпал).
  onReady: () => { void cursor.ready() },
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
        void cursor.ready().then(() => { if (want !== cursor.get().pts) { funnel.clear(); void sync.catchUp() } })
      }
      return
    }
    // Канальный кадр (пост или метаданные канала: chat_update/boost_update) несёт
    // channel_pts + chat_id → per-channel funnel (свой курсор, difference-catch-up).
    // Раньше new_message-ветки: посты канала приходят как new_message, но с
    // channel_pts и без E2E (каналы — публичный broadcast, enc_body не бывает).
    {
      const cf = payload as { channel_pts?: number; chat_id?: number }
      if (typeof cf?.channel_pts === 'number' && typeof cf?.chat_id === 'number') {
        channelFunnel.applyLive(cf.chat_id, type, cf.channel_pts, payload)
        return
      }
    }
    // new_message: возможна E2E-расшифровка enc_body перед funnel → bespoke.
    if (type === 'new_message') {
      const p = payload as { chat_id?: number; enc_body?: string; text?: string; entities?: unknown; secret_media?: unknown; pts?: number }
      if (p.enc_body && p.chat_id) {
        void secret.decryptMessage(p.chat_id, p.enc_body).then((dec) => {
          if (dec) { p.text = dec.text; p.entities = dec.entities; if (dec.media) p.secret_media = dec.media }
          funnel.applyUpdate('new_message', p.pts, payload, true)
        })
      } else {
        funnel.applyUpdate('new_message', p.pts, payload, true)
      }
      return
    }
    // Логируемый кадр (несёт pts) → единый funnel: дедуп/gap/cache/broadcast.
    if (APPLY[type as LoggedWsType]) { funnel.applyUpdate(type, (payload as { pts?: number })?.pts, payload, true); return }
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

const realtime = newRealtime({ conn, tokens, messages, broadcast, channelFunnel })

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
  // Событие, порождённое вкладкой (rootScope.dispatchEvent), ретранслируем всем
  // ОСТАЛЬНЫМ вкладкам — порт tweb index.worker.ts:116-119 (invokeExceptSource).
  // Источнику не шлём: у него оно уже доставлено локально, иначе кольцо.
  smp.onAny((event, payload, meta) => {
    for (const p of ports) if (p !== smp) p.emit(event, payload, meta)
  })
  // SW↔SharedWorker мост (§ PR-2a): окно (PR-2c) шлёт по этому же порту control-кадр
  // dnp-bridge-port с переданным MessagePort к SW. SMP такой кадр игнорит (нет kind) —
  // ловим сырым слушателем и подключаем мост к каналу. Активно лишь при DNP-ON.
  if (fileDownload) {
    ep.addEventListener('message', (ev: MessageEvent) => {
      const d = ev.data as { t?: string } | null
      if (d && d.t === 'dnp-bridge-port' && ev.ports && ev.ports[0]) {
        attachStreamBridge(ev.ports[0], fileDownload)
      }
    })
  }
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
