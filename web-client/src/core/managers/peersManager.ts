// src/core/managers/peersManager.ts
import { HttpError, type RestClient } from '../net/restClient'
import { saveUsers as persistUsers, loadUsers, saveChats as persistChats, loadChats } from '../store/persist'
import { peerKey, type Chat, type User, type UserReal } from '../peers/peer'
import { isUser, toUserId } from '../peers/peerId'

// Карточка пира — КОНСТРУКТОР схемы (`user` / `channel` / …), а не плоская
// выдумка. Прежний `Peer {id, username, displayName, avatarUrl, avatarPreview}`
// исчез целиком: `display_name` с провода убран (имя собирает клиент —
// `core/peers/getPeerTitle.ts`), а пять полей аватарки схлопнулись в
// `photo: UserProfilePhoto` с готовым `photo_id` — тем самым, которого ждёт
// воркерный `downloadMediaURL`. Регулярка `/media/(\d+)/content`, выпарсивавшая
// id медиа из нашей же строки, вместе с ними ушла.
export type { Chat, User, UserReal }

// Операция над карточками пиров — ЧТО изменилось в кэше владельца, а не снимок
// кэша. Форма взята у операций над окном сообщений (core/realtime/messageOps.ts):
// порождает их ТОЛЬКО воркер (peersManager — единственный, кто решает, что
// карточка изменилась), переигрывает — только проектор
// (client/realtime/storeProjection.ts).
//
// Операция ОДНА. Прежний `patch` (точечные поля известной карточки) больше не
// нужен: кадр `user_update` несёт конструктор `user` ЦЕЛИКОМ — абсолютный
// снимок, — а не выборку изменившихся полей рядом с флажком `avatar_changed`,
// по которому карточку приходилось перезапрашивать отдельной ручкой. Вместе с
// флажком ушёл и весь механизм `stale`: перечитывать нечего, кадр самодостаточен.
//
// Массив, а не по одной карточке, чтобы ответ на пачку ids доехал одним кадром
// и лёг в зеркало одним пробуждением подписчиков.
export type PeerOp = { op: 'upsert'; peers: (User | Chat)[] }

/**
 * Владелец карточек пиров. Второго вывода нет: витрина (`core/peerCache.ts`) —
 * зеркало, её единственный писатель — проектор по `onPeerOps`.
 *
 * Публикация тремя поводами, и все три про зеркало:
 *  1. **Значение изменилось** — карточка, которая уже лежала в кэше, заменена
 *     другой (перечитывание, кадр `user_update`). Только такая и может
 *     разъехаться с зеркалом.
 *  2. **Зеркало объявило пробел** (`fillMirror`) — владелец отвечает операцией.
 *  3. **Пир приехал попутно с ответом** (`saveApiPeers`) — публикуется всё
 *     записанное, включая ещё не виданную карточку. Порт `saveApiChat`/
 *     `saveApiUser`, которые зеркалят и в ветке «карточки не было»; без этого
 *     конструктор `channel` в зеркало не попадал бы вовсе — за карточками чатов
 *     ходить нечем (см. `resolve`). Подробности — в докблоке `saveApiPeers`.
 *
 * Чего НЕ публикуют ЧТЕНИЯ (`getPeers`/`getUsers`): карточку, которой в кэше
 * ещё не было. Зеркало — подмножество кэша (в него попадает только пришедшее
 * отсюда, а из кэша ничего не выселяется), значит новую карточку зеркало
 * держать не может и разъехаться на ней не с чем. Именно это делает дешёвыми
 * «объёмные» чтения, которые рисуют по возвращённому массиву и в зеркало не
 * смотрят.
 *
 * ── Два вида пира, одно хранилище ───────────────────────────────────────────
 * В оригинале карточки живут в двух менеджерах (`appUsersManager` /
 * `appChatsManager`), а третий (`appPeersManager`) сводит их к одному ключу.
 * У нас сведение сделано СРАЗУ, на уровне хранилища: ключ — знаковый `PeerId`,
 * значение — конструктор. Расхождение с формой оригинала осознанное и
 * единственное: разделять хранилище незачем, различающий признак (`_`) едет
 * внутри самой карточки, а весь наш код спрашивает пира по ключу.
 *
 * `onPeerOps` опционален только ради юнит-тестов самого менеджера; в проде его
 * задаёт workerCore, и это покрыто отдельным пином — workerCore.test.ts.
 */
export function newPeersManager({ rest, onPeerOps }: { rest: Pick<RestClient, 'get'>; onPeerOps?: (ops: PeerOp[]) => void }) {
  const cache = new Map<PeerId, User | Chat>()
  /**
   * Индекс `публичное имя → ключ пира` — порт `appUsersManager.usernames`
   * (tweb `appUsersManager.ts:350`). Держится СБОКУ от кэша карточек и ведётся
   * там же, где карточка кладётся в кэш (`modifyUsernamesCache` зовётся из
   * `saveApiUser`/`saveApiChat`, tweb `appUsersManager.ts:518-533`), — именно
   * поэтому `resolveUsername` у оригинала попадает в кэш ещё до того, как
   * загружен список диалогов.
   */
  const usernames = new Map<string, PeerId>()

  const publish = (peers: (User | Chat)[]) => { if (peers.length) onPeerOps?.([{ op: 'upsert', peers }]) }
  // Карточка — абсолютный снимок, поэтому сравниваем её целиком (тот же
  // предикат, что у зеркала: `peerCache::samePeer`). Ручной список полей
  // приходилось бы расширять при каждом новом поле пира — и он молча отставал.
  const same = (a: User | Chat, b: User | Chat) => JSON.stringify(a) === JSON.stringify(b)

  /** Публичное имя пира. У `user` и `channel` параметр свой, у базового `chat`
   *  он объявлен, но не производится (см. докблок `Chat` в `peers/peer.ts`),
   *  поэтому спрашиваем наличие, а не конструктор. */
  const peerUsername = (peer: User | Chat): string | undefined =>
    ('username' in peer ? peer.username : undefined) || undefined

  /**
   * Порт `setUsernameToCache`/`modifyUsernamesCache` (tweb
   * `appUsersManager.ts:518-546`): СНЯТЬ прежнее имя и поставить новое. Снятие
   * обязательно — иначе переименованный канал вечно резолвился бы по старому
   * имени, которого у него уже нет.
   */
  function indexUsername(peer: User | Chat, prev?: User | Chat): void {
    const oldName = prev && peerUsername(prev)?.toLowerCase()
    const newName = peerUsername(peer)?.toLowerCase()
    if (oldName === newName) return
    if (oldName && usernames.get(oldName) === peerKey(peer)) usernames.delete(oldName)
    if (newName) usernames.set(newName, peerKey(peer))
  }

  /**
   * Положить карточки в кэш. Возвращает подмножество `changed` — те, что
   * ЗАМЕНИЛИ уже лежавшие. Только на них зеркало и может разъехаться с
   * владельцем, поэтому объявлять надо ровно их.
   *
   * Порт `appUsersManager.saveApiUsers` / `appChatsManager.saveApiChats`:
   * приёмник карточек из ЛЮБОГО ответа — списка диалогов (`peer`), карточки
   * чата (`chat_full.chats`), поиска (`contacts.found`), `send_as`. В
   * оригинале ровно так же каждый ответ прогоняется через сохранение пиров, и
   * это единственная причина, по которой имена и аватарки вообще есть у
   * объектов, за которыми никто отдельно не ходил.
   */
  function save(peers: readonly (User | Chat)[]): { written: (User | Chat)[]; replaced: (User | Chat)[] } {
    const written: (User | Chat)[] = []
    const replaced: (User | Chat)[] = []
    const persist: UserReal[] = []
    // Карточки чатов персистятся ТОЖЕ (шаг C диалогов): имя и аватарка группы
    // уехали из строки диалога в вектор `chats` контейнера `/chats`, и без
    // офлайн-копии холодный старт БЕЗ СЕТИ показал бы группы без имён — то, что
    // раньше давал сам персист диалогов.
    const persistChatCards: Chat[] = []
    for (const peer of peers) {
      const key = peerKey(peer)
      const prev = cache.get(key)
      if (prev && same(prev, peer)) continue
      cache.set(key, peer)
      indexUsername(peer, prev)
      written.push(peer)
      if (prev) replaced.push(peer)
      if (peer._ === 'user') persist.push(peer)
      else if (peer._ !== 'userEmpty') persistChatCards.push(peer)
    }
    if (persist.length) void persistUsers(persist) // write-through в офлайн-стор
    if (persistChatCards.length) void persistChats(persistChatCards)
    return { written, replaced }
  }

  /**
   * Приёмник пиров ЛЮБОГО ответа, несущего векторы `chats`/`users`. Форма
   * аргумента — 1:1 с оригиналом (`appPeersManager.saveApiPeers(object:
   * {chats?, users?})`, `appPeersManager.ts:33-36`): на проводе эти два вектора
   * едут ВМЕСТЕ внутри `messages.chatFull` / `users.userFull`, поэтому и
   * принимаются вместе, а не двумя вызовами.
   *
   * ⚠ ЗДЕСЬ ПУБЛИКУЕТСЯ ВСЁ ЗАПИСАННОЕ, включая карточку, которой в кэше ещё не
   * было, — в отличие от `getPeers`, который объявляет только замены. Это не
   * послабление правила владельца, а форма оригинала: `saveApiChat`/
   * `saveApiUser` зеркалят В ОБЕИХ ветках — и когда карточки не было
   * (`oldChat === undefined` → `mirrorChat(chat)`, `appChatsManager.ts:174-177`;
   * `appUsersManager.ts:619-621`), и после замены (`:198-199` / `:649-650`).
   *
   * Для ЧАТА иначе и нельзя. Батчевой ручки за карточками чатов нет (см.
   * `resolve` ниже — ключи чатов он обслуживает только из кэша), поэтому
   * правило «новую карточку не объявляем» означало бы, что конструктор
   * `channel` не попадает в зеркало НИКОГДА, кроме случайного совпадения, когда
   * пробел объявили уже после похода за карточкой. Ровно это и держало
   * предикаты по ключу (`isChannelPeer` и соседи в `core/peerCache.ts`) вечно
   * ложными.
   *
   * Кто зовёт: карточка чата (`groupsManager.card` — порт
   * `appProfileManager.saveFullPeerResult`, `:224-227`) и кадр `chat_update`
   * (`workerCore.ts::dispatch` — порт `apiUpdatesManager.processUpdateMessage`,
   * `:239-240`, где пиры апдейта сохраняются ДО его применения).
   */
  function saveApiPeers(object: { chats?: readonly Chat[]; users?: readonly UserReal[] } | undefined | null): void {
    if (!object) return
    const peers: (User | Chat)[] = [...(object.chats ?? []), ...(object.users ?? [])]
    if (!peers.length) return
    publish(save(peers).written)
  }

  /**
   * Общее тело чтения (сеть → кэш → офлайн-фолбэк). Само НИЧЕГО не публикует:
   * поводы объявить у вызывающих разные, и решают они.
   *
   * Ходить умеем только за ПОЛЬЗОВАТЕЛЯМИ: батчевой ручки для чатов на проводе
   * нет и в оригинале тоже нет — карточка чата приезжает с карточкой (`/chats/
   * {peerID}/card`) или кадром `chat_update`. Ключи чатов из запроса поэтому
   * обслуживаются кэшем и молчат, если его нет: это не потеря, а отсутствие
   * источника.
   */
  async function resolve(peerIds: PeerId[]): Promise<{ peers: (User | Chat)[]; changed: (User | Chat)[] }> {
    const missing = peerIds.filter((id) => isUser(id) && !cache.has(id)).map(toUserId)
    let changed: (User | Chat)[] = []
    if (missing.length) {
      try {
        const r = await rest.get<{ users: UserReal[] }>('/users', { ids: missing.join(',') })
        changed = save(r.users ?? []).replaced
      } catch (e) {
        // Сеть недоступна — поднимаем персистнутых юзеров в память, чтобы имена
        // и аватарки резолвились офлайн. Не глотаем HTTP-ошибки (401/500 и т.п.).
        if (e instanceof HttpError) throw e
        for (const u of await loadUsers()) if (!cache.has(peerKey(u))) cache.set(peerKey(u), u)
      }
    }
    return { peers: peerIds.map((id) => cache.get(id)).filter((p): p is User | Chat => !!p), changed }
  }

  /** Чтение для тех, кто рисует по возвращённому массиву. Объявляем только
   *  замену — впервые заведённая карточка зеркалу не адресована. */
  async function getPeers(peerIds: PeerId[]): Promise<(User | Chat)[]> {
    const { peers, changed } = await resolve(peerIds)
    publish(changed)
    return peers
  }

  /** То же для мест, которым нужны именно пользователи (участники, контакты,
   *  реагировавшие): ключ пользователя совпадает с его id, поэтому это тот же
   *  вызов с сужением результата. */
  async function getUsers(userIds: PeerId[]): Promise<UserReal[]> {
    const peers = await getPeers(userIds)
    return peers.filter((p): p is UserReal => p._ === 'user')
  }

  /**
   * Запрос ЗЕРКАЛА: витрина объявляет, каких карточек ей не хватает (`usePeers`
   * считает этот пробел по своему же зеркалу — единственный, кто его знает).
   * Ответ уходит не вызывающему, а операцией во все вкладки: зеркало общее,
   * и повторное применение идемпотентно (`upsert` диффит).
   *
   * Публикуем ВЕСЬ ответ, включая попадания в кэш: карточку мог вытянуть другой
   * хук или другая вкладка, и «публиковать только изменения кэша» означало бы,
   * что при попадании зеркало не получает ничего и карточка не доезжает никогда.
   *
   * Почему поводом служит именно объявленный пробел, а не «мы это ещё ни разу
   * не публиковали»: `SuperMessagePort` не буферизует события, а веер уходит
   * только в ПОДКЛЮЧЁННЫЕ порты (`workerScope.ts:51`). Вкладка, открытая позже,
   * ничего не получает задним числом, а `usePeers` за уже спрошенным id второй
   * раз не пойдёт — она осталась бы без имён навсегда.
   *
   * ВНИМАНИЕ на будущее: наполнить зеркало может ТОЛЬКО этот вызов (и
   * объявление изменившегося факта). Обычный `getPeers` карточку в зеркало не
   * кладёт — раньше клал, и это маскировало бы забытый пробел.
   */
  async function fillMirror(peerIds: PeerId[]): Promise<void> {
    // Ровно один кадр на вызов: ответ на пробел уже содержит всё, что
    // изменилось, поэтому берём `resolve` напрямую, а не `getPeers` — иначе на
    // одном вызове публиковались бы два кадра.
    const { peers } = await resolve(peerIds)
    publish(peers)
  }

  /**
   * Кадр `user_update` — АБСОЛЮТНЫЙ снимок карточки: `{user, pts}`, где `user`
   * это конструктор целиком. Прежний кадр вместо этого сообщал `display_name`
   * (имени на проводе больше нет) и флажок `avatar_changed`, из-за которого
   * карточку приходилось перезапрашивать отдельной ручкой; на упавшем до-фетче
   * витрина оставалась со старым аватаром, а кэш воркера — ни с чем.
   *
   * Неизвестного пира не заводим — правило владельца: карточку, которой в кэше
   * ещё не было, зеркало держать не может, и объявлять её некому.
   */
  function applyUserUpdate(user: UserReal): void {
    if (!user || !cache.has(peerKey(user))) return
    publish(save([user]).replaced)
  }

  /**
   * Синхронное чтение кэша ВНУТРИ воркера — порт `appPeersManager.getPeer`
   * (`:87-91`). Нужно владельцу диалогов: вид чата больше не приезжает строкой
   * (решение Р8), и правило папок «группы/каналы» задаёт вопрос конструктору
   * `Chat`, а не полю `type`. Своей копии карточек владелец диалогов не держит —
   * это и был бы второй источник того же факта.
   */
  function cachedPeer(peerId: PeerId): User | Chat | undefined {
    return cache.get(peerId)
  }

  /**
   * Поднять персистнутые карточки в память — офлайн-старт. Зовёт владелец
   * диалогов перед тем, как отдать наверх кэш с диска: без карточек список
   * покажет группы без имён, а правило папок посчитает их «любыми группами» по
   * фолбэку.
   *
   * Ничего не публикует: зеркало главного потока наполняет объявленный пробел
   * (`fillMirror`), а не побочный эффект чтения диска — правило владельца.
   */
  async function hydrateFromDisk(): Promise<void> {
    if (cache.size) return
    const [users, chats] = await Promise.all([loadUsers(), loadChats()])
    for (const p of [...users, ...chats]) if (!cache.has(peerKey(p))) { cache.set(peerKey(p), p); indexUsername(p) }
  }

  /**
   * Порт `appUsersManager.resolveUsername` (tweb `appUsersManager.ts:344-359`):
   * СНАЧАЛА индекс имён, и только на промахе — ОДИН запрос, чей ответ
   * прогоняется через сохранение пиров (`processResolvedPeer`, tweb
   * `appUsersManager.ts:368-373`).
   *
   * До этого порта имя резолвил СКАН ВИТРИНЫ ДИАЛОГОВ на главном потоке
   * (`useUrlSync.ts`), то есть открытие по ссылке было заперто за загрузкой
   * списка чатов — у оригинала же `onHashChange` стоит ДО неё
   * (tweb `appImManager.ts:834` против `appDialogsManager.ts:726`). Поэтому
   * первым делом поднимаем карточки с диска: у оригинала кэш к моменту разбора
   * хэша уже поднят (`await apiManagerProxy.loadAllStates()`, tweb
   * `index.ts:455`, стоит раньше `bootstrapIm()`), и попадание в него сети не
   * стоит вовсе.
   *
   * Отличие от оригинала одно, и оно в ручке: `contacts.resolveUsername` у нас
   * нет, ближайший эквивалент — директория `GET /search` (тот же конструктор
   * `contacts.found`, тот же один запрос). Совпадение проверяется ТОЧНО по
   * имени: директория ищет префиксом (`searchrepo.go::SearchChats`, `ILIKE
   * 'q%'`), и без сверки `@lenta` открывал бы `lenta_news`.
   *
   * Отказ — `USERNAME_NOT_OCCUPIED` оригинала: имя отказа переживает границу
   * воркера (`superMessagePort.ts:239-252` кладёт `HttpError.type` в
   * `errorType`), и вызывающий ветвится по нему, как `openUsername`
   * (tweb `appImManager.ts:1801-1809`).
   */
  async function resolveUsername(username: string): Promise<User | Chat> {
    const name = username.replace(/^@+/, '').trim().toLowerCase()
    if (!name) throw new HttpError(400, 'username invalid', 'USERNAME_INVALID')

    await hydrateFromDisk()
    const cached = usernames.get(name)
    const peer = cached !== undefined ? cache.get(cached) : undefined
    if (peer) return peer

    const found = await rest.get<{ chats?: Chat[]; users?: UserReal[] }>('/search', { q: name })
    // Порт `processResolvedPeer` (tweb :368-373): ответ сначала СОХРАНЯЕТСЯ —
    // вместе с ним наполняется и индекс имён, — и только потом из него
    // выбирается пир.
    saveApiPeers(found)
    const match = [...(found.chats ?? []), ...(found.users ?? [])]
      .find((p) => peerUsername(p)?.toLowerCase() === name)
    if (!match) throw new HttpError(404, 'username not occupied', 'USERNAME_NOT_OCCUPIED')
    return match
  }

  return { getPeers, getUsers, saveApiPeers, fillMirror, applyUserUpdate, cachedPeer, hydrateFromDisk, resolveUsername }
}
export type PeersManager = ReturnType<typeof newPeersManager>
