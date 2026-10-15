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
import deepEqual from '@helpers/object/deepEqual'
import { newAuthManager, type PeerProfile } from './managers/authManager'
import { newProfileManager } from './managers/profileManager'
import { newPremiumManager } from './managers/premiumManager'
import { newChatsManager } from './managers/chatsManager'
import { newMessagesManager } from './managers/messagesManager'
import { newMediaManager } from './managers/mediaManager'
import { newPushManager } from './managers/pushManager'
import { newNotifyManager, type NotifyTypeKey } from './managers/notifyManager'
import { newFoldersManager } from './managers/foldersManager'
import { newGroupsManager } from './managers/groupsManager'
import { newChannelsManager } from './managers/channelsManager'
import { newPeersManager } from './managers/peersManager'
import { isBroadcast, isForum } from './peers/predicates'
import type { Chat } from './peers/peer'
import { newDialogsManager } from './managers/dialogsManager'
import { mapMessage } from './models'
import { newForumTopicsStorage } from './managers/forumTopicsStorage'
import { newThreadReads } from './managers/threadReads'
import { newPresenceManager } from './managers/presenceManager'
import { newStoriesManager } from './managers/storiesManager'
import { newContactsManager } from './managers/contactsManager'
import { newPrivacyManager, privacyFrameKey, type PeerBlockEvt } from './managers/privacyManager'
import { newStarsManager } from './managers/starsManager'
import { newBoostsManager } from './managers/boostsManager'
import { newStickersManager } from './managers/stickersManager'
import { newReactionsManager } from './managers/reactionsManager'
import { newReportManager } from './managers/reportManager'
import { newStatsManager } from './managers/statsManager'
import { newBotsManager } from './managers/botsManager'
import { newIVManager } from './managers/ivManager'
import { newWebPagesManager } from './managers/webPagesManager'
import { newDraftsManager } from './managers/draftsManager'
import { newPersistManager } from './managers/persistManager'
import { newChatThemesManager } from './managers/chatThemesManager'
import { newSessionsManager } from './managers/sessionsManager'
import { newLangPackManager } from './managers/langPackManager'
import { newCallsManager } from './managers/callsManager'
import { newLivestreamManager } from './managers/livestreamManager'
import { getDoc } from './media/messageMedia'
import { newConnectionManager } from './realtime/connectionManager'
import { newRealtime } from './realtime/realtime'
import { newSyncEngine } from './realtime/syncEngine'
import { newCursor } from './realtime/cursor'
import { newChannelFunnel, type ChannelDifference } from './realtime/channelFunnel'
import { newSyncWait } from './realtime/syncWait'
import { newGlobalFunnel } from './realtime/globalFunnel'
import { createSecretManager } from './managers/secretManager'
import { RT, type AckEvt, type MessageErrorEvt, type GeoLiveUpdateEvt, type NewMessageEvt, type PendingNewEvt, type ReadEvt, type ChatUpdateEvt, type ChatRemovedEvt, type ChannelEvt, type ReactionEvt, type DialogPinEvt, type DialogArchiveEvt, type DialogMuteEvt, type DraftUpdateEvt, type UserUpdateEvt, type ViewsUpdateEvt, type MediaReadEvt, type Update, type ChannelParticipantEvt, type PendingJoinRequestsEvt, type ChatRequestsEvt, type PinnedForumTopicEvt, type ReadDiscussionEvt, type NewScheduledMessageEvt, type DeleteScheduledMessagesEvt, type PeerBlockedEvt, type PrivacyEvt, type NewStickerSetEvt, type BotCommandsEvt } from './realtime/events'
import type { MessageOp } from './realtime/messageOps'
import { generateMessageId } from './history/messageId'
import { getPeerId, toChatId, toPeerId } from './peers/peerId'
import { LOGGED_WITHOUT_CONSTRUCTOR, PASS_THROUGH } from './realtime/transportFrames'
import { CHANNEL_CURSOR, UPDATE_RT, channelPeerId, channelTwin, updatePredicate } from './realtime/updateCatalog'
import { idbGet, idbSet } from './store/idbKv'
import { sessionKv } from './store/sessionKv'
import { newPasscodeWorker } from './passcode/passcodeWorker'
import { PASSCODE_CHANNEL, RELOAD_CHANNEL, type PasscodeTask } from './passcode/protocol'
import { AppTabsManager, TAB_STATE_CHANNEL, TOGGLE_UNINTERUPTABLE_ACTIVITY_CHANNEL, type TabState, type ToggleUninteruptableActivityPayload } from '@lib/appManagers/appTabsManager'
import { useAutoLock } from '@lib/mainWorker/useAutoLock'
import { persistClearAll, persistScope, loadDialogs, loadStateAll, saveStateKey, saveDialogs, saveMe, loadMe } from './store/persist'
import { STATE_VERSION, initialState } from './state/state'
import { newWorkerScope } from './realtime/workerScope'
import indexOfAndSplice from '../helpers/array/indexOfAndSplice'

export function createWorkerCore() {
  const tokens = new TokenStore()
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
  // Провод TL у REST — тем же флагом, что у сокета: формат просит КЛИЕНТ, а
  // сервер умеет обе формы (заголовок `Accept`). Разбор грузится динамически,
  // чтобы схема не попадала в бандл при выключенном флаге.
  if (AppConfig.tlWire) {
    // Отказ глотаем: не подгрузился разбор TL — REST остаётся на JSON, ту же форму
    // сервер отдаёт по тому же `Accept`. Это деградация, а не повод для unhandled rejection.
    void import('./net/tlFrames').then((m) => { rest.useTLWire(m.decodeTLValue) }).catch(() => {})
  }
  // Stage 1C.2 (Task 1): текущий пользователь — воркер единственный владелец.
  // Раньше здесь жил голый `meId: number | null` для внутренних нужд (кэш
  // «мои» реакций) — теперь кэшируем профиль целиком и рассылаем его вкладкам
  // (rt:me) через setMe при каждом изменении, а не только держим id при себе.
  let me: PeerProfile | null = null
  // Гейт «личность известна» (Message.out — порт tweb pFlags.out). `out`
  // выводится сравнением senderId с id текущего пользователя, а тот появляется у
  // воркера асинхронно: раньше — только с ответом /me. Страница истории,
  // обслуженная до него, уехала бы вкладке с out=false у ВСЕХ сообщений —
  // молчаливая регрессия (все свои сообщения слева, без галочек). Гейт снимает
  // либо гидрация `me` с диска в start() (симметрично write-through `saveMe`
  // ниже — на диске лежит `me` прошлого запуска), либо первый setMe, что
  // случится раньше; на первом в жизни браузера входе диска ещё нет, но там
  // `me` ставит сам вход (authManager.persist → onMeChanged → setMe) ДО того,
  // как вкладка попросит историю. Ждут гейт только сетевые пути messagesManager
  // (см. meReady в MessagesDeps); воркер без start() истории не обслуживает.
  let markMeReady!: () => void
  const meReady = new Promise<void>((resolve) => { markMeReady = resolve })
  // Публикует свежий `me` всем вкладкам + обновляет локальный кэш. Зовётся на
  // старте (auth.me() ниже) и как onMeChanged профиля/премиума/логаута.
  // `broadcast` объявлен ниже — функция дёргает его лениво (тот же приём, что
  // у messages/media ниже: onMeChanged передаётся менеджерам ДО того, как
  // broadcast существует, но реально исполняется только после первого RPC/boot,
  // когда broadcast уже назначен).
  //
  // Task 5 (персист диалогов переезжает к владельцу): раньше `me` персистился
  // ВМЕСТЕ со списком диалогов — main-thread-подписка `stores/dialogsPersist.ts`
  // дебаунсила снимок ОБОИХ (`persist.dialogs(dialogs, me)`) и слала его сюда
  // РАЗОВЫМ RPC. `dialogsPersist.ts` удалён (владелец списка пишет свой кэш
  // сам, см. dialogsManager.ts/scheduleSave), а честный дом записи `me` —
  // здесь: воркер и так единственный вычислитель этого факта (см. докблок
  // выше), `setMe` — единственная точка его изменения. Write-through без
  // дебаунса, как и у `saveStateKey` (persistManager.ts: «блоб маленький,
  // дебаунс не нужен») — `me` меняется по явным действиям пользователя
  // (профиль/премиум/вход/выход), не потоком. Passcode-гейт — тот же, что и
  // раньше: внутри `saveMe` (core/store/persist.ts), новый путь его не обходит.
  function setMe(u: PeerProfile | null): void {
    me = u
    markMeReady() // личность разрешена — гейт `out` снимаем (идемпотентно)
    void saveMe(u)
    broadcast(RT.me, u)
  }
  const auth = newAuthManager({
    rest,
    store: tokens,
    onMeChanged: setMe,
    // Намерение перехода сессии (порт tweb `logging_out`) — рассылаем всем
    // вкладкам, включая инициатора: у tweb этот кадр тоже общий для всех
    // (`apiManagerProxy.ts:330` — commonEventNames, доставляется вкладке даже
    // под другим аккаунтом). Кэш `me` здесь не трогаем — им управляет
    // onMeChanged, отдельным каналом значения.
    // Медиа-токен здесь же выбрасываем — ДО публикации намерения и синхронно с
    // ней: он подписан на конкретного пользователя и живёт до 15 минут (бэк:
    // signMediaToken(userID)), так что переживший переход токен остаётся ключом
    // к медиа прошлого аккаунта у всех вкладок разом. Порядок обязателен —
    // вкладка, ответившая на кадр запросом токена, обязана застать владельца уже
    // сброшенным, иначе получит прежний. Тот же порядок, что у tweb: `clear()`
    // в `apiManager.logOut()` стирает ключи/кэши и лишь потом диспатчит
    // `logging_out` (`appManagers/apiManager.ts:289-335`).
    // Конвейер downloadMediaURL (Task 6) сбрасывается тем же порядком и по той
    // же причине: кэш-контекст с blob:-URL и корзина cachedFiles — тоже медиа
    // конкретного пользователя, пережить переход они не могут (закрывает
    // остаточный риск PR #191). Синхронная часть (контекст, revoke, поколение)
    // — ДО broadcast; деструкция корзины внутри — void (кадр диска не ждёт).
    //
    // Task 5, «Осторожно»: `dialogs.cancelPersist()` тем же порядком и по той
    // же причине, что и media выше — гасит ОЖИДАЮЩИЙ таймер владельца
    // (dialogsManager.scheduleSave), пока он ещё не выстрелил, экономя
    // заведомо бессмысленную запись. От гонки «запись уже в полёте, когда
    // приходит persist.clearAll()» защищает НЕ этот вызов, а порядок
    // IndexedDB-транзакций в core/store/persist.ts (enqueue исполняется в
    // порядке вызова, clear физически не может обогнать уже вызванный
    // enqueue записи) — подробный разбор гонки в докблоке
    // `dialogsManager.cancelPersist()`, здесь не дублируем.
    // `dialogs.resetForLogout()` (Task 6) — сосед по той же причине: сам кэш
    // (`items`/`hydrated`) владельца переживает переход сессии (SharedWorker
    // общий на все вкладки), без сброса следующий `fillMirror()` под другим
    // аккаунтом отдал бы чужой список — см. докблок `resetForLogout()`.
    // `contacts.resetForLogout()` — то же для книги контактов и её индекса.
    //
    // `cursor.reset()` — курсор апдейтов тоже про сессию: он лежит в общем
    // `msgr/kv` вне скоупа персиста, и без сброса вход после выхода догонял бы
    // разницу от курсора ПРОШЛОЙ сессии (а то и чужого аккаунта) вместо того,
    // чтобы взять базой текущее состояние сервера (updates.getState, onReady).
    onLoggingOut: (e) => { media.resetToken(); media.resetDownloads(); dialogs.cancelPersist(); dialogs.resetForLogout(); forumTopics.reset(); threadReads.reset(); drafts.reset(); contacts.resetForLogout(); stickers.reset(); cursor.reset(); channelFunnel.resetForLogout(); broadcast(RT.loggingOut, e) },
    // Симметричный кадр входа (порт tweb `account_logged_in`) — тем же веером и
    // с тем же сбросом: активный токен сменился, а значит медиа-токен, добытый
    // до входа, принадлежит прошлой сессии; то же — про кэш диалогов.
    onLoggedIn: (e) => { media.resetToken(); media.resetDownloads(); dialogs.cancelPersist(); dialogs.resetForLogout(); forumTopics.reset(); threadReads.reset(); drafts.reset(); contacts.resetForLogout(); stickers.reset(); cursor.reset(); channelFunnel.resetForLogout(); broadcast(RT.loggedIn, e) },
  })
  const profile = newProfileManager({ rest, onMeChanged: setMe, getMe: () => me })
  const premium = newPremiumManager({ rest, onMeChanged: setMe })
  const chats = newChatsManager({
    rest,
    // Контейнер «Избранного» несёт векторы `chats`/`users`/`messages`: строка
    // держит только ССЫЛКИ, и разрешаются они тем же порядком, что у
    // контейнера диалогов. `peers`/`messages` объявлены НИЖЕ — та же ленивая
    // forward-ссылка, что у соседних менеджеров: стрелка вызывается только на
    // сам запрос.
    peers: { saveApiPeers: (r) => peers.saveApiPeers(r) },
    messages: {
      saveApiMessages: (list) => messages.saveApiMessages(list),
      getMessageByPeer: (peerId, seq) => messages.getMessageByPeer(peerId, seq),
      flushHistoryWindows: (peerId) => messages.flushHistoryWindows(peerId),
    },
    // Очистка и удаление истории (tweb `flushHistory`): ответ — местный
    // `updatePts` воронки, затем окна и строка диалога. Воронка и владельцы
    // объявлены НИЖЕ — та же ленивая forward-ссылка.
    getFunnel: () => funnel,
    dialogs: {
      reloadConversation: (peerId) => dialogs.reloadConversation(peerId),
      applyRemoved: (peerId) => dialogs.applyRemoved(peerId),
      getDialogOnly: (peerId) => dialogs.getDialogOnly(peerId),
    },
    broadcast: (event, payload) => broadcast(event, payload),
  })
  // Закреп удалён вместе с сообщением (tweb :14078-14080, `resetPinnedMessagesCache`):
  // кэш закрепов живёт на главном потоке и сообщений вне окна воркера не знает, поэтому
  // воркер шлёт вкладкам номера удалённых и те из них, что сам знает закреплёнными
  // (`peer_pinned_deleted`). Вектор кадра `updateDeletePeerMessages` расходится по
  // номерам (`evictAndBuildRemoveOps`), а очистка истории шлёт кадры по 1000 номеров, —
  // события одного пира склеены в одно на микротаске: после операций окна того же кадра
  // и с одним обработчиком на вкладке вместо обработчика на каждый номер. `broadcast` объявлен ниже — вызов ленивый.
  const pinnedDeleted = new Map<number, { mids: number[]; pinned: number[] }>()
  const queuePinnedDeleted = (peerId: number, mids: number[], pinned: number[]) => {
    let batch = pinnedDeleted.get(peerId)
    if (!batch) {
      batch = { mids: [], pinned: [] }
      pinnedDeleted.set(peerId, batch)
      if (pinnedDeleted.size === 1) {
        queueMicrotask(() => {
          const flush = [...pinnedDeleted]
          pinnedDeleted.clear()
          for (const [id, b] of flush) broadcast('peer_pinned_deleted', { peerId: id, ...b })
        })
      }
    }
    batch.mids.push(...mids)
    batch.pinned.push(...pinned)
  }
  // decryptSecret дергает secret лениво — стрелка вызывается только на fetch истории
  // (после инициализации модуля), поэтому forward-ссылка на объявленный ниже secret безопасна.
  // broadcast объявлен ниже — стрелка дергает его лениво (оптимистичные мутации
  // tweb-модели: менеджер применяет к SSOT и бродкастит эхо всем вкладкам). Нужен
  // deleteMessage (RPC-путь удаления сообщения): рассылает остальным вкладкам
  // remove-операции, которых WS delete_message уже не даст (SSOT к его приходу пуст).
  const messages = newMessagesManager({
    // Состояние треда комментариев — владельцу прочтения тредов (объявлен ниже, стрелка ленивая).
    saveDiscussion: (peerId, threadId, state) => threadReads.saveDiscussion(peerId, threadId, state),
    rest,
    decryptSecret: (peerId, encBody) => secret.decryptMessage(peerId, encBody),
    getMeId: () => me?.user.id ?? null,
    // Порт `rootScope.premium` (tweb apiManagerMethods.ts:393): от подписки
    // зависит лимит своих реакций на сообщении. Геттер, а не значение, — `me`
    // разрешается лениво и меняется покупкой премиума (premiumManager → setMe).
    getMePremium: () => !!me?.user.pFlags?.premium,
    // tweb appMessagesManager.ts:13503-13505: история канала
    // (`messages.channelMessages`) заводит состояние канала его pts. Стрелка
    // ленивая: воронка каналов объявлена ниже.
    addChannelState: (peerId, pts) => { channelFunnel.addChannelState(peerId, pts) },
    // Порт `appPeersManager.isBroadcast(peerId)` для `generateFlags`: бабл поста
    // вещательного канала рождается с `pFlags.post` — иначе он стоял бы справа
    // до эха и прыгал влево (см. `PendingCtx.isBroadcastChat`). Стрелка ленивая
    // ровно как send/upload ниже: `peers` объявлен дальше по файлу.
    isBroadcastChat: (peerId) => isBroadcast(peers.cachedPeer(peerId) as Chat | undefined),
    // Порт `appPeersManager.getPeer` для `canEditMessage` (`getFirstMessageToEdit`).
    getPeer: (peerId) => peers.cachedPeer(peerId),
    // Гейт вывода `out` (см. объявление meReady выше).
    meReady: () => meReady,
    broadcast: (event, payload) => broadcast(event, payload),
    // ТРАНСПОРТ И АПЛОАД — ИНЪЕКЦИЕЙ (порт модели tweb: менеджер получает
    // зависимости при сборке через реестр AppManagers, а не импортирует их).
    // Именно это снимает кольцо messagesManager ↔ connectionManager, из-за
    // которого отправка раньше жила в realtime.ts. Все пять стрелок ленивые:
    // conn/media объявлены НИЖЕ, но исполняются только на первой отправке —
    // тот же приём, что у broadcast/decryptSecret выше.
    send: (a) => conn.sendMessage(a),
    upload: (a) => media.upload(a),
    cancelUpload: (id) => { void media.cancelUpload(id) },
    sendTyping: (peerId, action) => conn.sendTyping(peerId, action),
    uploadProgress: (id, loaded, total, done) => broadcast('media:upload_progress', { id, loaded, total, done }),
    // Пиры, приехавшие ПОПУТНО со списком сообщений (`users` контейнера
    // messages.Messages), — тем же приёмником, что у диалогов и звонков.
    // Стрелка ленивая: `peers` объявлен ниже по файлу.
    peers: { saveApiPeers: (o) => peers.saveApiPeers(o) },
    // Удалённое из окна — владельцу диалогов: он вычитает удалённые
    // непрочитанные входящие из счётчика (tweb onUpdateDeleteMessages). Оба
    // пути удаления (кадр и своя ручка) проходят через эвикцию, поэтому
    // вычитание одно и повториться не может. `dialogs` объявлен ниже —
    // стрелка ленивая.
    onMessagesDeleted: (peerId, deleted, missing, mids) => {
      dialogs.applyDeletedMessages(peerId, deleted, missing)
      queuePinnedDeleted(peerId, mids, deleted.filter((m) => m.pFlags.pinned).map((m) => m.id))
      // ветка темы того же обработчика (tweb :11493-11592); `forumTopics`
      // объявлен ниже — стрелка дёргает его лениво
      forumTopics.applyDeletedMessages(peerId, deleted)
    },
    // `readMessages`/`readMentions` (tweb appMessagesManager.ts:9519-9650) читают
    // бейджи «@»/❤ у `getAnyDialog(peerId, threadId)` — темы форума или строки
    // диалога, обнуляют их ответом и двигают курсор журнала местным `updatePts`.
    // Все стрелки ленивые: `dialogs`, `forumTopics`, `funnel`, `conn` объявлены ниже.
    getUnreadBadge: (peerId, threadId) =>
      threadId ? forumTopics.getUnreadBadge(peerId, threadId) : dialogs.getUnreadBadge(peerId),
    clearUnreadBadge: (peerId, threadId, isReaction) => {
      if (threadId) forumTopics.clearUnread(peerId, threadId, isReaction)
      else dialogs.clearUnread(peerId, isReaction)
    },
    applyLocalPts: (pts, count) => { funnel.applyLocalPts(pts, count) },
    markMediaRead: (peerId, serverIds) => { conn.markMediaRead(peerId, serverIds) },
    // Местный `updateReadMessagesContents` (tweb `processLocalUpdate`) идёт тем же
    // путём, что серверный кадр: SSOT, счётчики, вкладки.
    applyLocalMediaRead: (frame) => { dispatch('updateReadPeerMessagesContents', frame) },
  })
  // Временный («неотправленный») бабл заводит владелец окна — messages (порт tweb
  // beforeMessageSending), наружу это обычные операции над окном (публикует их
  // сам менеджер). Обёртка нужна путям отправки, которые идут МИМО
  // messages.sendText/sendFile и потому не могут позвать её сами: пост канала
  // (уходит по REST) и секретный чат (по WS уходит шифртекст, а не текст бабла).
  const beforeSending = (p: PendingNewEvt) => { messages.beforeMessageSending(p) }
  // broadcast объявлен ниже — замыкание дергает его лениво (к моменту первого
  // аплоада порты уже подняты)
  const media = newMediaManager({
    rest,
    onUploadProgress: (id, loaded, total) => broadcast('media:upload_progress', { id, loaded, total }),
    // Stage 1C.2 (Task 3): медиа-токен — воркер единственный владелец. Менеджер
    // зовёт onToken из единственной точки, где токен появляется (ленивый первый
    // запрос) и обновляется (свой таймер за минуту до истечения), — веер тот же,
    // что у rt:me. Витрина (core/mediaUrl.ts) своего расписания не держит.
    onToken: (t) => broadcast(RT.mediaToken, t),
    // Task 6: сминченный воркером objectURL — веер тот же, что у rt:media_token.
    // Витрина (core/mediaCache.ts) зеркалит через storeProjection; проводка
    // пином — core/workerCore.mediaUrl.test.ts.
    onMediaUrl: (e) => broadcast(RT.mediaUrl, e),
    fileDownload,
    fileUpload,
  })
  const push = newPushManager({ rest })
  // Местный апдейт после своего PUT (tweb `generateLocalNotifySettingsUpdate`) —
  // событие `notify_settings` вкладкам; `broadcast` объявлен ниже, зовётся позже.
  const notifyFrames: Partial<Record<NotifyTypeKey, number>> = {}
  const notify = newNotifyManager({
    rest,
    onLocalUpdate: (u) => broadcast('notify_settings', u),
    frameVersion: (key) => notifyFrames[key] ?? 0,
  })
  const folders = newFoldersManager({ rest })
  // Зеркало ключа State во все вкладки (порт tweb apiManagerProxy.processMirrorTaskMap.
  // state) — общая функция для persistManager.stateKey (сторонние ключи) И
  // dialogsManager.applyPinned (свой прямой writer pinnedOrders, Task 4): один
  // канал зеркалирования, не два независимых бродкаста. broadcast объявлен ниже —
  // дёргается лениво, тот же приём, что и остальные стрелки на этой странице.
  const mirrorStateKey = (key: string, value: unknown) => broadcast('state:mirror', { key, value })
  // State воркера С ДИСКА под версионным гейтом — порт `appStateManager.getState()`.
  // Гейт тот же, что у main (core/state/loadState.ts — при несовпадении
  // STATE_VERSION он отдаёт чистые дефолты, а не склеивает половинки схемы
  // прошлой сборки). Через `loadStateOnce()` не идём сознательно: он
  // мемоизирует промис на модуль, а воркер перечитывает State заново после
  // `resetForLogout()` (смена аккаунта) — мемо отдало бы State прошлого.
  const getState = async () => {
    const st = await loadStateAll()
    return st.version === STATE_VERSION ? st : initialState()
  }
  // Task 1 (перенос владения списком диалогов в воркер): список диалогов —
  // воркер единственный владелец (dialogsManager). Веер тот же приём, что у
  // peers ниже: менеджер объявляет операцию (rt:dialog_op), витрина (Task 2)
  // переигрывает её как зеркало. loadCache/loadState — офлайн-кэш и ключи State,
  // от которых зависит порядок (см. докблок dialogsManager.ts). Определён ДО
  // groups/chatThemes (Task 4) — им нужна ссылка на него в конструкторе.
  const dialogs = newDialogsManager({
    rest,
    // Горизонт треда — у `threadReads` (объявлен ниже, стрелка ленивая).
    getThreadReadState: (peerId, threadId) => threadReads.getReadState(peerId, threadId),
    // Состояние канала из строки списка (tweb addChannelState, dialogs.ts:1756):
    // воронка объявлена ниже, строки списка приходят позже сборки — к первому
    // вызову она уже есть.
    addChannelState: (peerId, pts) => { channelFunnel.addChannelState(peerId, pts) },
    onDialogOps: (ops) => broadcast(RT.dialogOp, { ops }),
    onReadOutbox: (peerId, maxId) => broadcast(RT.readOutbox, { peerId, maxId }),
    // tweb `appDraftsManager.addMissedDialogs` — черновики чатов и тредов
    // (`messages.getAllDrafts`); `drafts` объявлен ниже — стрелка ленивая.
    addMissedDialogs: () => { void drafts.addMissedDialogs().catch(() => {}) },
    loadCache: () => loadDialogs(),
    loadState: async () => {
      // Fix (финальное ревью, Minor #2): версионный гейт (`getState` выше). Без
      // него после ближайшего бампа версии main жил бы на дефолтах, а владелец
      // сортировал бы по СТАРОМУ pinnedOrders/folders — два разных ответа на один
      // вопрос.
      const gated = await getState()
      // Этап 2 (пагинация): `folders` — определения папок для фильтра
      // `getDialogs({filterId})`. Читаются С ДИСКА, а не ждут `setStateKey`:
      // на холодном старте State никто не ПИШЕТ (boot.ts поднимает его
      // `setAppStateSilent`), значит канал зеркала ключа в этом кадре молчит.
      return { pinnedOrders: gated.pinnedOrders ?? {}, folders: gated.folders ?? [], allDialogsLoaded: gated.allDialogsLoaded ?? {} }
    },
    // Task 3 (realtime-кадры применяет владелец): applyNewMessage не бампит
    // бейдж на своё же эхо — тот же приём, что у messages выше (getMeId, а не
    // значение: `me` разрешается лениво асинхронным /me).
    getMeId: () => me?.user.id ?? null,
    // Task 4 (действия без оптимистики): applyPinned пишет pinnedOrders на диск и
    // рассылает зеркало ключа — тот же путь, что persistManager.stateKey ниже
    // (saveStateKey + mirrorStateKey), второй писатель того же ключа не заводим.
    savePinnedOrders: (value) => saveStateKey('pinnedOrders', value),
    mirrorStateKey,
    // Признак «выборка загружена целиком» — тот же State-канал (tweb
    // `saveAllDialogsLoaded` → `pushToState`, dialogs.ts:342-344).
    saveDialogsLoaded: (value) => { mirrorStateKey('allDialogsLoaded', value); return saveStateKey('allDialogsLoaded', value) },
    // Task 5 (персист переезжает к владельцу): физический writer офлайн-кэша
    // списка — та же `saveDialogs` (core/store/persist.ts), что раньше звал
    // persistManager.dialogs(...) по снапшоту с main. Дебаунс — внутри
    // dialogsManager (scheduleSave), не здесь.
    saveCache: (list) => saveDialogs(list),
    // Шаг C диалогов: `/chats` стал КОНТЕЙНЕРОМ, и его векторы втекают в уже
    // существующих владельцев — карточки в `peers`, сообщения в `messages`.
    // Своих копий владелец диалогов не заводит: последнее сообщение он
    // РАЗРЕШАЕТ по `top_message` из чужого хранилища (решение Р11), а превью
    // секретного расшифровывает тот же `messages` тем же кодом, что и историю.
    // `peers` объявлен НИЖЕ — та же ленивая forward-ссылка, что у `messages`
    // выше: первый вызов случается уже после сборки всех менеджеров.
    peers: {
      saveApiPeers: (o) => peers.saveApiPeers(o),
      cachedPeer: (id) => peers.cachedPeer(id),
      hydrateFromDisk: () => peers.hydrateFromDisk(),
    },
    messages: {
      saveApiMessages: (list) => messages.saveApiMessages(list),
      getMessageByPeer: (peerId, seq) => messages.getMessageByPeer(peerId, seq),
      getHistoryFirstSlice: (peerId) => messages.getHistoryFirstSlice(peerId),
      // Прочтение истории снимает «@» по окну сообщений (tweb
      // onUpdateReadHistory): владелец строки спрашивает окно до сдвига
      // горизонта — горизонт живёт у него же.
      countReadMentions: (peerId, maxId, readMaxId) => messages.countReadMentions(peerId, maxId, readMaxId),
    },
  })
  // Stage 1C.2 (Task 2): карточки пиров — воркер единственный владелец. Веер тот
  // же, что у setMe/onLoggingOut выше: менеджер объявляет операцию, вкладки её
  // переигрывают (`core/peerCache.ts` — зеркало). broadcast объявлен ниже — стрелка
  // дёргает его лениво (к первому /users порты уже подняты), как у media/messages.
  //
  // Объявлен ДО `groups`: карточка чата (`groups.card`) — единственный источник
  // конструктора `channel` на клиенте, и она отдаёт его владельцу пиров
  // (`saveApiPeers`) прежде, чем ответить вызывающему.
  // Статус из карточки — тем же кадром `updateUserStatus`, каким присутствие
  // приходит с сервера (порт `saveUserStatus`, докблок `newPeersManager`).
  const peers = newPeersManager({
    rest,
    onPeerOps: (ops) => broadcast(RT.peerOp, { ops }),
    onUserStatus: (evt) => broadcast(RT.presence, evt),
    // Своё обновление карточки с другого устройства (эмодзи-статус, Premium):
    // `me` обновляется и без записи в кэше пиров. Сверка по id — запоздавший кадр
    // прежнего аккаунта не подменяет карточку нынешнего. Равная карточка (кадр
    // сервера, продублировавший то, что `me` уже знает) rt:me не будит; кадр
    // собственной мутации часто обгоняет HTTP-ответ, тогда второй rt:me от
    // `onMeChanged` неизбежен и безвреден — вкладки сравнивают значения.
    onSelfUser: (u) => {
      if (!me || u.id !== me.user.id || deepEqual(me.user, u)) return
      setMe({ ...me, user: u })
    },
    // tweb `chat_toggle_forum` (appChatsManager.ts:304-306): карточка чата
    // сменила `pFlags.forum` — хранилище тем сбрасывает кэш (dialogs.ts:186-192),
    // выключенный форум — и окна тредов (appMessagesManager.ts:921-932).
    // `forumTopics`/`messages` объявлены ниже — стрелка дёргает их лениво.
    onChatToggleForum: (peerId, enabled) => {
      forumTopics.onChatToggleForum(peerId, enabled)
      if (!enabled) messages.flushThreadWindows(peerId)
    },
    // tweb `onContactUpdated` из `saveApiUser` (appUsersManager.ts:738-754): карточка
    // сменила `pFlags.contact` — книга двигает индекс и шлёт `contacts_update`.
    // `contacts` объявлен ниже — стрелка дёргает его лениво.
    onContactToggle: (userId, isContact, wasContact) => contacts.onContactUpdated(userId, isContact, wasContact),
  })
  // Task 4 (действия без оптимистики): mute/pin/archive идут сеть-сначала (порт
  // tweb toggleDialogPin/updateNotifySettings) — локальный апдейт зовёт владелец
  // ПОСЛЕ успешного REST-ответа, см. groupsManager.ts::setMute/setPin/setArchive.
  const groups = newGroupsManager({
    rest,
    dialogs,
    peers,
    // Мьют темы после ответа сети — хранилище тем (объявлено ниже, стрелка ленивая).
    forumTopics: { applyNotifySettings: (peerId, topicId, settings) => forumTopics.applyNotifySettings(peerId, topicId, settings) },
    getMeId: () => me?.user.id ?? null,
    // Местный апдейт участника после своей мутации (tweb `processLocalUpdate`)
    // уезжает вкладкам тем же событием, что и кадр сервера (`dispatch` ниже).
    onChannelParticipant: (update) => broadcast(RT.chatParticipant, update),
  })
  // Темы форумов — порт `dialogsStorage.forumTopics` (Б-54): владелец тем в
  // воркере, вкладкам объявляет операции (rt:forum_topic_op). Последнее
  // сообщение темы разрешается по `top_message` из хранилища сообщений, как у
  // диалогов; упоминания, прочитанные в треде темы, гасит владелец строки
  // форума (`dialogs.applyMentionsRead`, tweb appMessagesManager.ts:10969-10980).
  const forumTopics = newForumTopicsStorage({
    rest,
    peers,
    messages: {
      saveApiMessages: (list) => messages.saveApiMessages(list),
      getMessageByPeer: (peerId, id) => messages.getMessageByPeer(peerId, id),
    },
    getMeId: () => me?.user.id ?? null,
    onOps: (ops) => broadcast(RT.forumTopicOp, { ops }),
    // черновик темы из ответа списка — словарь черновиков (tweb dialogs.ts:1692-1697)
    saveTopicDraft: (peerId, topicId, draft) => drafts.saveTopicDraft(peerId, topicId, draft),
    onParentMentionsRead: (peerId, count) => dialogs.applyMentionsRead(peerId, count),
  })
  // Прочтение тредов (тема форума, тред комментариев) — tweb `readHistory` с
  // `threadId` (:9107-9270) → `messages.readDiscussion`, кадры
  // `updateReadChannelDiscussionInbox/Outbox` (:777-778).
  const threadReads = newThreadReads({
    rest,
    isForumPeer: (peerId) => isForum(peers.cachedPeer(peerId) as Chat | undefined),
    forumTopics,
    getMeId: () => me?.user.id ?? null,
    onCommentThreadRead: (peerId, threadId, maxId, out) => dialogs.applyThreadRead(peerId, threadId, maxId, out),
    onReadOutbox: (peerId, threadId, maxId) => broadcast(RT.readOutbox, { peerId, threadId, maxId }),
    // Пост треда комментариев перечитывается (tweb :10831-10836).
    onThreadRead: (peerId, threadId) => messages.onThreadRead(peerId, threadId),
  })
  // cacheViews — владелец счётчика просмотров: ответ на регистрацию просмотра
  // несёт уже новые значения, и применяет их та же точка, что и кадр
  // `views_update` (реестр CACHE выше). Стрелкой, а не ссылкой: `messages`
  // собран выше, но зависимость объявляется здесь, у вызывателя.
  const channels = newChannelsManager({
    rest, beforeSending, peers, cacheViews: (peerId, views) => { messages.cacheViews(peerId, views) },
    // Отказ ручки поста — бабл упавшим; ответ отложенного поста — в ленту отложенных.
    failSending: (clientMsgId) => { void messages.failPending({ clientMsgId }) },
    applyScheduledUpdates: (r) => { messages.applyScheduledUpdates(r) },
  })
  const presence = newPresenceManager({ rest })
  const stories = newStoriesManager({ rest })
  // Книга контактов и «недавние» глобального поиска (половина tweb
  // `appUsersManager`). Карточки книги втекают в `peers`; State — тем же
  // writer'ом, что `persistManager.stateKey` (диск + зеркало во вкладки);
  // `persist` объявлен ниже — стрелка дёргает его лениво.
  const contacts = newContactsManager({
    rest,
    peers,
    getMe: () => me?.user ?? null,
    state: { getState, pushToState: (key, value) => persist.stateKey(key, value) },
    onContactsUpdate: (userId) => broadcast('contacts_update', userId),
  })
  // Местный апдейт после своего ответа (tweb `apiUpdatesManager.processLocalUpdate`,
  // `toggleBlock` :520-536, `setPrivacy` :30-56) идёт тем же `dispatch`, что живой
  // кадр: `peer_block` и `privacy_update` вкладкам рассылает он. `dispatch` ниже —
  // стрелка дёргает его лениво. Счётчик кадров по предмету — защита от затирания
  // свежего кадра местным апдейтом, собранным из опоздавшего ответа.
  // Считаются только кадры сервера: местный апдейт первого запроса не должен
  // гасить защиту второго запроса того же предмета.
  const privacyFrames: Record<string, number> = {}
  let localPrivacyUpdate = false
  const privacy = newPrivacyManager({
    rest,
    peers,
    processLocalUpdate: (u) => {
      localPrivacyUpdate = true
      try { dispatch(u._, u) } finally { localPrivacyUpdate = false }
    },
    frameVersion: (key) => privacyFrames[key] ?? 0,
  })
  // Черновики — порт `appDraftsManager`: черновик чата — поле диалога
  // (`dialogs.applyDraft`), черновик треда — словарь менеджера и строка темы
  // (`forumTopics.applyDraft`); вкладкам — `draft_updated` (tweb rootScope.ts:162).
  const drafts = newDraftsManager({
    rest,
    applyDialogDraft: (peerId, draft) => dialogs.applyDraft(peerId, draft),
    applyTopicDraft: (peerId, topicId, draft) => forumTopics.applyDraft(peerId, topicId, draft),
    onDraftUpdated: (e) => broadcast('draft_updated', e),
  })
  // Тема оформления чата: только REST. Её место в схеме — полная карточка
  // (решение Р7), поэтому применяет её читатель карточки на главном потоке.
  const chatThemes = newChatThemesManager({ rest })
  const sessions = newSessionsManager({ rest })
  const calls = newCallsManager({ rest, getMeId: () => me?.user.id ?? null, peers })
  const livestream = newLivestreamManager({ rest })
  const stars = newStarsManager({ rest })
  // getMeId — по той же причине, что у messages выше: созданный розыгрыш вкладка
  // кладёт прямо в окно, минуя SSOT воркера, поэтому `out` на нём ставит владелец.
  const boosts = newBoostsManager({ rest, getMeId: () => me?.user.id ?? null })
  const report = newReportManager({ rest })
  const stats = newStatsManager({ rest })
  const bots = newBotsManager({ rest })
  // События стикеров/GIF вкладкам (rootScope): `broadcast` объявлен ниже, зовётся позже.
  const stickers = newStickersManager({ rest, dispatch: (event, payload) => broadcast(event, payload) })
  const reactions = newReactionsManager({ rest })
  const iv = newIVManager({ rest })
  // tweb `appWebPagesManager.getWebPage` — карточка плашки превью над полем ввода
  const webPages = newWebPagesManager({ rest })
  // tweb `appDocsManager.getDoc` — документ по id из хранилища, которое
  // наполняет `saveDocument` (`core/media/messageMedia.ts`). Читатель —
  // предпросмотр стикера (`components/stickerViewer.ts`): у ячейки есть только
  // `data-doc-id`.
  const docs = { getDoc }
  const health = newHealthManager(rest)
  // Языковой пакет: владелец кэша, версии и разницы — воркер (обоснование места
  // и выбора хранилища — в докблоке менеджера). Хранилище — тот же KV IndexedDB,
  // что у токена и курсора; аккаунтный persist не годится, пакет нужен до входа.
  const langPack = newLangPackManager({ rest, kv: { get: idbGet, set: idbSet } })
  // Единый writer офлайн-стора: диалоги/me/папки/черновики теперь пишет воркер (не
  // каждая вкладка со своего main-соединения). Без rest — чистый IndexedDB.
  // broadcast объявлен ниже — стрелка дергает его лениво (к моменту первой записи
  // State порты уже подключены). Зеркало ключа уходит ВО ВСЕ вкладки: порт tweb
  // appStateManager.setKeyValueToStorage → invokeVoid('mirror', …), которая без
  // указания порта рассылается по всем sendPorts (superMessagePort.ts:379).
  const persist = newPersistManager(
    mirrorStateKey,
    // Task 1: порядок диалогов зависит от State-ключа pinnedOrders —
    // dialogsManager узнаёт об изменении и публикует reindex (см. setStateKey).
    (key, value) => dialogs.setStateKey(key, value),
    // S10: скоуп офлайн-стора по токену — здесь, у владельца токена; вкладка
    // токен не читает (под код-паролем он зашифрован), см. scopeToSession.
    tokens,
  )

  // every connected tab's port — events broadcast to all
  const ports: SuperMessagePort[] = []
  // Воркерный инстанс RootScope (Stage 1C.1) вместо голой функции broadcast — та же
  // шина, что и на главном потоке (src/lib/rootScope.ts), со своим портом-веером по
  // всем подключённым вкладкам. Проводка (создание RootScope, веер, приём кадра от
  // вкладки) вынесена в realtime/workerScope.ts — по той же причине, по которой туда
  // же вынесен globalFunnel: явные зависимости вместо захвата модульного состояния,
  // логика тестируется напрямую (workerCore.test.ts зовёт этот же bind() через
  // фейковые эндпоинты). workerScope создаётся ЗДЕСЬ, там же, где раньше был
  // broadcast: менеджеры выше получают его лениво через стрелки (см. комментарии на
  // строках 81,86,97,121) — порядок инициализации сохранён, стрелки теперь дёргают
  // workerScope.broadcast через тонкую обёртку broadcast ниже.
  const workerScope = newWorkerScope({ ports })
  // Код-пароль (порт хендлеров tweb index.worker.ts:246-333): свой канал на
  // каждом порту — хендлеру нужен источник вызова, см. core/passcode/passcodeWorker.ts.
  const selfTerminate = () => { (self as unknown as { close(): void }).close() }
  const passcode = newPasscodeWorker({
    ports,
    clearPersist: persistClearAll,
    selfTerminate,
  })
  // Реестр вкладок и автоблокировка (tweb index.worker.ts:381-404): все вкладки
  // простаивают дольше `autoLockTimeoutMins` — вкладкам перезагрузка, воркер
  // завершается вместе с ключом, и вкладки поднимаются на экране блокировки.
  // Самозавершение воркера без вкладок под кодом (`:401-403`) не портировано:
  // перезагружаемая вкладка подключается раньше, чем уходит старая, и до своего
  // `tabState` выглядит «без состояния» — воркер закрылся бы у неё под ногами (Б-17).
  const appTabsManager = new AppTabsManager<SuperMessagePort>()
  const autoLockControls = useAutoLock<SuperMessagePort>({
    getSettings: async() => passcode.getAutoLockSettings(),
    getIsLocked: () => passcode.getIsLocked(),
    onLock: () => {
      if (typeof BroadcastChannel !== 'undefined') {
        const channel = new BroadcastChannel(RELOAD_CHANNEL)
        channel.postMessage('reload')
        channel.close()
      }
      selfTerminate()
    },
  })
  appTabsManager.onTabStateChange = () => {
    const tabs = appTabsManager.getTabs()
    const areAllIdle = tabs.every((tab) => !!tab.state.idleStartTime)

    autoLockControls.setAreAllIdle(areAllIdle)
  }
  const broadcast = (event: string, payload: unknown, meta?: EventMeta) => workerScope.broadcast(event, payload, meta)

  // ── Wave 3 funnel ────────────────────────────────────────────────────────────
  // Точка применения: реестр APPLY + dispatch (логируемые апдейты: SSOT + broadcast).
  // Арифметика pts (дубль/следующий/дыра, буфер, таймер) — в realtime/globalFunnel.ts.
  // Эфемерные кадры (typing/presence/calls/…) сюда НЕ заходят — их onFrame транслирует как есть.
  const cursor = newCursor({ get: idbGet, set: idbSet })
  let cursorReady = false
  // Первое подключение после старта воркера уже было (tweb `attached`).
  let attached = false

  // Отражение кадра в SSOT воркера — ДО broadcast: иначе переоткрытие чата из
  // кэша теряет апдейт. Ключ — КОНСТРУКТОР; имя события, которым кадр уезжает
  // на вкладки, живёт рядом со списком конструкторов (UPDATE_RT в
  // realtime/updateCatalog.ts), потому что менеджеров оно не знает и его же
  // читает пин полноты.
  //
  // Реестр НЕПОЛНЫЙ намеренно (Partial): отражать в SSOT нужно не каждому
  // кадру, и «здесь пусто» — это ответ, а не пропуск. Полноту держит UPDATE_RT.
  //
  // cache может вернуть MessageOp[] (Stage 1B.3, Task 3: media_read/
  // web_page_update/factcheck_update/paid_media_unlock/delete_message; Task 4:
  // poll_update/checklist_update/giveaway_update — по образцу cacheLive, см.
  // dispatch ниже) — тогда dispatch рассылает их ОТДЕЛЬНЫМ кадром
  // RT.messageOp, как routeNewMessage. updateEditMessage оставлен на прежнем
  // пути (сырой кадр) — см. комментарий у messages.cacheEdit; реакции тоже НЕ
  // переведены (Task 5), см. newReactionMethods в messages/reactionMethods.ts.
  //
  // Сообщение (updateNewMessage/updateNewChannelMessage) сюда не попадает —
  // у него спец-путь routeNewMessage (E2E-расшифровка + cacheLive).
  const CACHE: Partial<Record<keyof typeof UPDATE_RT, (p: never) => MessageOp[] | void>> = {
    updateReadPeerMessagesContents: (p) => messages.cacheMediaRead(p),
    updateEditMessage:              (p) => messages.cacheEdit(p),
    updateDeletePeerMessages:       (p) => messages.cacheDelete(p),
    updatePinnedMessages:           (p) => messages.cachePinned(p),
    updateMessageReactions:         (p) => messages.cacheReaction(p),
    // Счётчик просмотров поста канала живёт ВНУТРИ сообщения, поэтому владелец
    // у него тот же, что у всего окна, — messages; кадр лишь называет пост и
    // новое значение. Тред поста (`replies`) своего кадра не имеет — пост
    // перечитывается (`messages.updateMessage`, tweb :11923-11937). Номер поста приезжает в СЕРВЕРНОМ пространстве (как во
    // всех кадрах), ключ канала — числом `channel_id`: перевод обоих и есть
    // граница разбора (`core/history/messageId.ts`, `core/peers/peerId.ts`).
    updateChannelMessageViews:      (p: ViewsUpdateEvt) =>
      messages.cacheViews(toPeerId(p.channel_id, true), new Map([[generateMessageId(p.id), p.views]])),
    updateMessageFactCheck:         (p) => messages.cacheFactCheck(p),
    updateMessagePoll:              (p) => messages.cachePoll(p),
    updateMessageToDo:              (p) => messages.cacheChecklist(p),
    updateMessageGiveaway:          (p) => messages.cacheGiveaway(p),
    updateMessageWebPage:           (p) => messages.cacheWebPage(p),
    updateMessageExtendedMedia:     (p) => messages.cachePaidUnlock(p),
    // Юзер сменил профиль: кадр интерпретирует владелец карточек (peersManager) —
    // он правит свой кэш и публикует изменение операцией (rt:peer_op). Витрина
    // сырой rt:user_update не разбирает; кадр рассылается дальше как есть, чтобы
    // не заводить исключение в общей проводке (потребителей у него на витрине
    // сейчас нет).
    updateUserSnapshot:             (p) => peers.applyUserUpdate((p as UserUpdateEvt).user),
  }

  // Отражение апдейта в SSOT + broadcast (без арифметики pts — её делает
  // applyUpdate). `key` — КОНСТРУКТОР кадра (у единственного непортированного
  // предмета, folder_update, — тип конверта: см. frameKey), `d` — тело.
  // Сообщение (updateNewMessage/updateNewChannelMessage) идёт спец-путём
  // routeNewMessage: E2E-расшифровка + cacheLive.
  // Stage 1B.3 (Task 3): если cache() вернул операции — рассылаем их ДО сырого кадра
  // (тот же порядок, что у routeNewMessage): проектор берёт окно операцией, сырой
  // кадр остаётся параллельно для того, что операциями не покрыто (переключение
  // обратимо одной строкой, как и было в 1B.2).
  function dispatch(key: string, d: unknown, meta?: EventMeta): void {
    // Непортированный предмет: конструктора нет, кадр опознан типом конверта
    // (#51). Ветка исчезнет вместе с задачей — вместе с ней и это исключение.
    if (key === LOGGED_WITHOUT_CONSTRUCTOR) { broadcast(RT.folderUpdate, d, meta); return }
    const pred = updatePredicate(d)
    if (!pred || pred !== key) return
    // Канальный близнец правки/удаления/закрепа (журнал broadcast-канала):
    // курсор его уже применила канальная воронка, дальше — путь пары
    // (tweb разбирает обе одним обработчиком).
    const twin = channelTwin(d as Update)
    if (twin) { dispatch(twin._, twin, meta); return }
    if (pred === 'updateNewMessage' || pred === 'updateNewChannelMessage') {
      routeNewMessage(d as NewMessageEvt, meta); return
    }
    // Блок и правило приватности (журнал `peer_blocked` / `privacy_update`, а
    // также местный апдейт после своего ответа): события tweb `peer_block`
    // (`appProfileManager.ts:1506-1533` — тело из `pFlags`) и `privacy_update`
    // (`appPrivacyManager.ts:12-19` — тело само апдейт). Сырой кадр дальше не идёт.
    if (pred === 'updatePeerBlocked') {
      const e = d as PeerBlockedEvt
      if (!localPrivacyUpdate) privacyFrames[privacyFrameKey(e)] = (privacyFrames[privacyFrameKey(e)] ?? 0) + 1
      const evt: PeerBlockEvt = { peerId: getPeerId(e.peer_id), blocked: e.pFlags?.blocked ? true : undefined }
      broadcast('peer_block', evt, meta)
      return
    }
    if (pred === 'updatePrivacy') {
      const e = d as PrivacyEvt
      if (!localPrivacyUpdate) privacyFrames[privacyFrameKey(e)] = (privacyFrames[privacyFrameKey(e)] ?? 0) + 1
      broadcast('privacy_update', e, meta)
      return
    }
    // Команды бота (журнал `bot_commands`): tweb `onUpdateBotCommands`
    // (`appProfileManager.ts:1560-1569`) берёт ключ пира из `update.peer`, бота —
    // из `update.bot_id`. Карточка пира живёт на главном потоке — вкладка кладёт
    // команды в закэшированную (`chatFullCache.applyBotCommands`), не перечитывая её.
    if (pred === 'updateBotCommands') {
      const e = d as BotCommandsEvt
      broadcast('bot_commands', { peerId: getPeerId(e.peer), botId: e.bot_id, commands: e.commands }, meta)
      return
    }
    // Лента отложенных (tweb `onUpdateNewScheduledMessage`/
    // `onUpdateDeleteScheduledMessages`, appMessagesManager.ts:11773-11815):
    // кадр применяет владелец хранилища отложенных и сам объявляет вкладкам
    // события оригинала — сырой кадр дальше не идёт.
    if (pred === 'updateNewScheduledMessage') { messages.applyNewScheduledMessage(d as NewScheduledMessageEvt); return }
    if (pred === 'updateDeleteScheduledMessages') { messages.applyDeleteScheduledMessages(d as DeleteScheduledMessagesEvt); return }
    // Вопрос «сменилась ли непрочитанность реакций на МОЁМ сообщении» задаётся
    // ДО того, как кадр ляжет в SSOT: после применения агрегата сравнивать было
    // бы не с чем — окно уже содержало бы новое состояние (tweb
    // onUpdateMessageReactions берёт `previousReactions` до `modifyMessage`).
    const unreadReactions = pred === 'updateMessageReactions'
      ? messages.unreadReactionsChange(d as ReactionEvt) : undefined
    // Тот же порядок для бейджа «@»: было ли упоминание непрочитанным, решает
    // окно ДО снятия media_unread (tweb onUpdateReadMessagesContents).
    const mediaRead = pred === 'updateReadPeerMessagesContents'
      ? messages.mediaReadEffects(d as MediaReadEvt) : undefined
    const ops = CACHE[pred]?.(d as never)
    if (ops && ops.length) broadcast(RT.messageOp, { ops }, meta)
    // Task 3 (владение диалогами, «realtime-кадры применяет владелец»): кадры,
    // влияющие на список диалогов, применяет dialogsManager — публикует свой
    // rt:dialog_op сам (через onDialogOps), отдельно от сырого кадра ниже
    // (тот доезжает витрине как и раньше, если у него остались другие потребители).
    if (pred === 'updateReadHistoryInbox' || pred === 'updateReadHistoryOutbox') dialogs.applyRead(d as ReadEvt)
    else if (pred === 'updateReadPeerMessagesContents' && mediaRead) {
      // Цикл по номерам tweb `onUpdateReadMessagesContents` (:11009-11079): «@»
      // минус по каждому непрочитанному упоминанию из памяти — у его темы (если
      // она есть) и у строки форума; сообщение с непрочитанной реакцией
      // отдаёт местный кадр реакции (:11053-11070); номер вне памяти — перечитать
      // строку (и темы форума: тему кадр без `top_msg_id` назвать не может).
      const peerId = getPeerId((d as MediaReadEvt).peer)
      for (const threadId of mediaRead.mentionThreads) {
        if (threadId !== undefined) forumTopics.modifyUnreadMentions(peerId, threadId, false)
      }
      if (mediaRead.mentionThreads.length) dialogs.applyMentionsRead(peerId, mediaRead.mentionThreads.length)
      for (const frame of mediaRead.readReactions) dispatch('updateMessageReactions', frame)
      if (mediaRead.missing) {
        dialogs.fixUnreadIfNoMessage(peerId)
        const badge = dialogs.getUnreadBadge(peerId)
        if (badge && (badge.mentions || badge.reactions)) forumTopics.reload(peerId)
      }
    }
    else if (pred === 'updateChatFullSnapshot' || pred === 'updateChannelFullSnapshot') {
      // Порт `apiUpdatesManager.processUpdateMessage` (`:239-240`): пиры,
      // приехавшие ВМЕСТЕ с апдейтом, сохраняются ПЕРВЫМИ — до того, как
      // апдейт применят. Кадр `chat_update` несёт `messages.chatFull`, то есть
      // абсолютный снимок карточки; строке диалога из него нужны четыре поля,
      // а весь остальной чат (права, `pFlags`, `default_banned_rights`) живёт
      // в зеркале пиров и попадает туда только отсюда.
      // Строке диалога из этого снимка больше НЕ НУЖНО ничего: имя, username,
      // аватарка и `forum` живут в самой карточке чата (решение Р1 — они едут
      // векторами `chats`/`users`), а не дублируются полями диалога. Прежний
      // `dialogs.applyChatMeta` перекладывал четыре поля из карточки в строку —
      // ровно то второе зеркало одного факта, которого этот шаг и лишает.
      peers.saveApiPeers((d as ChatUpdateEvt).chat_full)
    }
    // Стикеры и GIF своих устройств (журнал f6-stickers): владелец —
    // `stickersManager`; вкладкам уезжают события rootScope, а не rt-имя каталога
    // (tweb appStickersManager.ts:80-88, appGifsManager.ts:21-29).
    else if (pred === 'updateNewStickerSet') {
      stickers.onNewStickerSet(d as NewStickerSetEvt)
      return
    }
    else if (pred === 'updateRecentStickers' || pred === 'updateFavedStickers') {
      void stickers.onStickersUpdated(pred === 'updateRecentStickers' ? 'recent' : 'faved')
        .catch((e) => console.warn(`[stickers] ${pred}: refresh failed`, e))
      return
    }
    else if (pred === 'updateSavedGifs') {
      void stickers.onGifsUpdated().catch((e) => console.warn('[stickers] updateSavedGifs: refresh failed', e))
      return
    }
    else if (pred === 'updateChatRemoved') dialogs.applyRemoved(getPeerId((d as ChatRemovedEvt).peer))
    else if (pred === 'updateChannel') dialogs.applyChannel(toPeerId((d as ChannelEvt).channel_id, true))
    // tweb `appChatsManager.onUpdateChannelParticipant` (:1419-1422): кэш страниц
    // участников чата — сбросить ДО рассылки `chat_participant`.
    else if (pred === 'updateChannelParticipant') {
      // Дубль своей мутации, уже применённой местным апдейтом на этом
      // устройстве (groupsManager.isLocalParticipantEcho): у Telegram он сюда
      // не приходит вовсе, вкладки применили бы смену дважды (ревью #409 п. 2).
      if (groups.isLocalParticipantEcho(d as ChannelParticipantEvt)) return
      groups.invalidateChannelParticipants((d as ChannelParticipantEvt).channel_id)
    }
    // tweb `appChatInvitesManager.onUpdatePendingJoinRequests` (:24-40): скрытие
    // плашки заявок снимается, вкладкам уезжает ПЕРЕЛОЖЕННЫЙ `chat_requests`, а
    // не сырой кадр — поэтому общий веер ниже эта ветка обходит.
    else if (pred === 'updatePendingJoinRequests') {
      void onUpdatePendingJoinRequests(d as PendingJoinRequestsEvt, meta)
      return
    }
    // Черновик — tweb `appDraftsManager` (:44-71): черновик чата — поле диалога
    // (его применяет владелец списка: от даты черновика зависит место строки),
    // черновик треда (`top_msg_id`) — словарь менеджера и строка темы.
    else if (pred === 'updateDraftMessage') {
      drafts.applyUpdate(d as DraftUpdateEvt)
    }
    // Task 4 (действия без оптимистики): то же действие, применённое с ДРУГОГО
    // устройства/вкладки, доезжает этим кадром (backend logAndPublish на все
    // устройства владельца/участников) — применяет владелец ровно один раз
    // (patchDialog внутри applyNotifySettings/applyPinned/applyArchived
    // сравнивает через equal() и не публикует no-op). Раньше эти 4 кадра
    // разбирала витрина напрямую (storeProjection.ts, setDialogMuted и т.п.) —
    // тот путь убран вместе с мутаторами chatsStore, второго применения нет.
    // Кадр несёт КОНСТРУКТОР настроек целиком — срок мьюта больше не
    // выбрасывается на границе (это и был последний участок цепочки, из-за
    // которого «заглушить на час» работало как «навсегда»).
    //
    // Ключ пира у каждого кадра лежит в СВОЁЙ обёртке — dialogPeer, notifyPeer,
    // folderPeer, — потому что это разные пространства адресации: у folderPeer
    // рядом с пиром едет номер папки, а «вернуть из архива» это ноль, а не
    // второй кадр.
    else if (pred === 'updateNotifySettings') {
      const e = d as DialogMuteEvt
      // Глобальные настройки ТИПА чатов (журнал `notify_settings`): пира нет, диалог
      // и тема ни при чём — событие `notify_settings` вкладкам, как у tweb
      // `rootScope.dispatchEvent('notify_settings', update)` (:537).
      if (e.peer._ === 'notifyUsers' || e.peer._ === 'notifyChats' || e.peer._ === 'notifyBroadcasts') {
        notifyFrames[e.peer._] = (notifyFrames[e.peer._] ?? 0) + 1
        broadcast('notify_settings', d, meta)
        return
      }
      // Тема форума — свой ключ настроек (`notifyForumTopic`, tweb
      // appMessagesManager.ts:11751-11770): владелец — хранилище тем.
      if (e.peer._ === 'notifyForumTopic') {
        forumTopics.applyNotifySettings(getPeerId(e.peer.peer), generateMessageId(e.peer.top_msg_id), e.notify_settings)
      } else {
        dialogs.applyNotifySettings(getPeerId(e.peer.peer), e.notify_settings)
      }
    } else if (pred === 'updatePinnedForumTopic') {
      // tweb dialogs.ts:2480-2490 — «открепили» это отсутствие бита.
      const e = d as PinnedForumTopicEvt
      forumTopics.applyPinnedTopic(getPeerId(e.peer), generateMessageId(e.topic_id), !!e.pFlags?.pinned)
    } else if (pred === 'updateReadChannelDiscussionInbox' || pred === 'updateReadChannelDiscussionOutbox') {
      // tweb appMessagesManager.ts:777-778 → onUpdateReadHistory (:10795-10990):
      // номера — клиентские (:10800-10801), пир — группа (:10802).
      const e = d as ReadDiscussionEvt
      threadReads.applyReadDiscussion({
        peerId: toPeerId(e.channel_id, true),
        topicId: generateMessageId(e.top_msg_id),
        maxId: generateMessageId(e.read_max_id),
        out: pred === 'updateReadChannelDiscussionOutbox',
      })
    } else if (pred === 'updateDialogPinned') {
      const e = d as DialogPinEvt
      // «Открепили» — ОТСУТСТВИЕ бита, а не `pinned: false`.
      dialogs.applyPinned(getPeerId(e.peer.peer), !!e.pFlags?.pinned)
    } else if (pred === 'updateFolderPeers') {
      for (const fp of (d as DialogArchiveEvt).folder_peers ?? []) {
        dialogs.applyFolder(getPeerId(fp.peer), fp.folder_id)
      }
    }
    else if (pred === 'updateMessageReactions') {
      // Бейдж непрочитанных реакций — порт tweb onUpdateMessageReactions:
      // ответ владельца окна (ВЫШЕ, до применения агрегата) — либо знак ±1,
      // либо «сообщения в памяти нет, перечитай строку».
      const e = d as ReactionEvt
      const peerId = getPeerId(e.peer)
      // `top_msg_id` — тема форума, в которой лежит сообщение (:10556). Он
      // направляет счётчик: с темой меняется бейдж ТЕМЫ, а родитель — только
      // при прочтении и только если там больше нуля (:10603-10620); без темы —
      // строка диалога, как раньше.
      const threadId = e.top_msg_id ? generateMessageId(e.top_msg_id) : undefined
      if (unreadReactions === 'reload') dialogs.reloadConversation(peerId)
      else if (unreadReactions !== undefined) {
        if (threadId === undefined) dialogs.modifyUnreadReactions(peerId, unreadReactions)
        else {
          forumTopics.modifyUnreadReactions(peerId, threadId, unreadReactions)
          if (!unreadReactions) dialogs.modifyUnreadReactions(peerId, false)
        }
      }
    }
    broadcast(UPDATE_RT[pred], d, meta)
  }

  async function onUpdatePendingJoinRequests(update: PendingJoinRequestsEvt, meta?: EventMeta): Promise<void> {
    const peerId = getPeerId(update.peer)
    const state = await getState()
    const hideChatJoinRequests = { ...state.hideChatJoinRequests }
    delete hideChatJoinRequests[peerId]
    // tweb `appStateManager.pushToState` — запись и зеркало ключа вкладкам
    mirrorStateKey('hideChatJoinRequests', hideChatJoinRequests)
    await saveStateKey('hideChatJoinRequests', hideChatJoinRequests).catch(() => {})
    const evt: ChatRequestsEvt = {
      chatId: toChatId(peerId),
      recentRequesters: update.recent_requesters ?? [],
      requestsPending: update.requests_pending,
    }
    broadcast(RT.chatRequests, evt, meta)
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
    // Один разбор кадра на все части обработчика — как tweb `onUpdateNewMessage`
    // (appMessagesManager.ts:10243-10253: `saveMessages` один раз, дальше история,
    // диалог и тема читают тот же объект).
    const m = mapMessage(e.message, me?.user.id ?? null)
    const ops = m._ === 'messageEmpty' ? [] : messages.cacheLive(e as never, m)
    broadcast(RT.messageOp, { ops }, meta)
    // Task 3: превью/unread диалога в списке — тоже владелец (dialogsManager),
    // публикует свой patch независимо от rt:new_message ниже (тот остаётся для
    // read-marker/звука/нотификаций на main — см. storeProjection.ts).
    dialogs.applyNewMessage(e, m)
    // Тема форума: счётчики, последнее сообщение, служебки создания/правки
    // (tweb onUpdateNewMessage, ветка треда :10300-10365, :10495-10520).
    if (m._ !== 'messageEmpty') {
      forumTopics.applyNewMessage(m)
      // `historyStorage._maxId` треда комментариев (:10435-10437)
      threadReads.applyNewMessage(m)
      // тред поста перечитывается (tweb `updateMessageRepliesIfNeeded`, :10397)
      messages.updateMessageRepliesIfNeeded(m)
    }
    // tweb 1dc32d889 — признак «кадр пришёл первым difference после старта»
    // снимается В МОМЕНТ РАССЫЛКИ (у tweb — в `handleNewMessage`): к ответу
    // вкладке по RPC догон уже закончится. Решает по нему подписчик уведомлений.
    broadcast(RT.newMessage, e, syncWait.isInitialSync() ? { ...meta, initialSync: true } : meta)
  }

  // Состояния каналов (tweb `channelStates`): у канала свой плотный pts и
  // своя разница — `updates.getChannelDifference`.
  const channelFunnel = newChannelFunnel({
    dispatch,
    // tweb :736-738: канальный апдейт двигает дату общего состояния.
    advanceDate: (date) => cursor.advance(0, date),
    getChannelDifference: (peerId, pts) =>
      rest.get<ChannelDifference>('/updates/channel_difference', { channel: peerId, pts, limit: 1000 }),
    // Карточки разницы — в кэш пиров ДО её апдейтов (A4-05).
    savePeers: (p) => peers.saveApiPeers(p as Parameters<typeof peers.saveApiPeers>[0]),
    // tweb onUpdateChannelReload (appMessagesManager.ts:11644-11660): строка
    // канала перечитывается целиком.
    onChannelReload: (peerId) => dialogs.reloadConversation(peerId),
  })

  // Апдейт канала из разницы или живой кадр — tweb `processUpdate` с channelId.
  function processChannelUpdate(u: Update): void {
    if (u._ === 'updateChannelTooLong') { channelFunnel.onTooLong(toPeerId(u.channel_id, true)); return }
    const peerId = channelPeerId(u)
    const pts = (u as { pts?: number }).pts
    if (typeof peerId === 'number' && typeof pts === 'number') channelFunnel.processUpdate(peerId, u._, pts, u)
  }

  const sync = newSyncEngine({
    rest, cursor,
    saveUpdate: (key, d, meta) => dispatch(key, d, meta),
    processChannelUpdate,
    // Карточки страницы разницы — в кэш пиров ДО её апдейтов (A4-05).
    onPeers: (p) => peers.saveApiPeers(p as Parameters<typeof peers.saveApiPeers>[0]),
    // tweb onDifferenceTooLong: придержанные кадры оторваны от новой базы,
    // состояния каналов забываются (tweb `channelStates = {}`), витрина
    // перечитывает данные (state_cleared).
    onDifferenceTooLong: () => { funnel.clear(); channelFunnel.reset(); broadcast('rt:resync', null) },
    // Задача 1 (порт ConnectionStatusComponent из tweb): пара rt:state_synchronizing/
    // synchronized — автомат витрины (Задача 3) переключает текст «Обновление…» на
    // время догона. Проводка проверена workerCore.connectionStatus.test.ts.
    onSyncStart: () => broadcast(RT.stateSynchronizing, null),
    onSyncEnd: () => broadcast(RT.stateSynchronized, null),
  })
  // tweb `forceGetDifference` (:185-189): идущий догон не дублируется; новый —
  // сбрасывает придержанные кадры (tweb getDifference чистит pendingPtsUpdates).
  // Отказ глотаем: курсор не сдвинулся, следующий кадр с дырой или реконнект
  // позовут разницу снова, а пару synchronizing/synchronized держит .finally.
  function forceGetDifference(): void {
    if (sync.isSyncing()) return
    funnel.clear()
    void sync.getDifference().catch(() => {})
  }
  // Строки диалогов из хранилища заводят состояния каналов — до первой
  // разницы, иначе её updateChannelTooLong некому применить (tweb грузит
  // state до attach). Упавшее чтение кэша догон не держит.
  const channelStatesReady = (): Promise<void> => dialogs.hydrate().catch(() => {})
  // Единый (пер-юзерный) funnel — арифметика dup/next/gap + буфер придержанных кадров
  // (Wave 3), вынесенная в модуль с явными зависимостями (Task 1). dispatch остаётся
  // здесь (знает про APPLY/routeNewMessage/broadcast), funnel про менеджеры не знает.
  const funnel = newGlobalFunnel({
    dispatch,
    cursor,
    isCursorReady: () => cursorReady,
    isSyncing: () => sync.isSyncing(),
    // Задача #91: отказ разницы глотает forceGetDifference — иначе unhandled
    // rejection на КАЖДОМ живом кадре с pts, пока курсор не гидрирован.
    // До attach догон не просим: первую разницу (или getState) делает он сам,
    // после строк диалогов (tweb processUpdate до attach кадры не применяет).
    catchUp: () => { if (attached) void channelStatesReady().then(() => { if (!sync.isSyncing()) return sync.getDifference() }).catch(() => {}) },
  })
  // tweb 1dc32d889 — ожидание догона для уведомлений (общая разница +
  // разница канала). Вкладка ждёт его по RPC `realtime.waitForSync`.
  const syncWait = newSyncWait({
    global: () => sync.syncState(),
    channel: (peerId) => channelFunnel.syncState(peerId),
  })
  const conn = newConnectionManager({
    ws, getToken: () => tokens.get(),
    // Unacked sends persist in IndexedDB: a reload doesn't lose queued messages —
    // they're restored into the outbox and resent on the next connect.
    outboxStore: {
      // Под код-паролем outbox — в зашифрованном слое (`store/sessionKv.ts`):
      // неотправленный текст сообщения не лежит на диске открытым.
      load: () => sessionKv.get<import('./realtime/connectionManager').SendArgs[]>('outbox'),
      // Отказ IDB глотаем: outbox переживает перезагрузку как удобство, а не как
      // гарантию, — in-memory копия (та же Map) резендом на реконнекте не зависит от диска.
      save: (list) => { void sessionKv.set('outbox', list).catch(() => {}) },
    },
    // Сокет открыт (первое подключение или реконнект). Первое после старта —
    // tweb `attach` (:886-935): без сохранённого состояния — `updates.getState`
    // (догонять не от чего), иначе `getDifference(true)`; оно же точка
    // «начальной синхронизации» (syncWait.attach). Реконнект — новая сессия,
    // tweb `new_session_created` → `forceGetDifference` (:206-209).
    onReady: () => {
      if (attached) { forceGetDifference(); return }
      attached = true
      void Promise.all([cursor.ready(), channelStatesReady()]).then(() => {
        // tweb attach :891 смотрит и pts, и date: у Telegram pts ящика нулём не
        // бывает. У нас бывает (пустой журнал нового пользователя), поэтому
        // «состояния нет» — это отсутствие даты.
        const saved = cursor.get()
        const initial = !saved.date
          ? sync.getState()
          : (funnel.clear(), sync.getDifference())
        syncWait.attach(initial)
        return initial
      }).catch(() => {})
    },
    // retryAt (Задача 1): scheduleReconnect зовёт onState с ВТОРЫМ аргументом только
    // при реконнекте (connectionManager.ts) — здесь он просто прокидывается дальше в
    // payload. Проверено workerCore.connectionStatus.test.ts.
    onState: (s, retryAt) => broadcast(RT.state, { state: s, retryAt }),
    onFrame: (type, payload, envPts, framePeers) => {
      // Порт `apiUpdatesManager.processUpdateMessage` (tweb :259-262): карточки,
      // приехавшие ВМЕСТЕ с кадром (векторы контейнера `updates`), сохраняются
      // ПЕРВЫМИ — до применения апдейта, чтобы первое сообщение нового
      // собеседника, автор-канал или пересылка рисовались с именем (A4-05).
      if (framePeers) peers.saveApiPeers(framePeers as Parameters<typeof peers.saveApiPeers>[0])
      // Развилка воронок — по КОНСТРУКТОРУ. Канальными курсор делает не имя
      // ключа (`channel_pts` больше не существует нигде), а сам кадр:
      // updateNewChannelMessage, updateChannelFullSnapshot,
      // updateChannelBoostStatus едут журналом канала, у которого свой плотный
      // pts и своя разница (updates.getChannelDifference).
      //
      // Ключ канала лежит в РАЗНЫХ местах, и это не небрежность: кадр с
      // сообщением несёт его ВНУТРИ конструктора сообщения (там peer_id —
      // параметр самого сообщения), а кадр метаданных сообщения не несёт вовсе
      // и держит пир своим параметром `peer`.
      const pred = updatePredicate(payload)
      if (pred && CHANNEL_CURSOR.has(pred)) {
        const u = payload as Update
        const peerId = channelPeerId(u)
        const channelPts = (payload as { pts?: number }).pts
        if (typeof peerId === 'number' && typeof channelPts === 'number') {
          channelFunnel.processUpdate(peerId, pred, channelPts, payload)
          return
        }
      }
      // message_ack / message_error: кадры ТРАНСПОРТНЫЕ (решение Р6 — апдейтами
      // они не становятся, конструктора не имеют), но реконсилить по ним нужно
      // ВРЕМЕННЫЙ БАБЛ, а он живёт в SSOT воркера (messages/pending.ts). Владелец
      // применяет их РОВНО ОДИН РАЗ здесь и объявляет результат операциями —
      // раньше это делала каждая вкладка у себя из сырого кадра.
      // return НЕТ сознательно: сырой кадр летит дальше (PASS_THROUGH внизу) — у
      // него остались другие потребители, звук «пак» на ack
      // (client/realtime/soundSubscriber.ts). Причина отказа (`reason`) едет владельцу:
      // по `ALLOW_PAYMENT_REQUIRED_<N>` он заводит запрос на повторную оплату
      // (messages/repayRequestHandler.ts).
      if (type === 'message_ack' || type === 'message_error') {
        const ops = type === 'message_ack'
          ? messages.ackPendingMessage(payload as AckEvt)
          : messages.failPendingMessage((payload as MessageErrorEvt).client_msg_id, (payload as MessageErrorEvt).reason)
        if (ops.length) broadcast(RT.messageOp, { ops })
      }
      // geo_live_update: тот же класс, что и два кадра выше — эфемерный (без
      // pts, `transportFrames.ts:35`, предмет не портирован #52), поэтому в
      // воронку и в реестр CACHE не попадает. Владельца это не отменяет:
      // координаты живут в сообщении, а сообщением владеет messages —
      // применяем РОВНО ОДИН РАЗ здесь и объявляем операцией. Прежде окно правил
      // сырой кадр на витрине (storeProjection → applyGeoLive), то есть мимо
      // операций и мимо зеркала, а `messages.cacheGeoLive` не звался ниоткуда.
      // return НЕТ по той же причине, что и выше: сырой кадр летит дальше.
      if (type === 'geo_live_update') {
        const ops = messages.cacheGeoLive(payload as GeoLiveUpdateEvt)
        if (ops.length) broadcast(RT.messageOp, { ops })
      }
      // Сообщение личного чата: возможна E2E-расшифровка enc_body перед воронкой.
      // Пост канала сюда не доходит — он ушёл в канальную воронку выше, и
      // шифртекста у него не бывает (канал это публичный broadcast).
      if (pred === 'updateNewMessage') {
        const p = payload as NewMessageEvt
        // Кадр несёт сообщение ЦЕЛИКОМ под ключом `message`, поэтому и шифртекст
        // лежит там же — на конструкторе, а не в конверте.
        const m = p.message
        const encBody = m._ === 'message' ? m.enc_body : undefined
        if (m._ === 'message' && encBody) {
          const peerId = getPeerId(m.peer_id)
          // Ключа взять негде (его нет ЛИБО недоступен IDB) — decryptMessage
          // отдаёт null одинаково на обе причины (задача #92), и кадр
          // применяется нерасшифрованным: пустой бабл вместо дыры в pts.
          // `.catch` оставлен страховкой от unhandled rejection (задача #91):
          // сам decryptMessage больше не отклоняется, но в `.then` стоит
          // applyUpdate.
          //
          // Пометка `secret` стоит ВНУТРИ `if (dec)` и значит «в объекте лежит
          // открытый E2E-текст», а не «из секретного чата» (задача #94): её
          // читает фильтр персиста, и ловит она то, чего не ловит `enc_body`, —
          // плейнтекст без шифртекста. Нерасшифрованный кадр плейнтекста не
          // несёт, флага не получает, а на диск не идёт по `enc_body`. Тот же
          // ответ даёт путь истории (`messagesManager.decryptPage`) — раньше он
          // отвечал иначе.
          void secret.decryptMessage(peerId, encBody).then((dec) => {
            if (dec) {
              m.message = dec.text
              m.entities = dec.entities as typeof m.entities
              m.secret = true
              if (dec.media) m.secretMedia = dec.media
            }
            funnel.applyUpdate(pred, p.pts, payload)
          }).catch(() => {})
        } else {
          funnel.applyUpdate(pred, p.pts, payload)
        }
        return
      }
      // Кадр-АПДЕЙТ → единая воронка: дедуп/gap/cache/broadcast. Курсора у него
      // может и не быть вовсе (updateUserTyping, updateUserStatus его не
      // объявляют) — тогда воронка не гейтит, а просто отражает кадр. Делить
      // кадры на «логируемые» и «эфемерные» рукописным списком больше не нужно:
      // ответ даёт СТРУКТУРА конструктора.
      //
      // Сам курсор лежит либо В ТЕЛЕ (конструктор объявляет параметр pts), либо
      // в КОНВЕРТЕ (не объявляет — тогда у оригинала кадр едет в контейнере
      // updates и порядок ему задаёт seq контейнера). Воронке безразлично,
      // откуда он: она гейтит по числу, а место выбирает схема.
      if (pred) {
        funnel.applyUpdate(pred, envPts ?? (payload as { pts?: number })?.pts, payload)
        return
      }
      // Непортированный предмет с курсором (#51): конструктора нет, кадр
      // опознаётся типом конверта, но воронку проходить обязан.
      if (type === LOGGED_WITHOUT_CONSTRUCTOR) {
        funnel.applyUpdate(type, envPts ?? (payload as { pts?: number })?.pts, payload)
        return
      }
      // Секретный handshake: криптообработка в воркере до/вместо трансляции.
      if (type === 'secret_chat_request') {
        const p = payload as { peer_id?: number; initiator_pub?: string }
        if (p.peer_id && p.initiator_pub) secret.stashRequest(p.peer_id, p.initiator_pub)
        broadcast(RT.secretRequest, payload); return
      }
      if (type === 'secret_chat_accept') {
        const p = payload as { peer_id?: number; responder_pub?: string }
        // Отказ глотаем: не свёлся хендшейк — ключа нет, кадры чата приедут
        // нерасшифрованными; повторный accept сведёт заново.
        if (p.peer_id && p.responder_pub) void secret.complete(p.peer_id, p.responder_pub).catch(() => {})
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
    // Временный бабл секретной отправки заводит ТОТ ЖЕ владелец, что и у обычной
    // (см. beforeSending выше) — жизненный цикл общий, разный только транспорт:
    // плейнтекст на сервер не уходит, вместо него шифртекст type:'encrypted'.
    beforeSending,
    // Тот же владелец помечает бабл упавшим: ошибка (нет ключа / оффлайн /
    // сорвался аплоад шифртекста) случается ЗДЕСЬ, в воркере, — вкладке не за
    // чем возвращать её обратно вторым RPC.
    failSending: (clientMsgId) => { void messages.failPending({ clientMsgId }) },
  })

  // sync передан ради getStatus() (Задача 1, ревью «сигнал только push — новая
  // вкладка слепа»): isSyncing() уже существовал для гейта funnel'а, здесь он же
  // питает pull-снимок для позднего подписчика.
  const realtime = newRealtime({ conn, sync, syncWait, tokens, messages, broadcast, channelFunnel, threadReads })

  // Единый реестр менеджеров — единственный источник правды. UI-тип Managers
  // (bootstrap.ts) выводится из этого объекта (WorkerRegistry), поэтому рассинхрон
  // «забыл в одном списке» невозможен by construction (как Managers в tweb).
  const registry = {
    health, auth, profile, premium, chats, messages, realtime, media, push, notify,
    folders, groups, channels, peers, dialogs, forumTopics, presence, stories, contacts, privacy, drafts,
    chatThemes, sessions, calls, livestream, stars, boosts, report, stats, bots,
    stickers, reactions, iv, webPages, secret, persist, langPack, docs,
  }

  function bind(ep: Endpoint) {
    const smp = new SuperMessagePort(ep)
    ports.push(smp)
    // Вешает RPC-хендлер 'manager' (managersProxy.ts) — без вызова ни один из 32
    // менеджеров не отвечает вкладке, приложение мертво на старте, а полный прогон
    // тестов этого не заметит (сам registerManagers юнит-тестируется в
    // managersProxy.test.ts, но что bind() её ЗОВЁТ — нет). Покрыто отдельно:
    // workerCore.test.ts зовёт настоящий bind() и invoke()-ит менеджер через фейковый
    // порт, проверяя, что ответ реально доезжает.
    registerManagers(smp, registry)
    // Канал код-пароля (isLocked/разблокировка/включение…) — с источником вызова:
    // рассылка «всем, кроме источника», ключ на isLocked — только спросившему.
    smp.handle(PASSCODE_CHANNEL, (task) => passcode.handle(smp, task as PasscodeTask))
    // Состояние вкладки и её «непрерываемые» занятия — для автоблокировки
    // (tweb index.worker.ts:335-337, :407-408 `appTabsManager.addTab`).
    appTabsManager.addTab(smp)
    smp.handle(TAB_STATE_CHANNEL, (state) => { appTabsManager.setTabState(smp, state as TabState) })
    smp.handle(TOGGLE_UNINTERUPTABLE_ACTIVITY_CHANNEL, (payload) => {
      const { activity, active } = payload as ToggleUninteruptableActivityPayload
      autoLockControls.toggleUninteruptableActivity(smp, activity, active)
    })
    // Задача 2 (worker-rootscope): вкладка закрылась (Web Lock освободился, либо
    // фолбэк beforeunload) — снять мёртвый порт из ports[], иначе он копится там
    // до конца жизни воркера и получает все broadcast/receiveFrom вечно. Сам лок
    // берёт и держит вкладка (src/client/bootstrap.ts); superMessagePort.ts здесь
    // лишь запрашивает тот же лок и ждёт его освобождения (handleLockTask).
    smp.setOnPortDisconnect(() => {
      indexOfAndSplice(ports, smp)
      // tweb index.worker.ts:424-428 (`onTabDisconnect`)
      appTabsManager.deleteTab(smp)
      autoLockControls.removeTab(smp)
    })
    // Событие, порождённое вкладкой (rootScope.dispatchEvent на главном потоке) —
    // workerScope.receiveFrom: сначала ЛОКАЛЬНО (только воркерные подписчики, БЕЗ
    // обратной отправки в порт), затем ретрансляция ОСТАЛЬНЫМ вкладкам (источнику не
    // шлём — у него оно уже доставлено локально). Логика — realtime/workerScope.ts.
    smp.onAny((event, payload, meta) => { workerScope.receiveFrom(smp, event, payload, meta) })
    // SW↔SharedWorker мост (§ PR-2a): окно (PR-2c) шлёт по этому же порту control-кадр
    // dnp-bridge-port с переданным MessagePort к SW. SMP такой кадр игнорит (нет kind) —
    // ловим сырым слушателем и подключаем мост к каналу. Активно лишь при DNP-ON.
    // Сознательно НЕ покрыто (CLAUDE.md «Тесты»): AppConfig.dnp.enabled в тестовом
    // окружении false по умолчанию (VITE_DNP_ENABLED нигде не задан), ветка ниже не
    // исполняется ни в workerCore.test.ts, ни где-либо ещё в наборе.
    if (fileDownload) {
      ep.addEventListener('message', (ev: MessageEvent) => {
        const d = ev.data as { t?: string } | null
        if (d && d.t === 'dnp-bridge-port' && ev.ports && ev.ports[0]) {
          attachStreamBridge(ev.ports[0], fileDownload)
        }
      })
    }
  }

  function start(): void {
    // Скоуп нормализованного офлайн-стора по токену: при смене аккаунта данные
    // предыдущего стираются, прежде чем воркер начнёт писать сообщения/юзеров.
    //
    // Тем же хвостом — гидрация `me` с диска и снятие гейта `out` (см. объявление
    // meReady выше). Порядок обязателен: читать `me` можно ТОЛЬКО после
    // persistScope — тот стирает данные прошлого аккаунта, и чтение до него
    // отдало бы чужой профиль (а он определяет, чьи сообщения «мои»). Гейт
    // снимаем в любом исходе, включая пустой диск и недоступный IndexedDB:
    // подвисший навсегда гейт хуже неверного `out` — он бы заморозил историю.
    // Значение кладём в кэш владельца молча, без setMe: setMe — точка ПУБЛИКАЦИИ
    // факта (веер rt:me + write-through на диск), а публиковать здесь нечего —
    // это тот же снимок, который воркер сам туда и записал, и вкладке его отдаёт
    // её собственный boot-запрос /me.
    void tokens.load()
      .then(() => persistScope(tokens.get()))
      .then(() => loadMe())
      .then((u) => { if (u && !me) me = u })
      .catch(() => {})
      .finally(() => { markMeReady() })
    // Первый вывод `me` (Stage 1C.2, Task 1). Публикует сам auth.me()
    // (authManager::fetchMe зовёт onMeChanged на любой свежий ответ сервера и
    // на 401), поэтому здесь остаётся ровно один непокрытый им случай —
    // офлайн-фолбэк: fetchMe отдаёт последний профиль с диска БЕЗ публикации,
    // потому что «воркерный кэш и так держит то же самое или лучше». На старте
    // это неверно: кэш ещё пуст, и `getMe()`/`getMeId()` (мердж аватара, кэш
    // «моих» реакций) остались бы без личности до первого удачного /me. Гейт
    // `!me` — и есть «кэш пуст»; он же убирает двойную публикацию одного и
    // того же снимка на успешном пути (Minor 7 раунда 4). Сам гейт отдельным
    // тестом сознательно не покрыт: без него публикация лишь повторяется тем
    // же значением (проектор идемпотентен) — приложение не ломается, а
    // единственный способ развести два случая в тесте требует второго
    // self-стаб-цикла с core.start(), который в этом файле воспроизводимо
    // ронял воркер vitest (см. докблок в workerCore.test.ts). Ошибку глотаем:
    // упавший /me на старте — штатный офлайн, не повод для unhandled rejection.
    void tokens.ready().then(() => auth.me()).then((u) => { if (u && !me) setMe(u) }).catch(() => {})
    void cursor.ready().then(() => { cursorReady = true })
    const g = self as unknown as {
      onconnect?: (e: MessageEvent) => void
      addEventListener: (t: string, cb: (e: MessageEvent) => void) => void
    }
    if ('onconnect' in g) {
      g.onconnect = (e: MessageEvent) => bind((e as MessageEvent & { ports: MessagePort[] }).ports[0])
    } else {
      bind(g as unknown as Endpoint)
    }
  }

  return { registry, bind, ports, workerScope, start }
}
export type WorkerRegistry = ReturnType<typeof createWorkerCore>['registry']
