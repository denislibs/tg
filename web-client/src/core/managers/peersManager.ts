// src/core/managers/peersManager.ts
import { HttpError, type RestClient } from '../net/restClient'
import { saveUsers as persistUsers, loadUsers } from '../store/persist'
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
 * Публикация ровно двумя поводами, и оба про зеркало:
 *  1. **Значение изменилось** — карточка, которая уже лежала в кэше, заменена
 *     другой (перечитывание, кадр `user_update`, новый снимок чата из
 *     `chat_update`). Только такая и может разъехаться с зеркалом.
 *  2. **Зеркало объявило пробел** (`fillMirror`) — владелец отвечает операцией.
 *
 * Чего НЕ публикуем: карточку, которой в кэше ещё не было. Зеркало —
 * подмножество кэша (в него попадает только пришедшее отсюда, а из кэша ничего
 * не выселяется), значит новую карточку зеркало держать не может и разъехаться
 * на ней не с чем. Именно это делает дешёвыми «объёмные» чтения, которые рисуют
 * по возвращённому массиву и в зеркало не смотрят.
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

  const publish = (peers: (User | Chat)[]) => { if (peers.length) onPeerOps?.([{ op: 'upsert', peers }]) }
  // Карточка — абсолютный снимок, поэтому сравниваем её целиком (тот же
  // предикат, что у зеркала: `peerCache::samePeer`). Ручной список полей
  // приходилось бы расширять при каждом новом поле пира — и он молча отставал.
  const same = (a: User | Chat, b: User | Chat) => JSON.stringify(a) === JSON.stringify(b)

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
  function save(peers: readonly (User | Chat)[]): (User | Chat)[] {
    const changed: (User | Chat)[] = []
    const persist: UserReal[] = []
    for (const peer of peers) {
      const key = peerKey(peer)
      const prev = cache.get(key)
      if (prev && same(prev, peer)) continue
      cache.set(key, peer)
      if (prev) changed.push(peer)
      if (peer._ === 'user') persist.push(peer)
    }
    if (persist.length) void persistUsers(persist) // write-through в офлайн-стор
    return changed
  }

  /** Приёмник карточек из ответа, объявляющий замены. Единственная точка, где
   *  «карточка приехала попутно» превращается в кадр для зеркала. */
  function saveApiPeers(peers: readonly (User | Chat)[] | undefined | null): void {
    if (!peers?.length) return
    publish(save(peers))
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
        changed = save(r.users ?? [])
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
    publish(save([user]))
  }

  return { getPeers, getUsers, saveApiPeers, fillMirror, applyUserUpdate }
}
export type PeersManager = ReturnType<typeof newPeersManager>
