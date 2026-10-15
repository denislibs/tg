// src/core/managers/peersManager.ts
import { HttpError, type RestClient } from '../net/restClient'
import { saveUsers as persistUsers, loadUsers, saveChats as persistChats, loadChats } from '../store/persist'
import { peerKey, type Channel, type Chat, type User, type UserReal } from '../peers/peer'
import { getPeerId, isUser, toUserId, type Peer } from '../peers/peerId'
import type { PresenceEvt } from '../realtime/events'
import type { InputMedia } from '@layer'

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
/**
 * `onUserStatus` — приёмник статуса из карточки: порт `saveUserStatus` внутри
 * `appUsersManager.saveApiUser` (tweb `appUsersManager.ts:700`). У оригинала
 * статус — поле самого `user`, и любой ответ с вектором `users` обновляет его
 * заодно с карточкой. У нас присутствие живёт отдельным стором на главном
 * потоке (`chatsStore.presence`), поэтому владелец карточек отдаёт статус туда
 * тем же кадром, каким его шлёт сервер, — `updateUserStatus` (`RT.presence`).
 */
export function newPeersManager({ rest, onPeerOps, onUserStatus, onChatToggleForum, onContactToggle, onSelfUser }: {
  rest: Pick<RestClient, 'get'>
  onPeerOps?: (ops: PeerOp[]) => void
  onUserStatus?: (evt: PresenceEvt) => void
  /** tweb `chat_toggle_forum` (`appChatsManager.ts:268`, `:304-306`): у
   *  известной карточки чата сменился `pFlags.forum`. Слушает хранилище тем. */
  onChatToggleForum?: (peerId: PeerId, enabled: boolean) => void
  /** Своя карточка пришла кадром `user_update` (другое устройство сменило
   *  эмодзи-статус, включило Premium). Приёмник — `me` воркера: tweb держит
   *  себя в том же кэше `users`, а у нас `me` живёт отдельно, и карточки «я» в
   *  кэше пиров может не быть вовсе. */
  onSelfUser?: (user: UserReal) => void
  /** tweb `onContactUpdated(userId, newContact, wasContact)` (`appUsersManager.ts:
   *  738-754`): у карточки сменился `pFlags.contact`. Владелец книги двигает
   *  индекс и объявляет `contacts_update`. */
  onContactToggle?: (userId: number, isContact: boolean, wasContact: boolean) => void
}) {
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
   * Порт `appChatsManager.saveApiChat` в части слияния с лежащей карточкой
   * (tweb `appChatsManager.ts:229-244`, `:163-177`): что из пришедшего
   * `channel` НЕ затирает известное.
   *
   *  • `participants_count` не приехал — остаётся прежний (`:239-244`).
   *  • `min`-конструктор (`:229-231`, форма слияния — `:163-177`). У
   *    оригинала `min`-канал поверх известного отбрасывается целиком: в
   *    MTProto это устаревшая выжимка, а полный канал зрителя сервер шлёт
   *    сам. У нас `min` — это снимок `chat_update` (backend
   *    `ChatRecord.ToChannel`, `ViewerID == 0`): он ЕДИНСТВЕННЫЙ носитель
   *    смены названия/фото/настроек в реальном времени, поэтому отбросить
   *    его нельзя. Сливаем по образцу min-ветки того же `saveApiChat`
   *    (`:165-176`): общее — из пришедшего, а пер-зрительское (членство
   *    `creator`/`left`, `admin_rights`, действующие запреты зрителя `banned_rights`, дата
   *    вступления `date`) — из лежащего. Без этого создатель после смены
   *    фото группы оставался без своих прав.
   *  • Чего в `min` нет вовсе, то остаётся от лежащей карточки. Второй
   *    источник `min` — ссылка на чат, который зрителю не читается (заголовок
   *    пересылки, автор send-as; backend `ChatRecord.Hidden`): у такого нет
   *    ни числа участников, ни `default_banned_rights`, и затирать ими
   *    известное значило бы снова блокировать ввод (A1-01).
   *
   * Слитая карточка уже полная — `min` с неё снимается.
   */
  function mergeApiChat(prev: User | Chat, next: User | Chat): User | Chat {
    if (next._ !== 'channel' || prev._ !== 'channel') return next
    let out: Channel = next
    if (out.participants_count === undefined && prev.participants_count) {
      out = { ...out, participants_count: prev.participants_count }
    }
    if (!out.pFlags?.min) return out
    const { min: _min, creator: _creator, left: _left, ...shared } = out.pFlags
    const pFlags: NonNullable<Channel['pFlags']> = { ...shared }
    if (prev.pFlags?.creator) pFlags.creator = true
    if (prev.pFlags?.left) pFlags.left = true
    const merged: Channel = { ...out, pFlags, date: prev.date }
    delete merged.admin_rights
    delete merged.banned_rights
    if (prev.admin_rights) merged.admin_rights = prev.admin_rights
    if (prev.banned_rights) merged.banned_rights = prev.banned_rights
    if (!merged.default_banned_rights && prev.default_banned_rights) merged.default_banned_rights = prev.default_banned_rights
    return merged
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
  function save(peers: readonly (User | Chat)[]): { written: (User | Chat)[]; replaced: (User | Chat)[]; afterPublish: () => void } {
    const written: (User | Chat)[] = []
    const replaced: (User | Chat)[] = []
    const persist: UserReal[] = []
    // Карточки чатов персистятся ТОЖЕ (шаг C диалогов): имя и аватарка группы
    // уехали из строки диалога в вектор `chats` контейнера `/chats`, и без
    // офлайн-копии холодный старт БЕЗ СЕТИ показал бы группы без имён — то, что
    // раньше давал сам персист диалогов.
    const persistChatCards: Chat[] = []
    const toggledForum: [PeerId, boolean][] = []
    const toggledContact: [number, boolean][] = []
    for (const incoming of peers) {
      // Статус — СВЕЖИЙ снимок сервера, поэтому отдаётся и тогда, когда
      // карточка целиком совпала с лежащей: между двумя снимками присутствие
      // могло смениться кадром, и снимок обязан его поправить.
      if (incoming._ === 'user' && incoming.status) {
        onUserStatus?.({ _: 'updateUserStatus', user_id: incoming.id, status: incoming.status })
      }
      const key = peerKey(incoming)
      const prev = cache.get(key)
      const peer = prev ? mergeApiChat(prev, incoming) : incoming
      if (prev && same(prev, peer)) continue
      cache.set(key, peer)
      indexUsername(peer, prev)
      written.push(peer)
      if (prev) replaced.push(peer)
      if (prev && peer._ === 'channel' && prev._ === 'channel' && !!prev.pFlags?.forum !== !!peer.pFlags?.forum) {
        toggledForum.push([key, !!peer.pFlags?.forum])
      }
      // Книга двигается на ЗАМЕНЕ карточки со сменой флага (tweb :738-754). Новая
      // карточка книгу не трогает: её читает fillContacts, он же её перестраивает.
      if (prev && peer._ === 'user' && prev._ === 'user' && !!prev.pFlags?.contact !== !!peer.pFlags?.contact) {
        toggledContact.push([peer.id, !!peer.pFlags?.contact])
      }
      if (peer._ === 'user') persist.push(peer)
      else if (peer._ !== 'userEmpty') persistChatCards.push(peer)
    }
    if (persist.length) void persistUsers(persist) // write-through в офлайн-стор
    if (persistChatCards.length) void persistChats(persistChatCards)
    for (const [peerId, enabled] of toggledForum) onChatToggleForum?.(peerId, enabled)
    // Книга двигается ПОСЛЕ объявления карточки зеркалу (tweb: `mirrorUser`, затем
    // `onContactUpdated`, :749-760): подписчик `contacts_update` читает свежую карточку.
    const afterPublish = () => {
      for (const [userId, isContact] of toggledContact) onContactToggle?.(userId, isContact, !isContact)
    }
    return { written, replaced, afterPublish }
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
    const saved = save(peers)
    publish(saved.written)
    saved.afterPublish()
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
  async function resolve(peerIds: PeerId[]): Promise<{ peers: (User | Chat)[]; changed: (User | Chat)[]; afterPublish: () => void }> {
    const missing = peerIds.filter((id) => isUser(id) && !cache.has(id)).map(toUserId)
    let changed: (User | Chat)[] = []
    let afterPublish = (): void => {}
    if (missing.length) {
      try {
        // Ответ — сам вектор `Vector<User>`: обёртки `{users}` у ручки нет.
        const users = await rest.get<UserReal[]>('/users', { ids: missing.join(',') })
        const saved = save(users ?? [])
        changed = saved.replaced
        afterPublish = saved.afterPublish
      } catch (e) {
        // Сеть недоступна — поднимаем персистнутых юзеров в память, чтобы имена
        // и аватарки резолвились офлайн. Не глотаем HTTP-ошибки (401/500 и т.п.).
        if (e instanceof HttpError) throw e
        for (const u of await loadUsers()) if (!cache.has(peerKey(u))) cache.set(peerKey(u), u)
      }
    }
    return { peers: peerIds.map((id) => cache.get(id)).filter((p): p is User | Chat => !!p), changed, afterPublish }
  }

  /** Чтение для тех, кто рисует по возвращённому массиву. Объявляем только
   *  замену — впервые заведённая карточка зеркалу не адресована. */
  async function getPeers(peerIds: PeerId[]): Promise<(User | Chat)[]> {
    const { peers, changed, afterPublish } = await resolve(peerIds)
    publish(changed)
    afterPublish()
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
    const { peers, afterPublish } = await resolve(peerIds)
    publish(peers)
    afterPublish()
  }

  /**
   * Кадр `user_update` — АБСОЛЮТНЫЙ снимок карточки: `{user, pts}`, где `user`
   * это конструктор целиком. Прежний кадр вместо этого сообщал `display_name`
   * (имени на проводе больше нет) и флажок `avatar_changed`, из-за которого
   * карточку приходилось перезапрашивать отдельной ручкой; на упавшем до-фетче
   * витрина оставалась со старым аватаром, а кэш воркера — ни с чем.
   *
   * Порт `saveApiUser` (tweb `appUsersManager.ts:663-782`): карточка сохраняется
   * и когда её в кэше ещё не было (`oldUser === undefined` → `mirrorUser`), —
   * так приходит «добавил в контакты» со второго устройства про человека, чью
   * карточку этот воркер ещё не читал. Объявляется всё записанное, как в
   * `saveApiPeers`. Неизвестный контакт двигает книгу: у tweb книга — полный
   * список `getContacts`, у нас ленивый, и без этого вызова новый контакт не
   * попал бы в индекс до следующего чтения книги.
   */
  function applyUserUpdate(user: UserReal): void {
    if (!user) return
    // Своя карточка идёт в `me` воркера: tweb держит себя в том же кэше `users`
    // (`saveApiUser` :663-782, `checkPremium` :793-800 сверяет признак Premium
    // именно у неё), а у нас `me` живёт отдельно.
    if (user.pFlags?.self) onSelfUser?.(user)
    const key = peerKey(user)
    const known = cache.has(key)
    const saved = save([user])
    publish(saved.written)
    saved.afterPublish()
    if (!known && user.pFlags?.contact) onContactToggle?.(user.id, true, false)
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
   * Порт `appUsersManager.resolveUsername` (tweb `appUsersManager.ts:380-397`):
   * СНАЧАЛА индекс имён, и только на промахе — ОДИН `contacts.resolveUsername`
   * (у нас `GET /contacts/resolve_username`), чей ответ прогоняется через
   * сохранение пиров (`processResolvedPeer`, tweb `:405-410`): оба вектора
   * ложатся в кэш (вместе с ними наполняется и индекс имён), пир достаётся по
   * ссылке `peer`.
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
   * Отказ — `USERNAME_NOT_OCCUPIED` / `USERNAME_INVALID` сервера: имя отказа
   * переживает границу воркера (`superMessagePort.ts:239-252` кладёт
   * `HttpError.type` в `errorType`), и вызывающий ветвится по нему, как
   * `showUsernameResolveError` (tweb `internalLinkProcessor.ts:75-81`,
   * `appImManager.ts:2175-2178`).
   */
  async function resolveUsername(username: string): Promise<User | Chat> {
    const name = username.replace(/^@+/, '').trim().toLowerCase()
    if (!name) throw new HttpError(400, 'USERNAME_INVALID', 'USERNAME_INVALID')

    await hydrateFromDisk()
    const cached = usernames.get(name)
    const peer = cached !== undefined ? cache.get(cached) : undefined
    if (peer) return peer

    const resolved = await rest.get<{ peer: Peer; chats?: Chat[]; users?: UserReal[] }>(
      '/contacts/resolve_username', { username: name })
    saveApiPeers(resolved)
    const found = cache.get(getPeerId(resolved.peer))
    if (!found) throw new HttpError(400, 'USERNAME_NOT_OCCUPIED', 'USERNAME_NOT_OCCUPIED')
    return found
  }

  /**
   * Порт `appUsersManager.getContactMediaInput` (tweb `appUsersManager.ts:977-988`):
   * визитка пользователя глазами ОТПРАВИТЕЛЯ — имя, фамилия и номер, как карточка
   * их несёт (скрытый номер — пустая строка), vcard пуст, `user_id: id` — как у
   * tweb (:986): из него бабл берёт `user_id` (`appMessagesManager.ts:4041`). На
   * провод он не уходит — в схеме у `inputMediaContact` его нет, а сервер
   * привязывает аккаунт по номеру (В-10); срезает его `connectionManager`.
   * Карточки нет — ошибка, как у tweb (`getUser(id)` без записи).
   */
  function getContactMediaInput(userId: number): InputMedia.inputMediaContact {
    const user = cache.get(userId)
    if (user?._ !== 'user') throw new Error(`getContactMediaInput: нет карточки пользователя ${userId}`)
    return {
      _: 'inputMediaContact',
      first_name: user.first_name ?? '',
      last_name: user.last_name ?? '',
      phone_number: user.phone ?? '',
      vcard: '',
      user_id: userId,
    }
  }

  return { getPeers, getUsers, saveApiPeers, fillMirror, applyUserUpdate, cachedPeer, hydrateFromDisk, resolveUsername, getContactMediaInput }
}
export type PeersManager = ReturnType<typeof newPeersManager>
