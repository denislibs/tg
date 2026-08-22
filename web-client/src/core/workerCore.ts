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
import { newAuthManager, type PeerProfile } from './managers/authManager'
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
import { isBroadcast } from './peers/predicates'
import type { Chat } from './peers/peer'
import { newDialogsManager } from './managers/dialogsManager'
import { newPresenceManager } from './managers/presenceManager'
import { newStoriesManager } from './managers/storiesManager'
import { newContactsManager } from './managers/contactsManager'
import { newPrivacyManager } from './managers/privacyManager'
import { newStarsManager } from './managers/starsManager'
import { newBoostsManager } from './managers/boostsManager'
import { newStickersManager } from './managers/stickersManager'
import { newReactionsManager } from './managers/reactionsManager'
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
import { RT, type AckEvt, type MessageErrorEvt, type NewMessageEvt, type PendingNewEvt, type ReadEvt, type ChatUpdateEvt, type ChatRemovedEvt, type ReactionEvt, type DialogPinEvt, type DialogArchiveEvt, type DialogMuteEvt } from './realtime/events'
import type { MessageOp } from './realtime/messageOps'
import { getPeerId } from './peers/peerId'
import { PASS_THROUGH, type LoggedWsType } from './realtime/eventCatalog'
import { idbGet, idbSet } from './store/idbKv'
import { persistScope, loadDialogs, loadStateAll, saveStateKey, saveDialogs, saveMe, loadMe } from './store/persist'
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
    onLoggingOut: (e) => { media.resetToken(); media.resetDownloads(); dialogs.cancelPersist(); dialogs.resetForLogout(); broadcast(RT.loggingOut, e) },
    // Симметричный кадр входа (порт tweb `account_logged_in`) — тем же веером и
    // с тем же сбросом: активный токен сменился, а значит медиа-токен, добытый
    // до входа, принадлежит прошлой сессии; то же — про кэш диалогов.
    onLoggedIn: (e) => { media.resetToken(); media.resetDownloads(); dialogs.cancelPersist(); dialogs.resetForLogout(); broadcast(RT.loggedIn, e) },
  })
  const profile = newProfileManager({ rest, onMeChanged: setMe, getMe: () => me })
  const premium = newPremiumManager({ rest, onMeChanged: setMe })
  const chats = newChatsManager({ rest })
  // decryptSecret дергает secret лениво — стрелка вызывается только на fetch истории
  // (после инициализации модуля), поэтому forward-ссылка на объявленный ниже secret безопасна.
  // broadcast объявлен ниже — стрелка дергает его лениво (оптимистичные мутации
  // tweb-модели: менеджер применяет к SSOT и бродкастит эхо всем вкладкам). Нужен
  // deleteMessage (RPC-путь удаления сообщения): рассылает остальным вкладкам
  // remove-операции, которых WS delete_message уже не даст (SSOT к его приходу пуст).
  const messages = newMessagesManager({
    rest,
    decryptSecret: (peerId, encBody) => secret.decryptMessage(peerId, encBody),
    getMeId: () => me?.user.id ?? null,
    // Порт `appPeersManager.isBroadcast(peerId)` для `generateFlags`: бабл поста
    // вещательного канала рождается с `pFlags.post` — иначе он стоял бы справа
    // до эха и прыгал влево (см. `PendingCtx.isBroadcastChat`). Стрелка ленивая
    // ровно как send/upload ниже: `peers` объявлен дальше по файлу.
    isBroadcastChat: (peerId) => isBroadcast(peers.cachedPeer(peerId) as Chat | undefined),
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
  const notify = newNotifyManager({ rest })
  const folders = newFoldersManager({ rest })
  // Зеркало ключа State во все вкладки (порт tweb apiManagerProxy.processMirrorTaskMap.
  // state) — общая функция для persistManager.stateKey (сторонние ключи) И
  // dialogsManager.applyPinned (свой прямой writer pinnedOrders, Task 4): один
  // канал зеркалирования, не два независимых бродкаста. broadcast объявлен ниже —
  // дёргается лениво, тот же приём, что и остальные стрелки на этой странице.
  const mirrorStateKey = (key: string, value: unknown) => broadcast('state:mirror', { key, value })
  // Task 1 (перенос владения списком диалогов в воркер): список диалогов —
  // воркер единственный владелец (dialogsManager). Веер тот же приём, что у
  // peers ниже: менеджер объявляет операцию (rt:dialog_op), витрина (Task 2)
  // переигрывает её как зеркало. loadCache/loadState — офлайн-кэш и ключи State,
  // от которых зависит порядок (см. докблок dialogsManager.ts). Определён ДО
  // groups/chatThemes (Task 4) — им нужна ссылка на него в конструкторе.
  const dialogs = newDialogsManager({
    rest,
    onDialogOps: (ops) => broadcast(RT.dialogOp, { ops }),
    loadCache: () => loadDialogs(),
    loadState: async () => {
      const st = await loadStateAll()
      // Fix (финальное ревью, Minor #2): тот же версионный гейт, что у main
      // (core/state/loadState.ts — при несовпадении STATE_VERSION он отдаёт
      // чистые дефолты, а не склеивает половинки схемы прошлой сборки). Без него
      // после ближайшего бампа версии main жил бы на дефолтах, а владелец
      // сортировал бы по СТАРОМУ pinnedOrders/drafts — два разных ответа на один
      // вопрос. Через `loadStateOnce()` не идём сознательно: он мемоизирует
      // промис на модуль, а воркер перечитывает State заново после
      // `resetForLogout()` (смена аккаунта) — мемо отдало бы State прошлого.
      const gated = st.version === STATE_VERSION ? st : initialState()
      // Этап 2 (пагинация): `folders` — определения папок для фильтра
      // `getDialogs({filterId})`. Читаются С ДИСКА, а не ждут `setStateKey`:
      // на холодном старте State никто не ПИШЕТ (boot.ts поднимает его
      // `setAppStateSilent`), значит канал зеркала ключа в этом кадре молчит.
      return { pinnedOrders: gated.pinnedOrders ?? {}, drafts: gated.drafts ?? [], folders: gated.folders ?? [] }
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
  const peers = newPeersManager({ rest, onPeerOps: (ops) => broadcast(RT.peerOp, { ops }) })
  // Task 4 (действия без оптимистики): mute/pin/archive идут сеть-сначала (порт
  // tweb toggleDialogPin/updateNotifySettings) — локальный апдейт зовёт владелец
  // ПОСЛЕ успешного REST-ответа, см. groupsManager.ts::setMute/setPin/setArchive.
  const groups = newGroupsManager({ rest, dialogs, peers })
  const channels = newChannelsManager({ rest, beforeSending, peers })
  const presence = newPresenceManager({ rest })
  const stories = newStoriesManager({ rest })
  const contacts = newContactsManager({ rest })
  const privacy = newPrivacyManager({ rest })
  const drafts = newDraftsManager({ rest })
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
  const stickers = newStickersManager({ rest })
  const reactions = newReactionsManager({ rest })
  const iv = newIVManager({ rest })
  const health = newHealthManager(rest)
  // Единый writer офлайн-стора: диалоги/me/папки/черновики теперь пишет воркер (не
  // каждая вкладка со своего main-соединения). Без rest — чистый IndexedDB.
  // broadcast объявлен ниже — стрелка дергает его лениво (к моменту первой записи
  // State порты уже подключены). Зеркало ключа уходит ВО ВСЕ вкладки: порт tweb
  // appStateManager.setKeyValueToStorage → invokeVoid('mirror', …), которая без
  // указания порта рассылается по всем sendPorts (superMessagePort.ts:379).
  const persist = newPersistManager(
    mirrorStateKey,
    // Task 1: порядок диалогов зависит от State-ключей pinnedOrders/drafts —
    // dialogsManager узнаёт об изменении и публикует reindex (см. setStateKey).
    (key, value) => dialogs.setStateKey(key, value),
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
  const broadcast = (event: string, payload: unknown, meta?: EventMeta) => workerScope.broadcast(event, payload, meta)

  // ── Wave 3 funnel ────────────────────────────────────────────────────────────
  // Точка применения: реестр APPLY + dispatch (логируемые апдейты: SSOT + broadcast).
  // Арифметика pts (дубль/следующий/дыра, буфер, таймер) — в realtime/globalFunnel.ts.
  // Эфемерные кадры (typing/presence/calls/…) сюда НЕ заходят — их onFrame транслирует как есть.
  const cursor = newCursor({ get: idbGet, set: idbSet })
  let cursorReady = false

  // Единый реестр маршрутизации логируемых типов: cache (в SSOT воркера, ДО broadcast —
  // иначе переоткрытие чата из кэша теряет апдейт) + rt (имя события для UI). Замена
  // прежних CACHE_THEN_BROADCAST + CATCHUP. new_message — спец-обработка (E2E-расшифровка
  // + cacheLive), см. routeNewMessage.
  // Ключи APPLY типизированы как LoggedWsType (из eventCatalog) — пропуск/лишний
  // логируемый тип ловит компилятор, реестры не дрейфуют.
  // cache может вернуть MessageOp[] (Stage 1B.3, Task 3: media_read/web_page_update/
  // factcheck_update/paid_media_unlock/delete_message; Task 4: poll_update/
  // checklist_update/giveaway_update — по образцу cacheLive, см. dispatch ниже) —
  // тогда dispatch рассылает их ОТДЕЛЬНЫМ кадром RT.messageOp, как routeNewMessage.
  // edit_message/geo_live_update оставлены на прежнем пути (сырой кадр) — см.
  // комментарии у messages.cacheEdit/cacheGeoLive в messagesManager.ts. reaction/
  // star_reaction — тоже НЕ переведены (Task 5), см. комментарий у
  // newReactionMethods в messages/reactionMethods.ts.
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
    // Юзер сменил профиль: кадр интерпретирует владелец карточек (peersManager) —
    // он правит свой кэш и публикует изменение операцией (rt:peer_op). Витрина
    // сырой rt:user_update не разбирает; кадр рассылается дальше как есть, чтобы
    // не заводить исключение в общей проводке логируемых типов (потребителей у
    // него на витрине сейчас нет).
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
    // Вопрос «выросло ли число реакций на МОЁМ сообщении» задаётся ДО того, как
    // кадр ляжет в SSOT: после применения агрегата сравнивать было бы не с чем —
    // окно уже содержало бы новое состояние. Порядок здесь и есть ответ.
    const reactionsGrew = t === 'reaction'
      && messages.reactionsGrewOnMyMessage(getPeerId((d as ReactionEvt).peer), (d as ReactionEvt).msg_id, (d as ReactionEvt).reactions)
    const ops = h.cache?.(d as never)
    if (ops && ops.length) broadcast(RT.messageOp, { ops }, meta)
    // Task 3 (владение диалогами, «realtime-кадры применяет владелец»): кадры,
    // влияющие на список диалогов, применяет dialogsManager — публикует свой
    // rt:dialog_op сам (через onDialogOps), отдельно от сырого кадра ниже
    // (тот доезжает витрине как и раньше, если у него остались другие потребители).
    if (t === 'read') dialogs.applyRead(d as ReadEvt)
    else if (t === 'chat_update') {
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
    else if (t === 'chat_removed') dialogs.applyRemoved((d as ChatRemovedEvt).peer_id)
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
    else if (t === 'dialog_mute') dialogs.applyNotifySettings((d as DialogMuteEvt).peer_id, (d as DialogMuteEvt).notify_settings)
    else if (t === 'dialog_pin') dialogs.applyPinned((d as DialogPinEvt).peer_id, (d as DialogPinEvt).pinned)
    else if (t === 'dialog_archive') dialogs.applyArchived((d as DialogArchiveEvt).peer_id, (d as DialogArchiveEvt).archived)
    else if (t === 'reaction') {
      // Кто-то поставил реакцию на МОЁ сообщение → бампим бейдж непрочитанных
      // реакций диалога.
      //
      // Кадр больше не несёт ни диффа, ни авторитетного счётчика: и «кто
      // поставил», и «сколько теперь непрочитанных» — пер-зрительские, а тело
      // кадра одно на всех получателей. Ответ дал владелец SSOT ВЫШЕ, до
      // применения агрегата; авторитетное значение счётчика приезжает со
      // строкой диалога, как и раньше.
      if (reactionsGrew) dialogs.bumpUnreadReactions(getPeerId((d as ReactionEvt).peer))
    }
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
    // Task 3: превью/unread диалога в списке — тоже владелец (dialogsManager),
    // публикует свой patch независимо от rt:new_message ниже (тот остаётся для
    // read-marker/звука/нотификаций на main — см. storeProjection.ts).
    dialogs.applyNewMessage(e)
    broadcast(RT.newMessage, e, meta)
  }

  // Per-channel pts-конверт (Волна 5): каналы гейтятся против собственного
  // channel_pts, а не общего пер-юзерного курсора. dispatch — тот же (SSOT+broadcast),
  // difference — типизированный конверт, курсор персистится в IDB (chpts:{id}).
  const channelFunnel = newChannelFunnel({
    dispatch,
    getDifference: (peerId, sincePts) => rest.get<ChannelDiff>(`/channels/${peerId}/difference`, { pts: sincePts }),
    loadPts: (peerId) => idbGet<number>(`chpts:${peerId}`).then((v) => (typeof v === 'number' ? v : null)),
    savePts: (peerId, pts) => { void idbSet(`chpts:${peerId}`, pts) },
  })

  const sync = newSyncEngine({
    rest, cursor,
    onUpdate: (item) => funnel.applyUpdate(item.t, item.pts, item.d, false),
    // Полный resync ставит курсор на серверный pts — придержанные out-of-order кадры
    // теперь либо дубли, либо оторванная «будущая» дыра; сбрасываем, чтобы не всплыли.
    // Канальные in-memory курсоры тоже забываем — переоткрытие пересидирует из IDB.
    onResync: () => { funnel.clear(); channelFunnel.reset(); broadcast('rt:resync', null) },
    // Задача 1 (порт ConnectionStatusComponent из tweb): пара rt:state_synchronizing/
    // synchronized — автомат витрины (Задача 3) переключает текст «Обновление…» на
    // время catch-up'а. Проводка проверена workerCore.connectionStatus.test.ts
    // (перехватывает эти колбэки в реальном syncEngine и ловит их выполнение на
    // подключённой вкладке через broadcast).
    onSyncStart: () => broadcast(RT.stateSynchronizing, null),
    onSyncEnd: () => broadcast(RT.stateSynchronized, null),
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
    // retryAt (Задача 1): scheduleReconnect зовёт onState с ВТОРЫМ аргументом только
    // при реконнекте (connectionManager.ts) — здесь он просто прокидывается дальше в
    // payload. Проверено workerCore.connectionStatus.test.ts.
    onState: (s, retryAt) => broadcast(RT.state, { state: s, retryAt }),
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
      // channel_pts + peer_id → per-channel funnel (свой курсор, difference-catch-up).
      // Раньше new_message-ветки: посты канала приходят как new_message, но с
      // channel_pts и без E2E (каналы — публичный broadcast, enc_body не бывает).
      // Пир у кадра лежит в РАЗНЫХ местах, и это не небрежность: кадр с
      // сообщением несёт его ВНУТРИ конструктора (message.peer_id —
      // объединение Peer), потому что там это параметр самого сообщения;
      // кадр метаданных канала сообщения не несёт и держит ключ пира наверху
      // числом. Читать надо оба: пока читался только верхний, посты канала
      // молча проезжали мимо своей воронки — курсор канала от живых кадров не
      // двигался, и каждый догон разрыва приносил их заново.
      {
        const cf = payload as {
          _?: string
          pts?: number
          channel_pts?: number
          peer_id?: number
          message?: { peer_id?: Parameters<typeof getPeerId>[0] }
        }
        // Пост канала опознаётся ДИСКРИМИНАТОРОМ: updateNewChannelMessage — и
        // есть ответ «курсор канальный», потому что своего имени у канального
        // курсора в схеме нет, `pts` там обычный. Прежде вид кадра решало имя
        // ключа (`channel_pts` против `pts`) — второе имя одного и того же поля.
        const isChannelMessage = cf?._ === 'updateNewChannelMessage'
        const channelPts = isChannelMessage ? cf.pts : cf?.channel_pts
        if (typeof channelPts === 'number') {
          const peerId = cf.message?.peer_id !== undefined ? getPeerId(cf.message.peer_id) : cf.peer_id
          if (typeof peerId === 'number') {
            channelFunnel.applyLive(peerId, type, channelPts, payload)
            return
          }
        }
      }
      // message_ack / message_error: кадры эфемерные (без pts — идут мимо funnel,
      // в eventCatalog так и помечены), но реконсилить по ним нужно ВРЕМЕННЫЙ
      // БАБЛ, а он живёт в SSOT воркера (messages/pending.ts). Поэтому владелец
      // применяет их РОВНО ОДИН РАЗ здесь и объявляет результат операциями —
      // раньше это делала каждая вкладка у себя из сырого кадра.
      // return НЕТ сознательно: сырой кадр летит дальше (PASS_THROUGH внизу) — у
      // него остались другие потребители, звук «пак» на ack
      // (client/realtime/soundSubscriber.ts) и тост paid_required на ошибке.
      if (type === 'message_ack' || type === 'message_error') {
        const ops = type === 'message_ack'
          ? messages.ackPendingMessage(payload as AckEvt)
          : messages.failPendingMessage((payload as MessageErrorEvt).client_msg_id)
        if (ops.length) broadcast(RT.messageOp, { ops })
      }
      // new_message: возможна E2E-расшифровка enc_body перед funnel → bespoke.
      if (type === 'new_message') {
        const p = payload as NewMessageEvt
        // Кадр несёт сообщение ЦЕЛИКОМ под ключом `message`, поэтому и шифртекст
        // лежит там же — на конструкторе, а не в конверте.
        const m = p.message
        const encBody = m._ === 'message' ? m.enc_body : undefined
        if (m._ === 'message' && encBody) {
          const peerId = getPeerId(m.peer_id)
          void secret.decryptMessage(peerId, encBody).then((dec) => {
            if (dec) {
              m.message = dec.text
              m.entities = dec.entities as typeof m.entities
              m.secret = true
              if (dec.media) m.secretMedia = dec.media
            }
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
        const p = payload as { peer_id?: number; initiator_pub?: string }
        if (p.peer_id && p.initiator_pub) secret.stashRequest(p.peer_id, p.initiator_pub)
        broadcast(RT.secretRequest, payload); return
      }
      if (type === 'secret_chat_accept') {
        const p = payload as { peer_id?: number; responder_pub?: string }
        if (p.peer_id && p.responder_pub) void secret.complete(p.peer_id, p.responder_pub)
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
  const realtime = newRealtime({ conn, sync, tokens, messages, broadcast, channelFunnel })

  // Единый реестр менеджеров — единственный источник правды. UI-тип Managers
  // (bootstrap.ts) выводится из этого объекта (WorkerRegistry), поэтому рассинхрон
  // «забыл в одном списке» невозможен by construction (как Managers в tweb).
  const registry = {
    health, auth, profile, premium, chats, messages, realtime, media, push, notify,
    folders, groups, channels, peers, dialogs, presence, stories, contacts, privacy, drafts,
    chatThemes, sessions, calls, livestream, stars, boosts, report, stats, bots,
    stickers, reactions, iv, secret, persist,
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
    // Задача 2 (worker-rootscope): вкладка закрылась (Web Lock освободился, либо
    // фолбэк beforeunload) — снять мёртвый порт из ports[], иначе он копится там
    // до конца жизни воркера и получает все broadcast/receiveFrom вечно. Сам лок
    // берёт и держит вкладка (src/client/bootstrap.ts); superMessagePort.ts здесь
    // лишь запрашивает тот же лок и ждёт его освобождения (handleLockTask).
    smp.setOnPortDisconnect(() => { indexOfAndSplice(ports, smp) })
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
