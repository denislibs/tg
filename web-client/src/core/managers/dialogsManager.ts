// Владелец списка диалогов (порт модели tweb: dialogsStorage живёт в воркере
// вместе с generateDialogIndex, черновиками и порядком закреплённых).
// Витрина (`stores/chatsStore.ts`) — зеркало, её единственный писатель — проектор.
//
// Отступление от tweb: у них представление — сам DOM, которым владеет
// SortedDialogList, массива диалогов на main нет; у нас представление — React,
// читающий из стора, поэтому зеркало массивом. См. спеку
// docs/superpowers/specs/2026-08-12-dialogs-ownership-and-virtual-list-design.md.
import type { RestClient } from '../net/restClient'
import { HttpError } from '../net/restClient'
import { mapMessage, isDialogArchived, type Dialog, type DraftMessage, type MyMessage, type RawDialog, type RawMyMessage } from '../models'
import { generateMessageId, isLocalMessageId } from '../history/messageId'
import { SliceEnd } from '../history/slicedArray'
import pause from '@helpers/schedulers/pause'
import { getPeerId } from '../peers/peerId'
import { MUTE_UNTIL_FOREVER, type PeerNotifySettings } from '../dialogs/notifySettings'
import type { Chat, UserReal } from '../peers/peer'
import { dialogIndex } from '../dialogs/dialogIndex'
import { DIALOG_LOAD_COUNT } from '../dialogs/loadCount'
import type { DialogItem, DialogOp } from '../dialogs/dialogOps'
import type { NewMessageEvt, ReadEvt } from '../realtime/events'
import { equal } from '../store/reconcile'
import isMentionUnread from '../messages/isMentionUnread'
import { dialogMatchesFolder } from '../folderFilter'
// Наше закрепление пер-юзерное и на весь список сразу — запись одна (см.
// chatsStore), поэтому `pinnedOrders` ключуется тем же ALL_FOLDER_ID.
// Обе константы — общий дом core/folderIds.ts (их читает и main, и воркер).
import { ALL_FOLDER_ID, ARCHIVE_FOLDER_ID } from '../folderIds'
import { WIRE_FOLDER_ARCHIVE } from '../models'
import type { Folder } from './foldersManager'
import type { PeersManager } from './peersManager'
import SearchIndex from '@lib/searchIndex'
import { getPeerSearchText } from '../peers/peerSearchText'
import type { MessagesManager } from './messagesManager'

/** Размер страницы по умолчанию — как в tweb (`limit = 20`, dialogs.ts:1614). */
const DEFAULT_LIMIT = 20

/** Ответ `getDialogs` — контракт 1:1 с tweb (dialogs.ts:1605-1610, без isTopEnd:
 * его считает потребитель-виртуализатор, этап 3). */
export type DialogsPage = { dialogs: Dialog[]; count: number; isEnd: boolean }

/**
 * Ответ `GET /chats` — КОНТЕЙНЕР схемы (решение Р1): `messages.dialogs`, когда
 * список отдан целиком, и `messages.dialogsSlice{count, …}`, когда отдан кусок.
 *
 * Булева `is_end` на проводе больше НЕТ, и это не потеря поля, а способ сказать
 * «это всё»: конец списка выражает ОТСУТСТВИЕ `count`, ровно как читает
 * оригинал (`appMessagesManager.ts:3614,3629` — `isEnd = !count || …`).
 *
 * Один тип на оба конструктора с необязательным `count`: и tweb читает их так
 * же — `const count = (result as …dialogsSlice).count`.
 */
type MessagesDialogs = {
  _?: 'messages.dialogs' | 'messages.dialogsSlice'
  count?: number
  dialogs?: RawDialog[]
  messages?: RawMyMessage[]
  chats?: Chat[]
  users?: UserReal[]
}

/**
 * Ответ `GET /peer_dialogs` — `messages.peerDialogs` (порт
 * `messages.getPeerDialogs`): строки ЗАПРОШЕННЫХ диалогов теми же векторами,
 * что у списка. `state` сервер не производит — pts этот владелец не видит
 * (см. `dialogOmittedWithoutSubject`, backend/internal/domain/mtdialog_schema_test.go).
 */
type MessagesPeerDialogs = Omit<MessagesDialogs, '_' | 'count'> & { _?: 'messages.peerDialogs' }

export interface DialogsDeps {
  rest: Pick<RestClient, 'get'>
  /** Курсор канала из строки списка — порт tweb `addChannelState(channelId,
   *  dialog.pts)` в `saveDialog` (storages/dialogs.ts:1755-1757): владелец
   *  курсоров — канальная воронка воркера. */
  addChannelState?: (peerId: number, pts: number) => void
  onDialogOps?: (ops: DialogOp[]) => void
  /** офлайн-кэш прошлой сессии (persist.loadDialogs) */
  loadCache: () => Promise<Dialog[]>
  /**
   * Ключи State, от которых зависит порядок (persist.loadStateAll), и —
   * этап 2 — определения папок: фильтр папки считается в воркере
   * (`getDialogs({filterId})`), а на холодном старте State никто не ПИШЕТ
   * (boot.ts поднимает его с диска через `setAppStateSilent`), поэтому канала
   * `setStateKey` для первого кадра мало. `folders` опционален по тому же
   * приёму, что `getMeId`/`savePinnedOrders`: тесты, которых папки не
   * касаются, его не задают.
   */
  loadState: () => Promise<{ pinnedOrders: Record<number, number[]>; folders?: Folder[]; allDialogsLoaded?: Record<number, boolean> }>
  /** id текущего пользователя — нужен applyNewMessage (не бампить бейдж на своё же
   * эхо). Разрешается лениво (воркер узнаёт `me` асинхронно), поэтому геттер, а не
   * значение — тот же приём, что у `newMessagesManager` (messagesManager.ts). */
  getMeId?: () => number | null
  /**
   * Task 4 (действия без оптимистики): `applyPinned` двигает порядок закреплённых
   * и обязан и записать новый `pinnedOrders` на диск, и разослать зеркало ключа
   * остальным вкладкам — тем же путём, что `persistManager.stateKey`
   * (`saveStateKey` + `mirrorStateKey` в workerCore.ts), второй писатель того же
   * ключа не заводится. Опциональны по тому же приёму, что `getMeId` выше: тесты,
   * которых `applyPinned` не касается, их не задают.
   */
  savePinnedOrders?: (value: Record<number, number[]>) => Promise<void>
  mirrorStateKey?: (key: string, value: unknown) => void
  /**
   * Task 5 (персист переезжает к владельцу): физический writer офлайн-кэша
   * списка (`persist.saveDialogs`, подставляется в workerCore.ts). Раньше
   * снапшот собирала main-thread-подписка `stores/dialogsPersist.ts`
   * (дебаунс поверх зеркала chatsStore) и слала его воркеру RPC'ом; теперь
   * владелец — источник данных — пишет сам, тем же дебаунсом, что был там
   * (см. `scheduleSave` ниже). Опционален по тому же приёму, что и
   * `savePinnedOrders`/`mirrorStateKey`: тесты, которых персист не касается,
   * его не задают.
   */
  saveCache?: (dialogs: Dialog[]) => Promise<void>
  /**
   * Запись State-ключа `allDialogsLoaded` — порт tweb `saveAllDialogsLoaded`
   * (lib/storages/dialogs.ts:342-344). Признак «выборка загружена целиком»
   * переживает перезагрузку вместе с кэшем списка: без него короткий список
   * (меньше страницы) после F5 шёл бы в сеть за тем, что уже лежит на диске.
   * Опционален по тому же приёму, что `savePinnedOrders`.
   */
  saveDialogsLoaded?: (value: Record<number, boolean>) => Promise<void>
  /**
   * Владелец карточек пиров. Контейнер `/chats` несёт векторы `chats`/`users` —
   * тела групп и собеседников, — и они втекают в УЖЕ существующий приёмник
   * `saveApiPeers` (порт `appPeersManager.saveApiPeers`, шаг D пиров). Своей
   * копии карточек владелец диалогов не заводит: имя, аватарка и вид чата
   * теперь живут в одном месте на весь клиент.
   *
   * `cachedPeer` нужен правилу папок: вид чата больше не приезжает строкой
   * (решение Р8), «группа это или канал» отвечают предикаты над конструктором.
   * `hydrateFromDisk` поднимает офлайн-копию карточек перед тем, как отдать
   * наверх дисковый кэш диалогов.
   */
  peers?: Pick<PeersManager, 'saveApiPeers' | 'cachedPeer' | 'hydrateFromDisk'>
  /**
   * Владелец сообщений. Вектор `messages` контейнера втекает в ЕГО хранилище
   * (`msgsByChat` — SSOT воркера), а ссылка `dialog.top_message` разрешается
   * оттуда же (решение Р11): главный поток держит зеркало только ОТКРЫТЫХ окон
   * и сообщение закрытого чата взять ему неоткуда, а достраивать рядом второе
   * хранилище объектов нельзя — открытый чат оказался бы в двух копиях.
   *
   * Он же расшифровывает секретные превью: `saveApiMessages` прогоняет вектор
   * через тот же `decryptPage`, что и страницу истории (ключи живут в этом же
   * воркере). Прежний `decryptSecret` владельца диалогов был второй копией того
   * же правила и снят.
   */
  messages?: Pick<MessagesManager, 'saveApiMessages' | 'getMessageByPeer' | 'getHistoryFirstSlice'>
}

/** Тот же интервал, что был у main-thread-дебаунса `dialogsPersist.ts` (800мс)
 * — с запасом округлён до секунды, чтобы серия частых patch'ей (realtime-
 * поток) схлопывалась в одну запись, а не открывала readwrite-транзакцию на
 * каждое изменение. */
const PERSIST_DEBOUNCE_MS = 1000

export function newDialogsManager({ rest, addChannelState, onDialogOps, loadCache, loadState, getMeId, savePinnedOrders, mirrorStateKey, saveCache, saveDialogsLoaded, peers, messages }: DialogsDeps) {
  let items: DialogItem[] = []
  // Полный State-ключ (все папки) — нужен целиком, чтобы applyPinned не затёр
  // чужие записи при записи на диск (порт tweb: `{...orders, [ALL_FOLDER_ID]: …}`,
  // см. прежний chatsStore.setDialogPinned). `pinnedOrder` — производная для
  // ТЕКУЩЕЙ (единственной) папки, ей пользуется dialogIndex().
  let pinnedOrders: Record<number, number[]> = {}
  let pinnedOrder: number[] = []
  // Этап 2 (пагинация): входы фильтра папок. Определения — State-ключ `folders`
  // (диск при гидрации + `setStateKey` на изменение), контакты — отдельный
  // сеттер `setContactIds` (владения контактами этот этап не заводит, см. спеку
  // «Фильтр папки переезжает в воркер»).
  let folders: Folder[] = []
  let contactIds: ReadonlySet<number> = new Set()
  /**
   * Контакты УЖЕ приезжали (пусть даже пустым списком) — третье состояние, без
   * которого пустой `contactIds` неотличим от «контактов ещё нет».
   *
   * Порт гарантии оригинала: tweb перед фильтрацией непользовательской папки
   * ЖДЁТ `fillContacts()` и только потом считает (`dialogs.ts:1625-1642`). У
   * нас контакты приезжают пушем (`stores/foldersStore.ts::loadFolders` →
   * `setContactIds`), ждать нечего — значит нужен признак «данных ещё не
   * было»: иначе правило `contacts`/`non_contacts` МОЛЧА даёт неверную
   * страницу (все — не-контакты), а это хуже пустой (см. forFilter).
   */
  let contactsKnown = false
  /**
   * Выборка запроса — порт tweb `realFolderId` (dialogs.ts:1646-1649).
   * Реальных папок на сервере две, «все чаты» и «архив»; пользовательская
   * папка — клиентский фильтр, её страницы вычерпывают ГЛОБАЛЬНЫЙ набор.
   */
  type Scope = 'global' | 'all' | 'archive'
  const scopeFor = (filterId: number): Scope =>
    filterId === ALL_FOLDER_ID ? 'all' : filterId === ARCHIVE_FOLDER_ID ? 'archive' : 'global'
  /**
   * Номер выборки НА ПРОВОДЕ — порт tweb `FOLDER_ID_ALL`/`FOLDER_ID_ARCHIVE`
   * (appManagers/constants.ts:37-39), он же параметр `folder_id` нашего
   * `/chats` (`0` — всё, кроме архива; `1` — только архив; параметра нет — весь
   * набор). `undefined` у глобальной выборки — это и есть tweb'ский
   * `GLOBAL_FOLDER_ID` (dialogs.ts:1646-1649): запрос уходит БЕЗ папки.
   *
   * Наш `ARCHIVE_FOLDER_ID` (-1) с проводным `1` не совпадает сознательно —
   * см. докблок константы в `core/folderIds.ts`: id папок раздаёт Postgres с
   * единицы, поэтому псевдо-id архива у нас отрицательный, а на проводе
   * остаётся telegram'овская единица.
   */
  const WIRE_FOLDER: Record<Scope, number | undefined> = { global: undefined, all: 0, archive: 1 }

  /**
   * Выборка загружена ЦЕЛИКОМ — порт `allDialogsLoaded` (dialogs.ts:272-299).
   * Хранятся только две реальные папки, глобальная выводится: у tweb под неё
   * есть отдельное поле, поддерживаемое в согласии с двумя реальными, — то же
   * значение, лишнее состояние (спека, «Отступления» №2).
   */
  const dialogsLoaded: Record<'all' | 'archive', boolean> = { all: false, archive: false }
  const isLoaded = (scope: Scope): boolean =>
    scope === 'global' ? dialogsLoaded.all && dialogsLoaded.archive : dialogsLoaded[scope]
  /**
   * Порт `setDialogsLoaded` (dialogs.ts:317-340): GLOBAL поднимает обе реальные,
   * и признак уходит в State (`saveAllDialogsLoaded`, :342-344) ключами
   * проводных папок — как у оригинала, `FOLDER_ID_ALL`/`FOLDER_ID_ARCHIVE`.
   */
  function setLoaded(scope: Scope): void {
    const was = isLoaded(scope)
    if (scope === 'global') { dialogsLoaded.all = true; dialogsLoaded.archive = true }
    else dialogsLoaded[scope] = true
    if (!was) void saveDialogsLoaded?.({ [0]: dialogsLoaded.all, [WIRE_FOLDER_ARCHIVE]: dialogsLoaded.archive })
  }

  /** `count` последнего сетевого ответа ПО ВЫБОРКЕ (аналог tweb
   *  `getFolder(filterId).count`); `null` — этой выборки сеть ещё не видела. */
  const serverCount: Record<Scope, number | null> = { global: null, all: null, archive: null }

  /**
   * Докуда дочерпала пагинация ВЫБОРКИ: `peerId` последнего диалога последней
   * её страницы и его время — `null`, пока страниц этой выборки не было.
   *
   * Порт `dialogsOffsetDate` (dialogs.ts:80,386-393,1052-1058): смещение там
   * тоже хранится ПО ПАПКЕ, а не выводится из кэша, и страница чужой папки его
   * не двигает — `saveGlobalOffset = ... || folderId === GLOBAL_FOLDER_ID`
   * (appMessagesManager.ts:3534) прямо запрещает странице архива сдвигать
   * ГЛОБАЛЬНОЕ смещение.
   *
   * Почему это обязательно у нас: кэш наполняют ТРИ выборки (Task 4), и
   * страница архива кладёт в него старый архивный диалог — то есть в хвост
   * ГЛОБАЛЬНОГО порядка. Пока курсор выводился из хвоста кэша, глобальная
   * выборка после первой же страницы архива просила «всё, что после самого
   * старого архивного», то есть пустоту, — и пользовательская папка (её
   * выборка глобальная) не получала больше ни одного диалога.
   *
   * Время хранится РЯДОМ с id, потому что курсор двигается только ВГЛУБЬ —
   * порт `if(!savedOffsetDate || offsetDate < savedOffsetDate)`
   * (dialogs.ts:1060-1066). У оригинала смещение и есть дата, у нас на проводе
   * `peer_id`, сравнивать которые бессмысленно, — отсюда пара. Без правила
   * «только вглубь» окно `refresh()` (оно всегда от начала выборки) откатывало
   * бы курсор наверх, и следующая страница папки приносила бы уже известное:
   * `added === 0` → фолбэк залипшего курсора → лишний запрос на всё окно.
   */
  const serverCursor: Record<Scope, { peerId: number; at: number } | null> = { global: null, all: null, archive: null }
  let hydrated = false
  // Промис гидратации в полёте (а не булев флаг): конкурентный fillMirror()/
  // refresh() — две вкладки поднимают общий SharedWorker одновременно, либо оба
  // метода зовутся почти сразу друг за другом — обязан ждать РЕЗУЛЬТАТ первого
  // вызова, а не проскакивать мимо него. Флаг `hydrated=true`, выставленный
  // синхронно ДО await, давал второму вызову увидеть «уже гидратировано» и
  // разослать пустой reset раньше, чем первый успел загрузить кэш/State — этот
  // дефект воспроизведён и закрыт тестом «конкурентный fillMirror не рассылает
  // пустой reset» (dialogsManager.test.ts). `null` после промаха — гидратация
  // упавшая (оффлайн/битый IDB) обязана даться повторить, а не залипнуть на
  // вечно отклонённом промисе (см. тест «упавшая гидратация не залипает»).
  let hydrating: Promise<void> | null = null
  // Task 5: таймер отложенной записи кэша (см. scheduleSave/cancelPersist).
  let saveTimer: ReturnType<typeof setTimeout> | null = null
  /**
   * Fix (финальное ревью, Minor #4): поколение сессии. `resetForLogout()`
   * опустошает кэш синхронно, но НЕ гасит уже улетевшие `hydrate()`/`refresh()`
   * — чтение диска и ответ `/chats`, отправленный под ПРОШЛЫМ токеном, придут
   * уже после смены сессии и без гварда применились бы к кэшу нового аккаунта и
   * разошлись бы веером по вкладкам. Приём — тот же `downloadGen` у медиа
   * (`mediaManager.ts::downloadMediaURL`/`resetDownloads`): поколение снимается
   * в момент ЗАПУСКА операции и сверяется перед записью/публикацией.
   */
  let sessionGen = 0

  /**
   * Локальный индекс имён диалогов — порт tweb `dialogsIndex`
   * (storages/dialogs.ts:84, опции — `createSearchIndex` :341-348). Ведётся
   * там же, где у оригинала: диалог индексируется при КАЖДОМ сохранении
   * (`saveDialog` :1400-1403 — у нас `setAll`/`mergePage`) и снимается при
   * выбрасывании (`dropDialog` :1104 — у нас `applyRemoved`). Текст — имя
   * пира из хранилища карточек (`getPeerSearchText`), поэтому он обязан
   * лечь в индекс ПОСЛЕ `saveApiPeers` контейнера — так и идут оба пути.
   * Читает его ветка `query` у `getDialogs`.
   */
  const createSearchIndex = () => new SearchIndex<PeerId>({
    clearBadChars: true,
    ignoreCase: true,
    latinize: true,
    includeTag: true,
  })
  let dialogsIndex = createSearchIndex()
  const indexDialog = (peerId: PeerId) => {
    dialogsIndex.indexObject(peerId, getPeerSearchText(peerId, peers?.cachedPeer(peerId)))
  }

  /** Схлопнуть серию публикаций в одну запись на диск (см. докблок `saveCache`
   * в DialogsDeps). Каждый publish() двигает окно — итоговая запись случится
   * один раз, через PERSIST_DEBOUNCE_MS ПОСЛЕ ПОСЛЕДНЕЙ операции серии,
   * последняя правка при этом не теряется (пишем `items` в момент срабатывания
   * таймера, а не в момент планирования). */
  function scheduleSave(): void {
    if (!saveCache) return
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      saveTimer = null
      void saveCache(items.map((i) => i.dialog))
    }, PERSIST_DEBOUNCE_MS)
  }

  /**
   * Разослать операции вкладкам, НЕ трогая диск. Fix (финальное ревью,
   * Important #4): запись на диск — следствие изменения ЗНАЧЕНИЙ кэша, а не
   * самого факта рассылки. Два колсайта объявляют операцию, ничего в значениях
   * не меняя, и обязаны идти этим путём:
   *  - `fillMirror()` — данные только что прочитаны с ТОГО ЖЕ диска, планировать
   *    обратную запись нечего;
   *  - `reindex` из `setStateKey()` — меняется порядок (производная от
   *    State-ключа `pinnedOrders`), а на диск идут только значения
   *    диалогов (`items.map(i => i.dialog)`), они те же.
   */
  const announce = (ops: DialogOp[]) => { onDialogOps?.(ops) }
  /** Изменились ЗНАЧЕНИЯ кэша: разослать, запланировать запись на диск и
   *  пересчитать расписание мьюта (среди изменившихся мог появиться срок). */
  const publish = (ops: DialogOp[]) => { announce(ops); scheduleSave(); scheduleMuteCheck() }

  // ── Мьют это СРОК, и гасит его клиент (решение Р4) ─────────────────────────
  //
  // Порт tweb `appNotificationsManager.checkMuteUntil` (`:162-218`): по
  // наступлении `mute_until` переопределение СНИМАЕТСЯ и объявляется апдейтом,
  // а следующая проверка ставится на БЛИЖАЙШИЙ оставшийся срок, но не дальше
  // получаса (`Math.min(1800e3, …)`).
  //
  // Без него «заглушить на час» осталось бы неотличимо от «навсегда» на
  // экране: иконка мьюта не погасла бы в назначенный час сама, а пересчёт
  // случался бы только при следующей полной загрузке списка. Тот же класс
  // дефекта и то же лечение, что у истёкшего `userStatusOnline`
  // (`stores/chatsStore.ts::degradeExpiredPresence`), — только у присутствия
  // владелец на главном потоке, а у мьюта здесь, вместе с диалогами.
  //
  // Отступление от оригинала, названное вслух: tweb перезаводит таймер
  // БЕЗУСЛОВНО (тик раз в полчаса даже когда замьюченных нет вовсе). Мы
  // вооружаем его, только если срок реально есть, — расписание пересчитывается
  // на каждом изменении значений кэша (`publish`) и на первом же его
  // наполнении (`setAll`), поэтому пропустить появившийся срок нечем.
  const MUTE_CHECK_MAX_MS = 1800e3
  let muteTimer: ReturnType<typeof setTimeout> | null = null
  // Гвард повторного входа: снятие истёкшего мьюта идёт обычным `patchDialog`,
  // а тот публикует операцию — то есть заходит в `publish` → `scheduleMuteCheck`
  // из середины прохода. Без гварда один проход по списку с двумя истёкшими
  // сроками вложился бы сам в себя.
  let checkingMute = false

  function checkMuteUntil(): void {
    muteTimer = null
    if (checkingMute) return
    checkingMute = true
    try { runMuteCheck(Math.floor(Date.now() / 1000)) } finally { checkingMute = false }
    // Расписание перевзвели уже ПОСЛЕ снятия истёкших — иначе вложенные
    // публикации оставили бы таймер на только что снятом сроке.
    scheduleMuteCheck()
  }

  function runMuteCheck(now: number): void {
    // Копия списка: patchDialog пересобирает `items` на месте.
    for (const { dialog } of [...items]) {
      const until = dialog.notify_settings?.mute_until
      if (!until || until > now) continue
      // Срок вышел — переопределения БОЛЬШЕ НЕТ. Ключ снимаем, а не обнуляем:
      // «выключено» у нас это отсутствие ключа (правило фазы 0). tweb пишет
      // `mute_until = 0` по своей причине — у него пер-типовые настройки
      // склеиваются с пер-чатными в `getPeerLocalSettings`, и удалённая запись
      // была бы перетёрта настройкой типа.
      const { mute_until: _gone, ...rest } = dialog.notify_settings
      patchDialog(dialog.peerId, { notify_settings: rest })
    }
  }

  /**
   * БЛИЖАЙШИЙ срок мьюта — порт `closestMuteUntil` (`:169`). `MUTE_UNTIL_FOREVER`
   * значит «ждать нечего»: и когда замьюченных нет вовсе, и когда все замьючены
   * навсегда, — во втором случае срок формально есть, но не наступит никогда.
   */
  function closestMuteUntil(now: number): number {
    let closest = MUTE_UNTIL_FOREVER
    for (const { dialog } of items) {
      const until = dialog.notify_settings?.mute_until
      if (until && until > now && until < closest) closest = until
    }
    return closest
  }

  function armMuteTimer(closest: number, now: number): void {
    if (muteTimer) { clearTimeout(muteTimer); muteTimer = null }
    if (closest >= MUTE_UNTIL_FOREVER) return // ждать нечего
    muteTimer = setTimeout(checkMuteUntil, Math.min(MUTE_CHECK_MAX_MS, Math.max(0, closest - now) * 1000))
  }

  /** Пересчитать ближайший срок и перевзвести таймер. Дешёвая операция —
   *  один проход по кэшу, без публикаций. */
  function scheduleMuteCheck(): void {
    if (checkingMute) return
    const now = Math.floor(Date.now() / 1000)
    // Уже истёкший срок в кэше (пришёл с диска после долгого простоя) —
    // снимаем прямо сейчас, а не через таймер.
    if (items.some((i) => { const u = i.dialog.notify_settings?.mute_until; return !!u && u <= now })) {
      checkMuteUntil()
      return
    }
    armMuteTimer(closestMuteUntil(now), now)
  }
  /** Порядок — производная от данных (tweb generateDialogIndex, dialogs.ts:605-608). */
  const sort = (dialogs: Dialog[]): DialogItem[] =>
    dialogs
      .map((dialog) => ({ dialog, index: dialogIndex(dialog, pinnedOrder) }))
      .sort((a, b) => b.index - a.index)

  /**
   * Досеять `pinnedOrders` порядком закреплённых из получившегося списка — порт
   * tweb `generateDialogPinnedDate` (dialogs.ts:934-936), где отсутствующий в
   * порядке закреплённый тут же в него добавляется (`order.unshift`) и порядок
   * сохраняется (`savePinnedOrders`). До Task 6 жил в main (`chatsStore.
   * applyDialogs`/`syncPinnedOrder`) и не был перенесён вместе с остальным —
   * последний кусок легаси-пути, см. `stores/chatsStore.order.test.ts` (снесён
   * этой же задачей, сценарии перенесены сюда).
   *
   * Зачем: `pinned_at` сервер наружу не отдаёт (в `Dialog` только флаг
   * `pinned`), он выражен лишь ПОРЯДКОМ ответа `/chats` (ORDER BY m.pinned_at
   * DESC, chatsrepo.go:225). Первый применённый список этот порядок и
   * фиксирует (стабильная сортировка ES2019 разводит dialogIndex-«ничьи» между
   * ЕЩЁ не отслеженными закреплёнными строго по порядку входного массива —
   * см. докблок `dialogIndex.pinnedDate`), дальше он берётся из `pinnedOrder` —
   * иначе закреплённые без записи в порядке (все получают ОДИНАКОВЫЙ индекс)
   * зависели бы от порядка входного массива при КАЖДОМ применении, то есть от
   * того же расхождения кэш/сеть, ради которого dialogIndex вообще заведён.
   *
   * Тот же канал записи/зеркала, что `applyPinned` (Task 4) — второй писатель
   * `pinnedOrders` не заводится.
   *
   * Возвращает, действительно ли `pinnedOrder` изменился: до сих пор
   * НЕотслеженные закреплённые (`idx===-1` в `dialogIndex.pinnedDate`) все
   * получают ОДИНАКОВЫЙ индекс (offset считается от длины `pinnedOrder`, не от
   * позиции) — засеяв их позициями в `next`, тот же `dialogIndex()` для КАЖДОГО
   * из них начнёт отдавать РАЗНЫЕ значения. `setAll` обязан пересчитать `items`
   * заново в этом случае — иначе их СОХРАНЁННЫЙ `index` (ещё старый, общий)
   * разойдётся с тем, что `dialogIndex()` вернул бы сейчас, и ближайший же
   * `patchDialog` любого из них (например, входящее сообщение) пересчитает
   * его индекс уже НОВЫМ и заново засеянным `pinnedOrder`, увидит `moved` и
   * перетасует пин-блок, будто это первый вход в порядок — см.
   * `dialogsManager.test.ts`, «первичное засеивание переживает последующий
   * точечный patch, не только повторный полный список».
   */
  function syncPinnedOrder(sorted: readonly DialogItem[]): boolean {
    const next = sorted.filter((i) => i.dialog.pFlags?.pinned).map((i) => i.dialog.peerId)
    if (next.length === pinnedOrder.length && next.every((id, i) => id === pinnedOrder[i])) return false
    pinnedOrder = next
    pinnedOrders = { ...pinnedOrders, [ALL_FOLDER_ID]: next }
    void savePinnedOrders?.(pinnedOrders)
    mirrorStateKey?.('pinnedOrders', pinnedOrders)
    return true
  }

  /**
   * Совпал ли пересчитанный список с текущим — И порядком (`peerId` + `index`),
   * И значениями. `equal()` — тот же структурный компаратор, которым
   * `reconcileEntity` сохраняет ссылки на витрине.
   */
  function sameItems(a: readonly DialogItem[], b: readonly DialogItem[]): boolean {
    return a.length === b.length
      && a.every((it, i) => it.index === b[i].index && it.dialog.peerId === b[i].dialog.peerId && equal(it.dialog, b[i].dialog))
  }

  /**
   * Применить ПОЛНЫЙ список: кэш при гидрации, а при сетевом догоне — результат
   * слияния окна с кэшем (`mergeWindow`), а не сам ответ сети: подменять
   * коллекцию ответом нельзя (web-client/CLAUDE.md, «НЕЛЬЗЯ»).
   *
   * Fix (финальное ревью, Important #4): `null`, если результат структурно
   * совпал с текущим `items`, — вторая половина того же правила: «совпавший с
   * памятью ответ не даёт ни перерисовки, ни записи в IDB» (порт tweb
   * `saveDialogFilter`). Без этого каждый
   * колсайт `refresh()` (их больше десятка — Sidebar, deep-links, редактор
   * контакта, resync-кадр) публиковал бы `reset` и переписывал ВЕСЬ `S_DIALOGS`
   * даже когда сервер вернул ровно то же самое.
   *
   * Прежний `items` при совпадении сохраняется ПО ССЫЛКЕ (вместе со ссылками на
   * сами диалоги) — свежие объекты `toDialog` выбрасываем: кэш владельца ведёт
   * себя так же, как зеркало под `reconcileById`.
   */
  const setAll = (dialogs: Dialog[]): DialogOp | null => {
    const prev = items
    // Весь набор заменяется целиком — индекс тоже: не вошедшие в новый набор
    // выброшены, вошедшие переиндексированы (у оригинала `saveDialog` зовётся
    // на каждое сохранение, и переименованный пир находится по новому имени,
    // даже если сама строка списка не изменилась — поэтому ДО `sameItems`).
    dialogsIndex = createSearchIndex()
    for (const dialog of dialogs) indexDialog(dialog.peerId)
    items = sort(dialogs)
    // Пересортировать НАДО ЖЕ засеянным pinnedOrder — см. докблок syncPinnedOrder.
    if (syncPinnedOrder(items)) items = sort(dialogs)
    if (sameItems(prev, items)) { items = prev; return null }
    scheduleMuteCheck()
    return { op: 'reset', items }
  }

  const findDialog = (peerId: number): Dialog | undefined => items.find((i) => i.dialog.peerId === peerId)?.dialog

  /**
   * Точечно смержить `fields` в один диалог кэша и опубликовать `patch`. Индекс
   * пересчитывается той же чистой `dialogIndex()` — если он не сдвинулся, `index`
   * в операции не участвует (зеркало просто накладывает `fields` на месте).
   *
   * Диалога нет в кэше — не ошибка (Task 3, «Осторожно» #3): молча выходим, как
   * раньше выходил `if (!cur) return {}` в chatsStore — он приедет со следующей
   * загрузкой/reset'ом.
   *
   * Fix (ревью Task 3, Important): смерженный результат структурно совпал с
   * текущим значением (напр. бэкенд повторно шлёт идентичный `chat_update` —
   * `publishChatUpdate` зовётся из 13 мест бэка и прилетает КАЖДОМУ участнику
   * чата) — `patch` не публикуем вовсе. Раньше (main, chatsStore.applyDialogs)
   * это давало бесплатно `reconcileEntity`/`reconcileById` (совпавший ответ
   * возвращает ИСХОДНЫЙ объект/массив); patch-путь владельца эту сверку не
   * делал и создавал новую ссылку на диалог/патчил зеркало (`chatsStore.ts`,
   * ветка `patch`: `{...d, ...op.fields}` МИМО `reconcileById`) при нулевом
   * изменении данных — лишний ре-рендер мемоизированного `ChatListItem`.
   * `equal()` — тот же структурный компаратор, что и в `reconcileEntity`.
   */
  /**
   * Слить поля в строку списка. `undefined` в `fields` — это «СНЯТЬ ключ», а не
   * «положить ключ со значением undefined»: у конструктора схемы «выключено»
   * выражается ОТСУТСТВИЕМ ключа (правило фазы 0), и оставленный ключ ломал бы
   * структурное сравнение — снятие уже снятого архива публиковалось бы как
   * изменение, а совпавший ответ сети переставал бы совпадать с кэшем.
   */
  function merge(prev: Dialog, fields: Partial<Dialog>): Dialog {
    const next: Dialog = { ...prev, ...fields }
    for (const key of Object.keys(fields) as (keyof Dialog)[]) {
      if (next[key] === undefined) delete next[key]
    }
    return next
  }

  /**
   * Слить `fields` в строку кэша и пересчитать её место, НИЧЕГО не объявляя.
   * `null` — строки нет или значения не изменились; иначе — сдвинулся ли индекс.
   * Общая часть `patchDialog` (объявляет сразу) и `setDialogTopMessage`
   * (объявляет пачкой, см. `scheduleHandleNewDialogs`).
   */
  function mergeDialog(peerId: number, fields: Partial<Dialog>): { index: number; moved: boolean } | null {
    const idx = items.findIndex((i) => i.dialog.peerId === peerId)
    if (idx === -1) return null
    const prev = items[idx].dialog
    const dialog = merge(prev, fields)
    if (equal(prev, dialog)) return null
    const index = dialogIndex(dialog, pinnedOrder)
    const moved = index !== items[idx].index
    items[idx] = { dialog, index }
    if (moved) items = [...items].sort((a, b) => b.index - a.index)
    return { index, moved }
  }

  function patchDialog(peerId: number, fields: Partial<Dialog>): void {
    const r = mergeDialog(peerId, fields)
    if (!r) return
    publish([{ op: 'patch', peerId, fields, ...(r.moved ? { index: r.index } : {}) }])
  }

  // Порт tweb `scheduleHandleNewDialogs`/`handleNewDialogs`
  // (appMessagesManager.ts:8946-8976, :8882-8943): строка, получившая новое
  // последнее сообщение, не объявляется сразу — она копится в карте, и через
  // `pause(0)` ВСЕ накопленные за такт уходят ОДНИМ событием
  // (`dialogs_multiupdate`, у нас — одна операция `upsert` в одном кадре
  // `rt:dialog_op`). Догон (`/sync`) применяет десятки сообщений подряд в одном
  // такте — без пачки каждое из них было отдельным кадром, отдельной
  // сортировкой и отдельной анимацией строки на главном потоке.
  //
  // Значение строки берётся В МОМЕНТ РАССЫЛКИ, а не в момент планирования —
  // как у оригинала, где в карте лежит сам объект диалога.
  const newDialogsToHandle = new Set<number>()
  let newDialogsHandlePromise: Promise<void> | undefined
  function scheduleHandleNewDialogs(peerId: number): void {
    newDialogsToHandle.add(peerId)
    newDialogsHandlePromise ??= pause(0).then(() => {
      newDialogsHandlePromise = undefined
      handleNewDialogs()
    })
  }
  function handleNewDialogs(): void {
    const changed: DialogItem[] = []
    for (const peerId of newDialogsToHandle) {
      // tweb :8907 — «can be already dropped»: строку успели снять
      // (`applyRemoved`, смена сессии) — объявлять нечего.
      const item = items.find((i) => i.dialog.peerId === peerId)
      if (item) changed.push(item)
    }
    newDialogsToHandle.clear()
    if (changed.length) publish([{ op: 'upsert', items: changed }])
  }

  /**
   * Разобрать КОНТЕЙНЕР `/chats` (решение Р1) и вернуть строки списка уже с
   * разрешённым последним сообщением.
   *
   * Порядок обязателен и он же — порядок оригинала (`saveApiResult`, порт
   * `apiUpdatesManager.processUpdateMessage:239-240`): сначала в хранилища
   * втекают ПИРЫ и СООБЩЕНИЯ, и только потом разрешаются ссылки на них. Иначе
   * `getMessageByPeer(peerId, top_message)` не нашёл бы ничего, а имя автора
   * превью собирать было бы не из кого.
   *
   * `messages`/`peers` опциональны по тому же приёму, что `getMeId` и соседи:
   * тесты, которых контейнер не касается, их не задают. Тогда `lastMessage`
   * просто не разрешается — строка списка остаётся без превью, а не падает.
   */
  async function applyContainer(r: MessagesDialogs | MessagesPeerDialogs): Promise<Dialog[]> {
    peers?.saveApiPeers({ chats: r.chats, users: r.users })
    await messages?.saveApiMessages(r.messages)
    return (r.dialogs ?? []).map(toDialog)
  }

  /**
   * Строка провода → строка модели: два КЛИЕНТСКИХ параметра поверх конструктора
   * (`schema/schema_additional_params.json`, предикат `dialog`). Маппера полей
   * здесь нет и быть не может — форма провода и форма модели совпали.
   *
   * Единственное, что переводится, — ПРОСТРАНСТВО НОМЕРОВ: `top_message` и оба
   * горизонта чтения это номера сообщений, и сравниваются они с `message.id`
   * (тики «прочитано», черта непрочитанных, разрешение ссылки на последнее
   * сообщение). Оставить их серверными значило бы сравнивать числа из разных
   * пространств — то же самое делает оригинал в `saveConversation`.
   */
  function toDialog(raw: RawDialog): Dialog {
    const peerId = getPeerId(raw.peer)
    if (raw.pts) addChannelState?.(peerId, raw.pts)
    const top_message = generateMessageId(raw.top_message)
    const dialog: Dialog = {
      ...raw,
      top_message,
      read_inbox_max_id: generateMessageId(raw.read_inbox_max_id),
      read_outbox_max_id: generateMessageId(raw.read_outbox_max_id),
      peerId,
      lastMessage: messages?.getMessageByPeer(peerId, top_message),
    }
    // Номер, на который отвечает черновик, — из ТОГО ЖЕ пространства, что и
    // остальные три: композер восстанавливает по нему reply, а сравнивается он
    // с `message.id`. Ключ ставится ТОЛЬКО когда черновик есть: «черновика нет»
    // — отсутствие параметра (правило фазы 0), и заведённый впустую ключ
    // разошёлся бы с кэшем при структурной сверке (`equal` считает ключи).
    const draft = toClientDraft(raw.draft)
    if (draft) dialog.draft = draft
    return dialog
  }

  /**
   * Порт `appMessagesManager.setDialogTopMessage` (tweb :4954-4973): последним
   * становится известное сообщение — превью и место строки пересчитываются
   * от него (`mergeDialog` → `dialogIndex`, у оригинала `generateIndexForDialog`),
   * а объявляется строка пачкой (`scheduleHandleNewDialogs`, :4972).
   *
   * `extra` — счётчики, которые `onUpdateNewMessage` меняет на том же объекте
   * диалога перед этим вызовом (:10507-10512): у нас объект неизменяемый, и
   * слить их надо одним шагом с превью.
   */
  function setDialogTopMessage(message: MyMessage, extra: Partial<Dialog> = {}): void {
    if (!mergeDialog(message.peerId, { ...extra, top_message: message.id, lastMessage: message })) return
    scheduleHandleNewDialogs(message.peerId)
  }

  // Порт `appMessagesManager.reloadConversation` (tweb :6247-6366): строки
  // диалогов перечитываются у сервера ПАЧКОЙ — пиры, попросившие в одном такте,
  // уходят одним `messages.getPeerDialogs` (`pause(0)`), а попросившие, пока
  // запрос в полёте, — следующим. Ответ сливается как страница списка
  // (`dialogsStorage.applyDialogs` → наш `mergePage`).
  //
  // Отступления: повтора при разошедшемся pts (:6316-6321) нет — курсор
  // апдейтов живёт в соединении, а не у этого владельца; промиса на пира
  // наружу тоже нет — его ждущих у нас нет.
  const reloadPeers = new Set<number>()
  let reloadPromise: Promise<void> | null = null
  function reloadConversation(peerId: number): void {
    reloadPeers.add(peerId)
    flushReload()
  }
  function flushReload(): void {
    if (reloadPromise || !reloadPeers.size) return
    reloadPromise = pause(0).then(async () => {
      const peerIds = [...reloadPeers]
      reloadPeers.clear()
      const gen = sessionGen
      try {
        const r = await rest.get<MessagesPeerDialogs>('/peer_dialogs', { peers: peerIds.join(',') })
        if (gen !== sessionGen) return
        const dialogs = await applyContainer(r)
        if (gen !== sessionGen) return
        mergePage(dialogs)
      } catch {
        // Офлайн или сбой — строка остаётся как была до ближайшей загрузки
        // списка; оригинал здесь тоже только пишет в лог (:6352).
      }
    }).finally(() => {
      reloadPromise = null
      flushReload()
    })
  }

  /** Перевод номера ответа черновика в клиентское пространство. */
  function toClientDraft(draft: DraftMessage | undefined): DraftMessage | undefined {
    if (draft?._ !== 'draftMessage' || draft.reply_to === undefined) return draft
    return {
      ...draft,
      reply_to: { ...draft.reply_to, reply_to_msg_id: generateMessageId(draft.reply_to.reply_to_msg_id) },
    }
  }

  async function doHydrate(): Promise<void> {
    // Гварды поколения (Minor #4): чтение диска асинхронно, за это время могла
    // случиться смена сессии — тогда прочитанное принадлежит прошлому аккаунту.
    // Выходим, НЕ выставив `hydrated`: следующий вызов гидрирует заново, уже
    // под новым скоупом персиста.
    const gen = sessionGen
    const state = await loadState()
    if (gen !== sessionGen) return
    pinnedOrders = state.pinnedOrders
    pinnedOrder = pinnedOrders[ALL_FOLDER_ID] ?? []
    folders = state.folders ?? []
    if (!items.length) {
      // Карточки пиров с диска поднимаются ВМЕСТЕ с диалогами: имя и аватарка
      // группы уехали из строки диалога в вектор `chats` контейнера, и без них
      // офлайн-старт показал бы список без имён (см. `peers.hydrateFromDisk`).
      const [cached] = await Promise.all([loadCache(), peers?.hydrateFromDisk()])
      if (gen !== sessionGen) return
      setAll(cached)
      // tweb dialogs.ts:262 — признак «загружено целиком» поднимается с диска
      // ВМЕСТЕ с кэшем: `getDialogs` отвечает из кэша без сети и тогда, когда
      // строк меньше страницы (dialogs.ts:1903-1905, `loadedAll`).
      dialogsLoaded.all = !!state.allDialogsLoaded?.[0]
      dialogsLoaded.archive = !!state.allDialogsLoaded?.[WIRE_FOLDER_ARCHIVE]
    }
    hydrated = true
    // Мьют — СРОК; ближайший из них надо погасить самому (порт checkMuteUntil).
    scheduleMuteCheck()
  }

  /**
   * Правило папки для строки списка. Вид чата больше не приезжает строкой
   * (решение Р8): «любая группа» и «вещательный канал» — предикаты над
   * конструктором `Chat` из кэша пиров (`core/peers/predicates.ts`), ровно как
   * их задаёт `appPeersManager.isAnyGroup`/`isBroadcast`; «бот» — `pFlags.bot`
   * карточки пользователя оттуда же (`appUsersManager.isBot`). Карточки ещё нет
   * — предикаты отвечают тем же фолбэком, что и у оригинала: пир, про который
   * ничего не известно, ни вещательным каналом, ни ботом не считается.
   */
  const matchesThisFolder = (dialog: Dialog, folder: Folder): boolean =>
    dialogMatchesFolder(dialog, peers?.cachedPeer(dialog.peerId), folder, contactIds)

  /**
   * Элементы кэша, прошедшие фильтр папки, в текущем порядке — порт tweb
   * `getFolderDialogs(filterId)` (dialogs.ts:1650). `null` — посчитать папку
   * ПОКА НЕЧЕМ; показать вместо неё весь список (или неверно отфильтрованный)
   * хуже, чем показать пустую страницу со скелетонами (спека, «Фильтр папки
   * переезжает в воркер»).
   *
   * Входов у фильтра два, и «ещё не приехало» бывает у обоих:
   *  - определения папок (`folders`) — папки с таким id мы не знаем;
   *  - контакты (`contactsKnown`) — правило `contacts`/`non_contacts` без них
   *    посчитало бы КАЖДЫЙ приватный чат не-контактом и молча отдало неверную
   *    страницу. tweb в этом месте дожидается `fillContacts()`
   *    (dialogs.ts:1625-1642); нам ждать нечего — контакты приходят пушем, —
   *    поэтому ведём себя как с неизвестной папкой.
   */
  function forFilter(filterId: number): DialogItem[] | null {
    if (filterId === ALL_FOLDER_ID) return items.filter((i) => !isDialogArchived(i.dialog))
    if (filterId === ARCHIVE_FOLDER_ID) return items.filter((i) => isDialogArchived(i.dialog))
    const folder = folders.find((f) => f.id === filterId)
    if (!folder) return null
    if (!contactsKnown && (folder.contacts || folder.nonContacts)) return null
    // Архив в пользовательские папки не попадает — как в tweb, где архивные
    // диалоги лежат в ДРУГОЙ реальной папке и в выборку фильтра не входят.
    return items.filter((i) => !isDialogArchived(i.dialog) && matchesThisFolder(i.dialog, folder))
  }

  /**
   * Элементы ВЫБОРКИ (а не папки) в текущем порядке: для `all`/`archive` это и
   * есть отфильтрованный список, для пользовательской папки — ВЕСЬ кэш, потому
   * что её выборка глобальная (tweb: `realFolderId` = GLOBAL для фильтра,
   * dialogs.ts:1646-1649).
   *
   * Заведён отдельно от `forFilter`, чтобы у сетевой страницы всё, что зависит
   * от выборки, считалось по ОДНОМУ списку: и курсор (`offset_peer_id`), и
   * размер удерживаемого окна (`held`, размер фолбэка залипшего курсора). Пока
   * курсор брался из выборки, а размер окна — из отфильтрованной папки,
   * фолбэк для пользовательской папки просил ЗАВЕДОМО КОРОТКУЮ страницу
   * (длина папки вместо длины кэша) и курсор не расклинивал: страница вновь
   * приносила уже известное, `added` оставался нулём, и список папки замирал
   * на плейсхолдерах.
   */
  const scopeList = (filterId: number): DialogItem[] =>
    scopeFor(filterId) === 'global' ? items : (forFilter(filterId) ?? [])

  /**
   * Размер набора для страницы — порт `count: loadedAll ? curDialogStorage.length
   * : this.getFolder(filterId).count` (dialogs.ts:1706).
   *
   * Выборка загружена целиком — размер это длина кэша. Иначе берём серверный
   * `count` СВОЕЙ выборки, а если её сеть ещё не видела — глобальный: это
   * ЗАВЫШЕННАЯ оценка, и она здесь не компромисс, а механизм. Размер набора
   * рождает дырку в виртуальном списке, дырка дёргает `requestItemForIdx`, и
   * только он запускает догрузку; равный длине кэша размер дырок не даёт
   * никогда, и список не наполняется вовсе. Пользовательская папка живёт на
   * этой оценке постоянно — ровно как в оригинале, где `folder.count` фильтра
   * присваивается из ответа по ГЛОБАЛЬНОЙ папке (dialogs.ts:1728).
   */
  function countFor(filterId: number, cached: readonly DialogItem[]): number {
    const scope = scopeFor(filterId)
    if (isLoaded(scope)) return cached.length
    return serverCount[scope] ?? serverCount.global ?? cached.length
  }

  /**
   * Позиция курсора в отфильтрованном списке — порт dialogs.ts:1691-1698.
   * Курсор — ЗНАЧЕНИЕ индекса последнего полученного диалога, а не позиция:
   * список мог переехать между запросами, линейный поиск это переживает.
   */
  function offsetFor(list: readonly DialogItem[], offsetIndex: number): number {
    let offset = 0
    if (offsetIndex > 0) {
      for (const length = list.length; offset < length; ++offset) {
        if (offsetIndex > list[offset].index) break
      }
    }
    return offset
  }

  /**
   * Слить страницу в кэш: новые диалоги дописываются, известные обновляются на
   * месте, публикуется `upsert` (`reset` остаётся за `refresh()` и гидрацией).
   *
   * `syncPinnedOrder` здесь НЕ зовётся сознательно (спека, «Хвост из этапа 1»):
   * порядок закреплённых выводится из ПОЛНОГО списка, а частичная страница
   * видит лишь часть пинов — засеяв порядок по ней, мы поставили бы ещё не
   * приехавшие закреплённые задним числом ниже. Дублирующая проверка — тест
   * «слияние страницы не трогает порядок закреплённых»
   * (dialogsManager.pagination.test.ts).
   *
   * Возвращает, сколько диалогов страница добавила ВПЕРВЫЕ (обновление уже
   * известного не считается). Ноль — признак того, что курсор не продвинулся;
   * что с этим делать, решает `getDialogs` (см. там фолбэк залипшего курсора —
   * повторная страница БЕЗ курсора).
   */
  function mergePage(dialogs: Dialog[]): number {
    const byId = new Map(items.map((i) => [i.dialog.peerId, i]))
    const changed: DialogItem[] = []
    let added = 0
    for (const dialog of dialogs) {
      // Индекс — на каждое сохранение, как `saveDialog` (см. `setAll`).
      indexDialog(dialog.peerId)
      const prev = byId.get(dialog.peerId)?.dialog
      if (!prev) added++
      else if (equal(prev, dialog)) continue // тот же диалог теми же значениями — не операция
      const item: DialogItem = { dialog, index: dialogIndex(dialog, pinnedOrder) }
      byId.set(dialog.peerId, item)
      changed.push(item)
    }
    if (!changed.length) return added
    items = [...byId.values()].sort((a, b) => b.index - a.index)
    publish([{ op: 'upsert', items: changed }])
    return added
  }

  /**
   * Время последнего сообщения диалога в миллисекундах — ключ СЕРВЕРНОГО
   * порядка (`ORDER BY m.pinned_at DESC NULLS LAST, lm.created_at DESC NULLS
   * LAST, c.id DESC`, chatsrepo.go:229), а не наш `dialogIndex`: последний
   * поднимает диалог черновиком (`dialogIndex.activityDate`), которого сервер
   * не видит. Всё, что сверяется с порядком ОТВЕТА, обязано считаться этим
   * ключом. `0` — сообщений нет (пустой чат либо очищенная история).
   */
  const msgTime = (d: Dialog): number => {
    // `date` — секунды эпохи (в схеме `date:int`); ключ порядка сервер считает
    // в миллисекундах, поэтому переводим здесь, а не храним два формата.
    return (d.lastMessage?.date ?? 0) * 1000
  }

  /**
   * Диалоги ВРЕМЕННОГО ПОТОКА выборки — те, чьё место в серверном порядке
   * задано временем последнего сообщения. Порт гварда `if(offsetDate &&
   * !dialog.pFlags.pinned)` (dialogs.ts:1051): и закреплённые, и диалоги без
   * сообщения из потока выпадают, и оригинал не пускает их ни в смещение
   * пагинации, ни в рассуждения о том, что этим смещением накрыто.
   *
   * У нас это тем важнее, что порядок сервера — `pinned_at DESC NULLS LAST,
   * lm.created_at DESC NULLS LAST` (chatsrepo.go:229): страница НЕ является
   * непрерывным временным отрезком. Закреплённый идёт первым с любым (в том
   * числе древним или отсутствующим) последним сообщением, а очищенные чаты
   * `NULLS LAST` уводит в самый хвост.
   */
  const inFlow = (d: Dialog): boolean => !d.pFlags?.pinned && msgTime(d) > 0
  const flowOf = (page: readonly Dialog[]): Dialog[] => page.filter(inFlow)

  /**
   * Продвинуть курсор выборки последним диалогом её страницы — и только ВГЛУБЬ
   * (порт `if(!savedOffsetDate || offsetDate < savedOffsetDate)`,
   * dialogs.ts:1060-1066). Пустой ответ курсор не двигает: двигать его в ноль
   * значило бы перечерпывать выборку с начала (порт `if(offsetDate && ...)`,
   * dialogs.ts:1051).
   *
   * Опорным берётся последний диалог ПОТОКА, а не страницы: закреплённый
   * приехал бы курсором наверх набора (сервер ставит его первым при любом
   * времени), а диалог без сообщения дал бы `at === 0` — правило «только
   * вглубь» после такого не выполнилось бы уже никогда, и выборка застряла бы
   * на одном и том же `offset_peer_id`.
   */
  function advanceCursor(scope: Scope, page: readonly Dialog[]): void {
    const flow = flowOf(page)
    const last = flow[flow.length - 1]
    if (!last) return
    const at = msgTime(last)
    const saved = serverCursor[scope]
    if (!saved || at < saved.at) serverCursor[scope] = { peerId: last.peerId, at }
  }

  /**
   * Сетевая страница — порт `appMessagesManager.getTopMessages` из ветки
   * догрузки (dialogs.ts:1712-1717). Курсор к серверу — `peerId` последнего
   * элемента ТОЙ ЖЕ выборки, а не `offsetIndex`: у бэкенда своего понятия
   * `dialogIndex` нет (отступление №1 спеки этапа 2), а чат из другой папки он
   * внутри выборки не нашёл бы и отдал страницу с начала (`dialogpage.go`).
   *
   * `useCursor === false` — страница НАМЕРЕННО без курсора (фолбэк залипшего
   * курсора, см. `getDialogs`). `null` — ответ применять нельзя (офлайн либо
   * сменившаяся сессия).
   */
  async function fetchPage(filterId: number, limit: number, useCursor = true): Promise<{ isEnd: boolean; added: number } | null> {
    const gen = sessionGen
    const scope = scopeFor(filterId)
    // Курсор — докуда дочерпала пагинация СВОЕЙ выборки (`serverCursor`); пока
    // страниц реальной папки не было, отталкиваемся от хвоста того, что держим
    // в ней, — это кэш прошлой сессии с диска, поднятый гидрацией (у tweb
    // `setDialogsFromState` → `pushDialog` так же выводит смещение папки из
    // кэша, dialogs.ts:1209-1227).
    //
    // У ГЛОБАЛЬНОЙ выборки (пользовательская папка) смещения из кэша нет:
    // гидрация его не сохраняет (`saveGlobalOffset` не передан), и
    // `getOffsetDate(GLOBAL_FOLDER_ID)` без сохранённого отдаёт начало набора
    // (dialogs.ts:464-468). Хвост всего кэша здесь врал бы: страница архива
    // кладёт туда самый старый архивный диалог (см. докблок `serverCursor`).
    // Прежде это закрывал сетевой `refresh()` на каждом старте — он продвигал
    // глобальный курсор раньше первой страницы папки; старта с сетью больше нет.
    //
    // Опорный чат обязан ЛЕЖАТЬ в кэше выборки: `peer_id`, которого мы больше
    // не держим (диалог выпал при слиянии окна, ушёл в архив, был удалён),
    // просит у сервера продолжение с места, которого у нас нет, — голова
    // выборки осталась бы дырками, а каждая следующая страница уходила бы
    // глубже. Такой курсор — некорректное состояние, а не повод для фолбэка:
    // фолбэк залипшего курсора (`getDialogs`) ловит другое, `added === 0`.
    const cursorList = scopeList(filterId)
    const heldTail = cursorList.length ? cursorList[cursorList.length - 1].dialog.peerId : 0
    const saved = serverCursor[scope]
    const held = saved !== null && cursorList.some((i) => i.dialog.peerId === saved.peerId)
    const offsetPeerId = useCursor ? (held ? saved.peerId : scope === 'global' ? 0 : heldTail) : 0
    const wire = WIRE_FOLDER[scope]
    const query: Record<string, string | number> = { limit, offset_peer_id: offsetPeerId }
    if (wire !== undefined) query.folder_id = wire
    try {
      const r = await rest.get<MessagesDialogs>('/chats', query)
      const dialogs = await applyContainer(r)
      // Ответ отправлен под ПРОШЛЫМ токеном (Minor #4) — не применяем.
      if (gen !== sessionGen) return null
      if (typeof r.count === 'number') serverCount[scope] = r.count
      advanceCursor(scope, dialogs)
      const added = mergePage(dialogs)
      // Конец выборки — ПОРТ ФОРМУЛЫ ОРИГИНАЛА (appMessagesManager.ts:3629):
      //   isEnd = !count || dialogsLength >= count || !items.length
      // Отсутствие `count` и есть «это всё»: его нет только у конструктора
      // `messages.dialogs`, а его бэкенд собирает ровно тогда, когда страница
      // совпала с набором от начала до конца (`dialogpage.go` — `Whole`).
      // Прежняя проверка «`is_end` И покрыли ли мы выборку от начала» здесь
      // больше не нужна: её вторую половину теперь выражает сам выбор
      // конструктора. `dialogsLength` — удерживаемое окно ВЫБОРКИ, пересчитанное
      // ПОСЛЕ слияния страницы (`mergePage` выше уже отработал).
      const isEnd = !r.count || scopeList(filterId).length >= r.count || !dialogs.length
      if (isEnd) setLoaded(scope)
      return { isEnd, added }
    } catch (e) {
      if (e instanceof HttpError) throw e
      return null // офлайн — остаёмся на кэше, как в refresh()
    }
  }

  /**
   * Свести окно глобальной выборки с кэшем и вернуть список, который должен
   * получиться. Полной подменой применять ответ НЕЛЬЗЯ (web-client/CLAUDE.md,
   * «НЕЛЬЗЯ»: «Применять ответ сети полной подменой коллекции»; порт tweb
   * `saveDialogs` — там ответ всегда сливается, а не заменяет набор): пока
   * `refresh()` был безлимитным, «окно» и «весь список» совпадали и разницы не
   * было, а страничное окно выкидывало бы всё, что лежит ниже него, — архив
   * (`ArchiveList` тут же подменялся бы заглушкой и терял `scrollTop`) и
   * глубокие страницы пользовательских папок.
   *
   * При этом `refresh()` — ещё и ремонт списка после разрыва потока апдейтов
   * (`rt:resync`, `client/realtime/refetchSubscriber.ts`): удаления приезжают
   * своим каналом (`chat_removed` → `applyRemoved`, плюс прямой вызов после
   * успеха REST-действия), но кадр, потерянный в разрыве, к нам уже не придёт —
   * ремонт может быть только сверкой с ответом. Поэтому из кэша снимается РОВНО
   * то, что сервер точно не вернул, хотя обязан был бы: диалог, попадающий во
   * ВРЕМЕННОЙ ДИАПАЗОН окна (между самым свежим и самым старым его сообщением),
   * но отсутствующий в ответе. Всё, что ниже окна, не трогается — оно вне
   * зоны ответственности этого ответа.
   *
   * Границы считаются ТОЛЬКО по временному потоку окна (`flowOf`), и сверяются
   * с ним же — пять категорий диалогов ведут себя по-разному; первые четыре —
   * осознанно, пятая это известная цена (см. её пункт):
   *  - **закреплённый** в границы не входит и правилом не снимается: сервер
   *    ставит его первым при любом времени последнего сообщения (в том числе
   *    древнем), поэтому по времени он окно не описывает — считая по нему,
   *    нижняя граница проваливалась бы к нему, и всё удерживаемое ниже
   *    (глубокие страницы папок, набранный прокруткой архив) снималось бы как
   *    «пропавшее внутри окна»;
   *  - **без последнего сообщения** (пустой чат, очищенная история —
   *    `cleared_max_seq`, chatsrepo.go:213) — то же самое, только границу он
   *    обнулял бы совсем, и слияние выродилось бы обратно в полную подмену;
   *  - **с временем РОВНО на нижней границе** — остаётся: тайбрейк сервера
   *    `c.id DESC` (chatsrepo.go:229) может отрезать соседа с той же меткой
   *    сразу за срезом страницы, и его отсутствие в ответе ничего не доказывает;
   *  - **поднявшийся выше всего окна** (realtime-сообщение долетело до нас
   *    раньше, чем сервер собрал ответ) — остаётся: вернуть его сервер не мог,
   *    это мы знаем больше, чем он;
   *  - **с УДАЛЁННЫМ на сервере последним сообщением** — единственная категория,
   *    которую правило снимает ошибочно, и это принятая цена. Удаление,
   *    дошедшее до нас кадром, `lastMessage` пересчитывает
   *    (`applyDeletedMessages`), но удаление, потерянное в разрыве потока
   *    апдейтов, — нет: чат, уехавший на сервере НИЖЕ окна из-за
   *    удаления своих последних сообщений, в ответе не придёт, а локальный
   *    `msgTime` останется внутри `(bottom, top]` — строка снимется из кэша и
   *    пропадёт из сайдбара до ближайшей догрузки вглубь, которая вернёт её с
   *    верным временем. Данные не теряются, поэтому гвард («снимать, только
   *    если сервер подтвердил чат временем ниже нашего» — то есть второй проход
   *    сверки и второй источник правды о времени) дороже, чем сама цена.
   *
   * Цена решения: фантом закреплённого или очищенного диалога, чей
   * `chat_removed` потерялся в разрыве потока апдейтов, этим ответом НЕ
   * снимается — его снимет свой канал (`applyRemoved`) либо ответ с `is_end`,
   * когда выборка целиком уместится в окно. Ложное удаление живого диалога
   * дороже задержавшегося фантома.
   *
   * Сравнение — по `msgTime` (ключ серверного порядка), а не по `dialogIndex`:
   * иначе диалог, поднятый ЛОКАЛЬНЫМ черновиком, попадал бы в окно, которого
   * сервер для него не строил.
   */
  function mergeWindow(page: Dialog[], isEnd: boolean): Dialog[] {
    const held = items.map((i) => i.dialog)
    // Окно накрыло выборку ОТ НАЧАЛА И ДО КОНЦА — оно и есть весь список.
    if (isEnd) return page
    // Пустое окно без `is_end` — сервер не сказал ничего, сверять не с чем.
    if (!page.length) return held
    const returned = new Set(page.map((d) => d.peerId))
    const flow = flowOf(page)
    // В окне ни одного диалога временного потока (только закреплённые и/или
    // очищенные) — границ нет, сверять не с чем: просто сливаем.
    if (!flow.length) return [...page, ...held.filter((d) => !returned.has(d.peerId))]
    let top = -Infinity
    let bottom = Infinity
    for (const d of flow) {
      const t = msgTime(d)
      if (t > top) top = t
      if (t < bottom) bottom = t
    }
    const kept = held.filter((d) => {
      if (returned.has(d.peerId)) return false // свежая версия уже в `page`
      if (!inFlow(d)) return true // вне временного потока — правилом не снимаем
      const t = msgTime(d)
      return t <= bottom || t > top
    })
    return [...page, ...kept]
  }

  /**
   * Тело `refresh()` отдельной функцией, а не методом объекта. До Task 4 его
   * звал и `getDialogs` — фолбэком залипшего курсора; теперь фолбэк там свой
   * (страница БЕЗ курсора, см. `getDialogs`), и внутренних потребителей у тела
   * не осталось. Форма сохранена: ссылаться из объекта на его собственный
   * метод (`this`/замыкание на литерал) владелец не может — он раздаётся по
   * RPC поштучно, `this` на той стороне не существует, поэтому любой будущий
   * внутренний колсайт упёрся бы ровно в это.
   *
   * Перечитывает РОВНО удерживаемое окно, а не весь список. Три следствия, и
   * все три — цель правки (спека, «`refresh()` тянет весь список»):
   *  - холодный старт держит ноль, значит просит одну страницу: `boot.ts`
   *    становится страничным сам по себе, без правок в нём;
   *  - все девятнадцать колсайтов остаются верными — они получают свежий вид
   *    того же окна, а всё, что лежит ниже него (архив, глубокие страницы
   *    папок), переживает ответ: окно СЛИВАЕТСЯ с кэшем, см. `mergeWindow`;
   *  - `loadedAll` поднимается только по `is_end`, то есть когда окно
   *    действительно накрыло набор, — раньше безлимитный запрос поднимал его
   *    ВСЕГДА и глушил догрузку до конца сеанса.
   *
   * Выборка — глобальная: `refresh()` обслуживает кэш целиком, а не папку.
   */
  async function doRefresh(): Promise<DialogOp | null> {
    const gen = sessionGen
    await hydrate()
    const limit = Math.max(items.length, DIALOG_LOAD_COUNT)
    try {
      const r = await rest.get<MessagesDialogs>('/chats', { limit })
      const dialogs = await applyContainer(r)
      // Ответ отправлен под ПРОШЛЫМ токеном (Minor #4) — не применяем.
      if (gen !== sessionGen) return null
      if (typeof r.count === 'number') serverCount.global = r.count
      // Окно прочитано ОТ НАЧАЛА глобальной выборки, значит её пагинация дошла
      // как минимум до последнего диалога ответа (см. докблок `serverCursor`):
      // без этого следующая страница папки пошла бы от хвоста кэша, куда
      // страница архива уже положила самый старый архивный диалог.
      advanceCursor('global', dialogs)
      // Запрос идёт БЕЗ курсора, поэтому отсутствие `count` (конструктор
      // `messages.dialogs`) означает «окно накрыло набор от начала», то есть
      // кэш держит его целиком.
      const isEnd = !r.count
      if (isEnd) setLoaded('global')
      const op = setAll(mergeWindow(dialogs, isEnd))
      // Ответ совпал с памятью — ни операции, ни записи на диск (Important #4).
      if (op) publish([op])
      return op
    } catch (e) {
      if (e instanceof HttpError) throw e
      return null
    }
  }

  /**
   * Ветка `query` у `getDialogs` — порт dialogs.ts:1660-1686 + :1702-1709.
   * Отвечает ТОЛЬКО из кэша: с запросом оригинал в сеть не ходит вовсе
   * (`(isServerSearchSupported ? false : query) || …` — серверный поиск там
   * только у форумов), ищутся лишь загруженные диалоги.
   *
   * Папка — условие `dialog.folder_id === filterId` (:1676): реальных папок
   * две, «все чаты» и архив (у нас `forFilter` их и отдаёт — в порядке
   * списка, то есть уже отсортированными `getDialogIndex` по убыванию, :1681);
   * у пользовательской папки `folder_id` не совпадает никогда, выдача пуста.
   *
   * Расхождение: `cachedResults` (мемо выдачи на пагинацию тем же запросом,
   * :1661-1684) не перенесён — выдача пересчитывается на каждую страницу;
   * потребителей, листающих локальную выдачу, у нас нет, а индекс и так
   * живёт готовым.
   */
  function searchDialogs(query: string, offsetIndex: number, limit: number, filterId: number): DialogsPage {
    const scope = scopeFor(filterId)
    const results = dialogsIndex.search(query)
    const found = (scope === 'global' ? [] : (forFilter(filterId) ?? []))
      .filter((i) => results.has(i.dialog.peerId))
    const offset = offsetFor(found, offsetIndex)
    return {
      dialogs: found.slice(offset, offset + limit).map((i) => i.dialog),
      // `loadedAll ? curDialogStorage.length : getFolder(filterId).count` (:1706)
      count: countFor(filterId, found),
      isEnd: offset + limit >= found.length,
    }
  }

  function hydrate(): Promise<void> {
    if (hydrated) return Promise.resolve()
    // `hydrating === p` в finally (а не безусловное обнуление): `resetForLogout()`
    // сбрасывает `hydrating` синхронно, и гидратация ПРОШЛОЙ сессии, дорезолвившись
    // позже, обнулила бы ссылку на уже начатую гидратацию НОВОЙ — третий
    // конкурентный вызов начал бы её заново (тот же класс гонки, что закрыт
    // кэшированием промиса вместо булева флага, см. докблок `hydrating`).
    const p = (hydrating ??= doHydrate().finally(() => { if (hydrating === p) hydrating = null }))
    return p
  }

  return {
    /**
     * Зеркало объявило пробел. Отвечаем ВСЕГДА — и ответом RPC (его ждёт boot.ts
     * до первого рендера), и веером (соседние вкладки). «Уже публиковали» не
     * считается доставкой: SuperMessagePort кадры не буферизует.
     *
     * `announce`, а не `publish` (Important #4, отложенная мелочь): значения
     * только что прочитаны с диска — планировать обратную запись на тот же диск
     * бессмысленно.
     */
    async fillMirror(): Promise<DialogOp> {
      const gen = sessionGen
      await hydrate()
      // Сессия сменилась, пока читали диск (Minor #4): ответ прошлого аккаунта
      // ни рассылать, ни отдавать спросившему нельзя — отдаём честно пустой.
      if (gen !== sessionGen) return { op: 'reset', items: [] }
      const op: DialogOp = { op: 'reset', items }
      announce([op])
      return op
    },

    /**
     * Сетевой догон. Офлайн — молча остаёмся на кэше (как прежний listDialogs).
     *
     * Fix (финальное ревью, Important #2): возвращает ОПУБЛИКОВАННУЮ операцию
     * (или `null`, если применять нечего). Единственным каналом доставки был
     * бродкаст `rt:dialog_op`, а насос `smp.on(...)` поднимается лишь в
     * `startRealtime()` из эффекта `useAppBootstrap` — ПОСЛЕ первого рендера;
     * `SuperMessagePort` кадры не буферизует, поэтому ответ `/chats`, пришедший
     * раньше подписки (localhost/быстрая сеть — обычное дело), уходил в никуда,
     * и вкладка жила весь сеанс на дисковом кэше. Правило то же, что у
     * `fillMirror`: пробел закрывает ОТВЕТ RPC, а не следующий бродкаст;
     * повторное применение через бродкаст идемпотентно.
     */
    refresh: doRefresh,

    getSnapshot: (): DialogItem[] => items,

    /**
     * Страница списка — порт tweb `dialogsStorage.getDialogs`
     * (lib/storages/dialogs.ts:1691-1753; форумы/`skipMigrated` у нас
     * отсутствуют как явления, поэтому портированы ветка списка и ветка
     * локального поиска `query`, см. `searchDialogs`).
     *
     * Три шага оригинала: (1) отфильтровать кэш папкой, (2) найти курсор
     * линейным поиском по ЗНАЧЕНИЮ индекса, (3) хватает кэша — нарезать
     * локально, не хватает — одна сетевая страница, пересчитать курсор,
     * нарезать заново.
     *
     * Размер набора и признак конца — `countFor`/`isLoaded` (см. их докблоки);
     * страница, не дотянувшаяся до хвоста кэша, концом не считается — порт
     * `dialogs.ts:1751`.
     *
     * Конкурентные вызовы НЕ сериализуются: два одновременных `getDialogs`
     * выпустят два запроса. Так же и в tweb — очередь держит потребитель
     * (`helpers/sequentialCursorFetcher.ts`, этап 3), а не хранилище.
     */
    async getDialogs(options: { query?: string; offsetIndex?: number; limit?: number; filterId?: number } = {}): Promise<DialogsPage> {
      const { query = '', offsetIndex = 0, limit = DEFAULT_LIMIT, filterId = ALL_FOLDER_ID } = options
      const gen = sessionGen
      await hydrate()
      // Сессия сменилась, пока читали диск (Minor #4) — отдаём честно пустую страницу.
      if (gen !== sessionGen) return { dialogs: [], count: 0, isEnd: false }

      if (query) return searchDialogs(query, offsetIndex, limit, filterId)

      const cached = forFilter(filterId)
      // Считать папку пока нечем (определения или контакты не приехали) — см. forFilter.
      if (!cached) return { dialogs: [], count: 0, isEnd: false }

      // Порт dialogs.ts:1700-1710 — попадание в кэш отвечает без сети.
      const offset = offsetFor(cached, offsetIndex)
      const isEnoughDialogs = cached.length >= offset + limit
      const loaded = isLoaded(scopeFor(filterId))
      if (loaded || isEnoughDialogs) {
        return {
          dialogs: cached.slice(offset, offset + limit).map((i) => i.dialog),
          count: countFor(filterId, cached),
          isEnd: loaded && offset + limit >= cached.length,
        }
      }

      // Порт dialogs.ts:1712-1752 — одна страница из сети, затем пересчёт курсора.
      let res = await fetchPage(filterId, limit)
      // Гварды сессии здесь и в ветке фолбэка ниже СОЗНАТЕЛЬНО НЕ ПОКРЫТЫ
      // мутацией (довод один на оба): `resetForLogout()`
      // синхронно опустошает `items`, а `fetchPage` под сменившимся поколением
      // ничего не сливает, поэтому нижняя ветка и так соберёт пустую страницу —
      // обе ветки дают один результат. Гвард держит инвариант «ответ прошлой
      // сессии не собирается из кэша НОВОЙ» (регидратация могла успеть
      // наполнить `items` между сбросом и этой строкой) и обязан пережить
      // появление такой регидратации.
      if (gen !== sessionGen) return { dialogs: [], count: 0, isEnd: false }
      // Страница по курсору не принесла НИ ОДНОГО нового диалога и концом
      // выборки себя не объявила — курсор залип: опорный чат на сервере исчез,
      // и бэкенд отдаёт с начала (`dialogpage.go`), а хвост кэша не сдвинулся,
      // значит следующий запрос уйдёт с ТЕМ ЖЕ `offset_peer_id` — список не
      // продвинулся бы никогда. Выход — одна страница БЕЗ курсора, заведомо
      // накрывающая удерживаемое окно целиком: она и пересобирает голову, и
      // приносит хвост. Полным `refresh()` это лечить больше нельзя — он
      // ограничен тем же удерживаемым окном (Task 5) и списка не продвигает.
      if (res && !res.isEnd && !res.added) {
        // Размер фолбэка считается по ТОМУ ЖЕ списку, из которого брался курсор
        // (`scopeList`), а НЕ по отфильтрованной папке: у пользовательской папки
        // курсор — хвост всего кэша, и страница длиной с папку заведомо не
        // дотянулась бы до него — курсор остался бы залипшим (ревью Task 4,
        // Important 1).
        res = await fetchPage(filterId, scopeList(filterId).length + limit, false)
        // Тот же сознательно непокрытый гвард, что выше, — довод там же.
        if (gen !== sessionGen) return { dialogs: [], count: 0, isEnd: false }
      }
      const after = forFilter(filterId) ?? []
      const nextOffset = offsetFor(after, offsetIndex)
      const page = after.slice(nextOffset, nextOffset + limit)
      return {
        dialogs: page.map((i) => i.dialog),
        count: countFor(filterId, after),
        // `isLoaded` спрашивается ВТОРОЙ раз намеренно (первый — до `fetchPage`,
        // `loaded` выше): страница могла принести `is_end` и поднять флаг своей
        // выборки прямо сейчас, и тогда конец набора решает уже он, а не снимок,
        // сделанный до запроса.
        isEnd: (isLoaded(scopeFor(filterId)) && nextOffset + limit >= after.length)
          // tweb: `result.isEnd && curDialogStorage[len-1] === dialogs[len-1]`
          // (dialogs.ts:1751) — конец набора засчитан, только если окно
          // дотянулось до ХВОСТА кэша: страница короче хвоста концом списка не
          // является. Пустая страница при `isEnd` — тот же конец (дальше нечего).
          || (!!res?.isEnd && (page.length === 0 || page[page.length - 1] === after[after.length - 1])),
      }
    },

    /**
     * Порт `dialogsStorage.getNextDialog` (tweb `storages/dialogs.ts:527-543`) —
     * соседний диалог папки для Alt+↑/↓ (`appImManager.attachKeydownListener`,
     * tweb `appImManager.ts:1746-1757`). Папка — `forFilter` (tweb
     * `getFolderDialogs(filterId, true)`); посчитать её нечем — соседа нет.
     */
    getNextDialog(currentPeerId: PeerId, next: boolean, filterId: number): Dialog | undefined {
      const folder = forFilter(filterId) ?? []
      let dialog: Dialog | undefined
      if (!currentPeerId) {
        if (next) {
          dialog = folder[0]?.dialog
        }
      } else {
        const idx = folder.findIndex((item) => item.dialog.peerId === currentPeerId)
        if (idx !== -1) {
          const nextIndex = next ? idx + 1 : idx - 1
          dialog = folder[nextIndex]?.dialog
        }
      }

      return dialog
    },

    /**
     * Порт tweb `appMessagesManager.getReadMaxIdIfUnread` — горизонт прочтения,
     * но ТОЛЬКО если в диалоге реально есть непрочитанное, иначе 0. На этом
     * гейте стоит граница «Непрочитанные сообщения» в ленте
     * (`components/chat/bubbles.ts::setUnreadDelimiter`, порт tweb
     * bubbles.ts:11570): прочитанный чат черты не получает вовсе.
     *
     * Owner-факт: запись диалога живёт здесь, витрине она видна зеркалом, а
     * императивной ленте (`bubbles.ts`) сторы читать нельзя — поэтому ответ
     * приезжает ей RPC, как и в tweb, где это тоже вызов менеджера.
     */
    getReadMaxSeqIfUnread(peerId: number): number {
      const d = findDialog(peerId)
      return d && d.unread_count > 0 ? d.read_inbox_max_id : 0
    },

    /**
     * Порт tweb `appMessagesManager.getInboxReadMaxId` (tweb 79d6a8f95) вместе
     * со счётчиком непрочитанных диалога (tweb `chat.getDialogOrTopic()` →
     * `dialog.unread_count`) — одним ответом, потому что лента спрашивает их
     * вместе.
     *
     * Курсор — САМ, без схлопывания в 0: в отличие от `getReadMaxSeqIfUnread`
     * он годится для вопроса «прочитано ли ЭТО сообщение» (гейт наблюдателя
     * прочтения, `components/chat/bubbles.ts::renderMessage`), — иначе в
     * полностью прочитанном чате непрочитанным выглядел бы каждый бабл.
     * Счётчик нужен кнопке «вниз» (tweb ce37ebeb3, `unread_count !== 1`).
     * Диалога нет — `undefined`: курсор неизвестен, и лента отвечает на это
     * консервативно (`core/messages/isUnreadByReadCursor.ts`).
     */
    getDialogReadState(peerId: number): { readInboxMaxSeq: number, unreadCount: number } | undefined {
      const d = findDialog(peerId)
      return d ? { readInboxMaxSeq: d.read_inbox_max_id, unreadCount: d.unread_count } : undefined
    },

    /**
     * Порт tweb `Chat.getHistoryMaxId` (chat.ts) — seq самого свежего сообщения
     * чата. Ленте он нужен ровно за тем же, зачем оригиналу: НЕ рисовать черту
     * непрочитанных перед последним сообщением (tweb bubbles.ts:11592
     * `readMaxId !== historyMaxId`).
     */
    getHistoryMaxSeq(peerId: number): number {
      return findDialog(peerId)?.lastMessage?.id ?? 0
    },

    /**
     * Порт `appMessagesManager.getDialogOnly` (tweb :4363-4365) в единственной
     * применимой форме — «строка диалога у меня есть». Спрашивает открытие по
     * ссылке (`appImManager.op`, `lib/appImManager.ts`): у нас публичный канал, в котором
     * пользователь не состоит, истории НЕ отдаёт (`chat_handler.go:499-502`,
     * 403 «not a member of this chat»), поэтому в него приходится вступать, а
     * лишний раз вступать в уже открытый канал — лишний round-trip.
     *
     * `await hydrate()`, а не голый `findDialog`, как у двух соседей выше:
     * вопрос задаётся ДО того, как зеркало объявило пробел (`fillMirror`), —
     * ровно то, ради чего разбор хэша и уехал в boot. Без гидратации ответ был
     * бы «диалога нет» на каждом холодном старте.
     */
    async hasDialog(peerId: number): Promise<boolean> {
      await hydrate()
      return !!findDialog(peerId)
    },

    /**
     * Контакты для правил папок `contacts`/`non_contacts`. Зовётся оттуда же,
     * откуда наполняется UI-стор (`stores/foldersStore.ts::loadFolders` →
     * `setContacts`): один источник, два потребителя — отдельного владения
     * контактами этап не заводит (спека, «Фильтр папки переезжает в воркер»).
     */
    setContactIds(ids: number[]): void {
      contactIds = new Set(ids)
      // Пустой список контактов — тоже ЗНАНИЕ (см. contactsKnown): до этого
      // вызова папка с правилом contacts/non_contacts честно отдаёт пустую
      // страницу, а не молча неверную.
      contactsKnown = true
    },

    /**
     * Task 5, «Осторожно» (смена аккаунта/логаут): гасит ОЖИДАЮЩИЙ таймер
     * (см. scheduleSave), пока он ещё не выстрелил, — экономит заведомо
     * бессмысленную запись устаревших диалогов (действие, чей REST-ответ
     * прилетел уже после логаута, успело бы запланировать саму запись, но не
     * успело её исполнить). Зовётся из workerCore.ts (onLoggingOut/
     * onLoggedIn) тем же приёмом, что `media.resetToken`/`resetDownloads` —
     * синхронно, ДО broadcast намерения перехода.
     *
     * Важно НЕ приписывать этому методу защиту от гонки «таймер уже
     * выстрелил, `saveDialogs()` в полёте (после `await locked()`, уже внутри
     * `enqueue()`), и тут приходит `persistClearAll()`» — от неё
     * `cancelPersist()` не защищает и защищать не должен: к этому моменту
     * отменять уже нечего. Гарантию даёт СУЩЕСТВУЮЩИЙ (до Task 5) механизм
     * `core/store/persist.ts`: `persistClearAll()` физически недостижим из
     * воркера иначе как через два кросс-контекстных RPC-раунда (воркер →
     * `broadcast(RT.loggingOut)` → main `useAuthGate.ts` →
     * `managers.persist.clearAll()` обратно в воркер) — на порядки медленнее
     * пары микротасков внутри самого воркера; а `enqueue()` того же стора
     * (`persist.ts`) батчит операции и открывает IndexedDB-транзакции В
     * ПОРЯДКЕ ВЫЗОВА, а IndexedDB исполняет readwrite-транзакции одного стора
     * в порядке их СОЗДАНИЯ, а не завершения (порядок фиксирует и комментарий
     * у `persistManager.clearAll`: «clear сериализуется после любых
     * накопленных воркером записей», актуален с до-Task-5 времён). Поэтому
     * `enqueue()` клира физически не может опередить уже вызванный `enqueue()`
     * записи диалогов — клир гарантированно ляжет ПОСЛЕ устаревшей записи, и
     * `cancelPersist()` тут ни при чём.
     *
     * Полный сброс самого кэша (`items`/`hydrated`) на логаут — `resetForLogout()`
     * ниже, отдельный метод (Task 6).
     */
    cancelPersist(): void {
      if (saveTimer) { clearTimeout(saveTimer); saveTimer = null }
    },

    /**
     * Task 6 (пины владения, приоритетная находка ревью Task 5): полный сброс
     * in-memory кэша владельца на логауте/смене аккаунта. `dialogsManager`
     * живёт в SharedWorker, который переживает `location.reload()` отдельной
     * вкладки, пока жива хотя бы одна другая, — без этого сброса `items`/
     * `hydrated` пережили бы логаут, и следующий `fillMirror()` (уже под ДРУГИМ
     * вошедшим пользователем) отдал бы готовый `items` вместо честной
     * регидратации с диска нового аккаунта — чужой список диалогов на экране.
     *
     * `items = []` обязателен, а не только `hydrated = false`: `doHydrate()`
     * перечитывает кэш с диска ТОЛЬКО когда `!items.length` (см. выше) — при
     * непустом `items` он молча оставил бы старые данные, даже сбросив флаг.
     * `pinnedOrders`/`pinnedOrder` тоже перезапишет ближайший
     * `doHydrate()` (он их читает безусловно), но обнуляем и здесь — с момента
     * `resetForLogout()` до следующего `fillMirror()`/`refresh()` кэш обязан
     * быть честно пуст, а не хранить обрывки прошлой сессии на случай, если
     * что-то дёрнет владельца в этом окне (напр. запоздавший realtime-кадр).
     *
     * Вызывается РЯДОМ с `cancelPersist()` — тем же приёмом, что
     * `media.resetToken()`/`resetDownloads()` (workerCore.ts, onLoggingOut/
     * onLoggedIn): каждый владелец сбрасывает СВОЙ кэш сам, отдельным вызовом.
     */
    resetForLogout(): void {
      // Minor #4: всё, что уже улетело под прошлым токеном (чтение диска в
      // doHydrate, ответ /chats в refresh), обязано осечься перед применением —
      // см. докблок sessionGen.
      sessionGen++
      items = []
      reloadPeers.clear()
      // Пачка строк с новым сообщением — тоже про прошлую сессию (tweb
      // `handleNewDialogs` и так пропустил бы снятые строки, а `items` пуст).
      newDialogsToHandle.clear()
      dialogsIndex = createSearchIndex()
      pinnedOrders = {}
      pinnedOrder = []
      // Этап 2: папки и признаки загруженности — тоже про ПРОШЛЫЙ аккаунт.
      // `dialogsLoaded` пережил бы логаут и заставил `getDialogs` нового
      // пользователя отвечать «всё уже загружено» из пустого кэша, не сходив в
      // сеть; `folders`/`contactIds` дали бы чужие правила фильтрации.
      folders = []
      contactIds = new Set()
      contactsKnown = false
      dialogsLoaded.all = false
      dialogsLoaded.archive = false
      serverCount.global = serverCount.all = serverCount.archive = null
      // Курсоры пагинации — тоже про ПРОШЛЫЙ аккаунт: `peerId` чужих чатов
      // бэкенд в выборке нового не найдёт и отдаст страницу с начала (то есть
      // молча, но неверно), а первая же страница нового пользователя обязана
      // идти от начала явно.
      serverCursor.global = serverCursor.all = serverCursor.archive = null
      hydrated = false
      hydrating = null
      // Сроки мьюта — тоже про ПРОШЛЫЙ аккаунт: таймер, доживший до нового,
      // снял бы переопределение у чата, которого больше нет в кэше.
      armMuteTimer(MUTE_UNTIL_FOREVER, 0)
    },

    /**
     * Ключ State, от которого зависит порядок, изменился (пишет persistManager).
     * Значения диалогов те же — публикуем reindex, а не reset.
     *
     * И по той же причине — `announce`, а не `publish` (Important #4): на диск
     * (`S_DIALOGS`) уезжают только значения диалогов, а они не изменились;
     * новый порядок целиком выводится из State-ключей, у которых свой писатель.
     */
    setStateKey(key: string, value: unknown): void {
      // Этап 2: определения папок — тот же канал, что pinnedOrders
      // (persistManager.stateKey → сюда). Порядок от них НЕ зависит, поэтому
      // ни пересортировки, ни reindex — только фильтр `getDialogs({filterId})`.
      if (key === 'folders') { folders = value as Folder[]; return }
      if (key !== 'pinnedOrders') return
      pinnedOrders = value as Record<number, number[]>
      pinnedOrder = pinnedOrders[ALL_FOLDER_ID] ?? []
      items = sort(items.map((i) => i.dialog))
      announce([{ op: 'reindex', items: items.map((i) => ({ peerId: i.dialog.peerId, index: i.index })) }])
    },

    // ── Task 3: realtime-кадры применяет владелец ────────────────────────────
    // Тела перенесены из chatsStore КАК ЕСТЬ (fallback `unread ?? +1`,
    // идемпотентность `applyRead`, абсолютный снимок `chat_update`); меняется
    // только выход — вместо `set({dialogs})` публикуем `patch`/`remove`.

    /** Новое сообщение (live `new_message`) поднимает диалог и бампит превью/unread. */
    applyNewMessage(e: NewMessageEvt): void {
      // Кадр несёт сообщение ЦЕЛИКОМ (форма `updateNewMessage`), поэтому и ключ
      // пира, и автор, и номер берутся из него, а не из россыпи полей конверта.
      const m = mapMessage(e.message, getMeId?.() ?? null)
      if (m._ === 'messageEmpty') return
      const cur = findDialog(m.peerId)
      if (!cur) return // unknown chat (приедет на следующей reset-загрузке)
      const meId = getMeId?.() ?? null
      // Счётчик считается ЗДЕСЬ, +1 на входящее, — ровно как у оригинала
      // (appMessagesManager). Авторитетного значения кадр больше не несёт: у
      // конструктора updateNewMessage такого параметра нет, а поле рядом с ним
      // было последним, что осталось вне конструктора. Авторитет приезжает
      // строкой диалога и кадром прочтения (still_unread_count).
      //
      // Своё же эхо (sender_id===meId, включая другие вкладки/устройства)
      // бейдж не бампит.
      //
      // Отступление от прежнего main-кода (chatsStore.applyNewMessage): там ещё
      // проверялся открытый на ЭТОЙ вкладке чат, чтобы не бампить ему бейдж.
      // Воркер общий на все вкладки и какая из них что смотрит — не знает;
      // открытый чат — `appImManager.chat` вкладки (спека docs/superpowers/specs/
      // 2026-08-12-dialogs-ownership-and-virtual-list-design.md, «Что остаётся на main»).
      // Блип бейджа для открытого чата гасит немедленный markRead активной вкладки.
      // Своё сообщение — ещё и `pFlags.out` (tweb `inboxUnread =
      // !message.pFlags.out && …`, appMessagesManager.ts:10498): у поста
      // канала автора в `from_id` нет (подписи выключены), и сравнение с собой
      // своё не узнаёт — свою копию поста сервер шлёт автору с `out`.
      const inboxUnread = m.fromId !== meId && !m.pFlags?.out
      // Защита от отката — порт tweb appMessagesManager.ts:10500-10520. Кадр
      // может нести сообщение, которое строка уже видела или видела более
      // новое: повтор журнала (`/sync`), дубль мимо дедупа по pts. Такое
      // сообщение не двигает ни превью, ни место строки (`mid >= top_message`),
      // а счётчик растёт только на действительно НОВОМ входящем, которое ещё
      // не покрыл курсор прочтения (`isPastReadCursor`). Условие `!isSaved`
      // оригинала у нас всегда истинно: `isSavedDialog` — подстрока «Избранного»
      // (`savedDialog`), а здесь только строки списка `dialog`.
      const isPastReadCursor = m.id <= cur.read_inbox_max_id
      const counters: Partial<Dialog> = {}
      if (inboxUnread && m.id > cur.top_message && !isPastReadCursor) {
        counters.unread_count = cur.unread_count + 1
        // Непрочитанное упоминание зрителя (сервер ставит упомянутому
        // pFlags.mentioned + media_unread) бампит бейдж «@» тем же кадром —
        // порт tweb appMessagesManager.ts:10510-10512.
        if (isMentionUnread(m)) counters.unread_mentions_count = cur.unread_mentions_count + 1
      }
      // Превью строится из ЦЕЛОГО сообщения — тем же единственным маппером
      // живого кадра, что и вставка в окно (`messages.cacheLive` зовёт его же).
      if (m.id >= cur.top_message) setDialogTopMessage(m, counters)
    },

    /**
     * Прочитано содержимое упоминаний (`updateReadPeerMessagesContents` по
     * сообщениям, которые были непрочитанным упоминанием) — бейдж «@» минус
     * столько же. Порт tweb `onUpdateReadMessagesContents`
     * (appMessagesManager.ts:11009-11016): решение «было ли упоминание
     * непрочитанным» принимается ДО снятия media_unread — его задаёт вызывающий
     * (воркер спрашивает окно сообщений до применения кадра).
     */
    applyMentionsRead(peerId: number, count: number): void {
      const cur = findDialog(peerId)
      if (!cur || count <= 0 || !cur.unread_mentions_count) return
      patchDialog(peerId, { unread_mentions_count: Math.max(0, cur.unread_mentions_count - count) })
    },

    /** `read` — моё прочтение гасит unread/горизонт, чужое двигает peerReadSeq (✓✓). */
    applyRead(e: ReadEvt): void {
      const peerId = getPeerId(e.peer)
      const cur = findDialog(peerId)
      if (!cur) return
      // Горизонт из кадра — СЕРВЕРНЫЙ номер; в модели он клиентский (см. toDialog).
      const upTo = generateMessageId(e.max_id)
      // Ветвление по КОНСТРУКТОРУ, а не сравнением `user_id` с собой: «прочитал
      // я» и «прочитали меня» — разные кадры схемы, и решает это сервер, на
      // рассылке. Прежде тот же вывод повторялся здесь, в проекторе и в ленте.
      if (e._ === 'updateReadHistoryInbox') {
        // Авторитетный счётчик из кадра verbatim (обычно 0).
        const unread = e.still_unread_count
        const readInbox = Math.max(cur.read_inbox_max_id, upTo)
        // Идемпотентность: повторное эхо того же прочтения (up_to_seq ≤ горизонта,
        // unread уже 0) НЕ публикует операцию — иначе на зеркале перезапустится
        // mark-read-эффект (деп win.msgs) и получится бесконечный цикл ре-рендера.
        if (unread === cur.unread_count && cur.unread_mentions_count === 0 && cur.unread_reactions_count === 0 && readInbox === cur.read_inbox_max_id) return
        patchDialog(peerId, {
          unread_count: unread,
          unread_mentions_count: 0,
          unread_reactions_count: 0,
          read_inbox_max_id: readInbox,
        })
      } else {
        // the OTHER side read my messages → advance the peer horizon (out ticks → ✓✓)
        const readOutbox = Math.max(cur.read_outbox_max_id, upTo)
        if (readOutbox === cur.read_outbox_max_id) return // no advance → no-op (без операции)
        patchDialog(peerId, { read_outbox_max_id: readOutbox })
      }
    },

    // Кто-то поставил реакцию на МОЁ сообщение → бампим бейдж непрочитанных
    // реакций диалога (Telegram unread_reactions_count). Сброс — на applyRead.
    bumpUnreadReactions(peerId: number, count?: number): void {
      const cur = findDialog(peerId)
      if (!cur) return
      // Авторитетный счётчик из кадра (reaction.unread_reactions) — verbatim, как
      // unread у new_message/read; локальный +1 — fallback, если поля нет.
      const value = typeof count === 'number' ? count : cur.unread_reactions_count + 1
      patchDialog(peerId, { unread_reactions_count: value })
    },

    /**
     * Удалённые сообщения снимаются со счётчика непрочитанного — порт tweb
     * `onUpdateDeleteMessages` (appMessagesManager.ts:11546-11548) с подсчётом
     * из `handleDeletedMessages` (:14082-14085): непрочитанное — ВХОДЯЩЕЕ
     * (`!pFlags.out`), которое ещё не покрыл горизонт прочтения. Флага
     * `unread` на сообщении у нас нет (`core/models.ts`), поэтому
     * «непрочитано» — сравнение с `read_inbox_max_id`, как у ленты
     * (`bubbles.ts::isUnreadByReadCursor`).
     *
     * Авторитет по-прежнему приезжает строкой диалога — сервер снимает
     * удалённое со счётчика сам (`ChatsRepo.ForgetUnread`).
     *
     * Удалено последнее сообщение — строка получает новое (там же,
     * :11577-11593): из низа истории, если он загружен, иначе строкой с
     * сервера (`reloadConversation`). Без этого превью в списке оставалось на
     * удалённом сообщении.
     */
    applyDeletedMessages(peerId: number, deleted: readonly MyMessage[]): void {
      const cur = findDialog(peerId)
      if (!cur) return
      const unread = cur.unread_count
        ? deleted.filter((m) => !m.pFlags?.out && m.id > cur.read_inbox_max_id).length
        : 0
      if (unread) patchDialog(peerId, { unread_count: Math.max(0, cur.unread_count - unread) })

      // Удалено ПОСЛЕДНЕЕ — строке нужно новое (tweb :11577-11593). Окно уже
      // без удалённого (эвикция идёт до этого вызова, как `history.delete` у
      // оригинала до цикла по диалогам). Низ истории известен и в нём есть
      // настоящие сообщения — последним становится `slice[0]`; иначе (чат не
      // открыт, низ не загружен, удалено всё) знает только сервер. Временные
      // номера не в счёт: строку, удалённую целиком с другого клиента, всё
      // равно надо перечитать.
      if (!deleted.some((m) => m.id === cur.top_message)) return
      const slice = messages?.getHistoryFirstSlice(peerId)
      const hasMessages = !!slice?.some((id) => !isLocalMessageId(id))
      const top = slice?.isEnd(SliceEnd.Bottom) && hasMessages ? messages?.getMessageByPeer(peerId, slice[0]) : undefined
      if (top) setDialogTopMessage(top)
      else reloadConversation(peerId)
    },

    /**
     * Вступил в broadcast-канал (`updateChannel`) — порт tweb `onUpdateChannel`
     * (appMessagesManager.ts:11605-11642): участник, у которого строки нет,
     * получает её перечитыванием (`reloadConversation`). Выбытие у нас — свой
     * кадр (`chat_removed` → applyRemoved), поэтому вторая половина оригинала
     * («не участник — убрать строку») здесь не нужна.
     */
    applyChannel(peerId: number): void {
      if (findDialog(peerId)) return
      reloadConversation(peerId)
    },

    // Меня удалили из группы / вышел сам (chat_removed) — диалог исчезает из списка.
    applyRemoved(peerId: number): void {
      const idx = items.findIndex((i) => i.dialog.peerId === peerId)
      if (idx === -1) return // не было в кэше — нечего убирать
      dialogsIndex.indexObject(peerId, '') // tweb dropDialog (dialogs.ts:1104)
      items = items.filter((i) => i.dialog.peerId !== peerId)
      publish([{ op: 'remove', peerId }])
    },

    // ── Task 4 (действия без оптимистики) ─────────────────────────────────────
    // Порт tweb: `invokeApi(...).then(saveUpdate)` — сеть уже подтвердила, ЗАТЕМ
    // применяем. Сетевые менеджеры (groupsManager/chatThemesManager) зовут эти
    // методы ПОСЛЕ успешного REST-ответа; при ошибке они не зовутся вовсе — см.
    // dialogsManager.test.ts «RPC упал — ни одной операции».

    /**
     * Пер-чатовые настройки уведомлений — то же, что несёт realtime-кадр
     * `dialog_mute` (бэкенд читает их из базы и кладёт в кадр ЦЕЛИКОМ).
     *
     * Принимает КОНСТРУКТОР, а не булево, и это не переименование аргумента:
     * мьют выражен СРОКОМ, и «заглушить на час» отличается от «навсегда» только
     * им. Прежняя сигнатура `(peerId, muted: boolean)` срок теряла — ровно на
     * ней и ломалась вся уже построенная цепочка.
     */
    /**
     * Черновик изменён (`updateDraftMessage`) — своим устройством или чужим.
     *
     * Применяет ВЛАДЕЛЕЦ диалогов, потому что черновик это поле диалога, и от
     * его даты зависит место строки в списке: patchDialog пересчитает индекс и
     * при сдвиге опубликует его вместе с патчем. Пока черновик жил отдельным
     * стором на главном потоке, порядок и превью строки собирались из двух
     * источников.
     *
     * «Черновик сняли» — `draftMessageEmpty`: в строке он не хранится, поле
     * просто исчезает.
     */
    applyDraft(peerId: number, draft: DraftMessage): void {
      patchDialog(peerId, { draft: draft._ === 'draftMessage' ? toClientDraft(draft) : undefined })
    },

    applyNotifySettings(peerId: number, settings: PeerNotifySettings): void {
      patchDialog(peerId, { notify_settings: settings })
      // Новый срок может оказаться ближайшим — пересчитываем расписание.
      scheduleMuteCheck()
    },

    /**
     * Переезд диалога В ПАПКУ (`updateFolderPeers`): архив это папка №1, общий
     * список — ноль. Прежняя сигнатура принимала `archived: boolean` и тем
     * подделывала значение признаком — на проводе номер папки был всегда, а до
     * менеджера доезжало «да/нет».
     *
     * Пин при переезде сбрасывается — как на бэке (grouprepo.SetArchived
     * обнуляет pinned_at): наборы закреплённых у папок раздельные.
     */
    applyFolder(peerId: number, folderId: number): void {
      patchDialog(peerId, {
        folder_id: folderId === WIRE_FOLDER_ARCHIVE ? WIRE_FOLDER_ARCHIVE : undefined,
        pFlags: undefined,
      })
    },

    /**
     * Пин/анпин двигает и ПОРЯДОК: свежий пин встаёт первым (порт tweb
     * `order.unshift`, dialogs.ts:934), анпин выпадает из порядка. Порядок
     * закреплённых — общий State-ключ на весь список (см. докблок ALL_FOLDER_ID
     * выше и прежний chatsStore.setDialogPinned, откуда перенесена логика).
     * Пишем на диск и рассылаем зеркало ключа тем же путём, что
     * `persistManager.stateKey` (`saveStateKey` + `mirrorStateKey` в
     * workerCore.ts) — второй писатель того же ключа не заводится.
     *
     * Fix (ревью Task 4, Critical): пин/анпин — ФАКТ (булево поле диалога), а не
     * команда «переставь». `order.unshift` оправдан только при РЕАЛЬНОМ переходе
     * `pinned` false↔true; повторный/запоздавший кадр того же уже применённого
     * факта (собственное WS-эхо — бэкенд шлёт `dialog_pin` на ВСЕ соединения
     * пользователя, включая инициировавшее: `backend/internal/adapter/delivery/
     * ws/hub.go:203-209`, во фрейме нет id соединения, фильтровать нечем) не
     * должен трогать уже устоявшийся `pinnedOrder` — иначе чат, запиненный
     * РАНЬШЕ, задним числом обгоняет чат, запиненный ПОЗЖЕ (порядок событий:
     * apply(1,true) → apply(2,true) → запоздавшее эхо apply(1,true) снова
     * бросало бы 1 на вершину, ломая [2,1,…] обратно на [1,2,…]). Гвард —
     * ровно та же идея, что `equal()` в `patchDialog`: нечего менять — не
     * трогаем ни кэш, ни диск, ни зеркало.
     *
     * Отличимость от «легитимного перепина уже закреплённого чата» (чтобы
     * снова всплыть наверх): такого действия в продукте НЕТ — UI показывает
     * либо «Pin» у незакреплённого чата, либо «Unpin» у закреплённого
     * (`ChatListItem.tsx`: `chat.pinned ? 'Unpin' : 'Pin'`), кнопки «запинить
     * заново уже запиненный, чтобы поднять его» не существует ни у нас, ни в
     * tweb (порядок закреплённых меняется явным drag'ом, которого в этом
     * клиенте тоже нет). Единственный путь получить `applyPinned(id, true)` с
     * уже `pinned===true` — дубль/эхо ОДНОГО И ТОГО ЖЕ действия. Различить
     * «дубль» от «легитимного намерения поднять» по одним лишь текущим данным
     * (без монотонного номера действия в кадре) НЕЛЬЗЯ — если такая фича
     * появится, `dialog_pin` придётся снабдить версией/меткой времени.
     */
    applyPinned(peerId: number, pinned: boolean): void {
      const idx = items.findIndex((i) => i.dialog.peerId === peerId)
      if (idx === -1) return
      const cur = items[idx].dialog
      if (!!cur.pFlags?.pinned === pinned) return // факт уже применён — не переставляем и не пишем повторно
      const others = pinnedOrder.filter((id) => id !== peerId)
      pinnedOrder = pinned ? [peerId, ...others] : others
      pinnedOrders = { ...pinnedOrders, [ALL_FOLDER_ID]: pinnedOrder }
      void savePinnedOrders?.(pinnedOrders)
      mirrorStateKey?.('pinnedOrders', pinnedOrders)
      // «Выключено» у булева флага схемы — ОТСУТСТВИЕ ключа, не `false`.
      const pFlags = pinned ? ({ pinned: true } as const) : undefined
      const dialog = merge(cur, { pFlags })
      items = sort(items.map((i) => (i.dialog.peerId === peerId ? dialog : i.dialog)))
      publish([
        { op: 'patch', peerId, fields: { pFlags } },
        { op: 'reindex', items: items.map((i) => ({ peerId: i.dialog.peerId, index: i.index })) },
      ])
    },
  }
}
export type DialogsManager = ReturnType<typeof newDialogsManager>
