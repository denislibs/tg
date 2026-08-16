// src/core/managers/peersManager.ts
import { HttpError, type RestClient } from '../net/restClient'
import { saveUsers, loadUsers } from '../store/persist'

export interface Peer {
  id: number
  username: string
  displayName: string
  avatarUrl: string
  /** stripped-превью аватарки (base64 JPEG, `avatar_preview`; '' у старых аватарок) */
  avatarPreview: string
}

// Stage 1C.2 (Task 2): операция над карточками пиров — ЧТО изменилось в кэше
// владельца, а не снимок кэша. Форма взята у операций над окном сообщений
// (core/realtime/messageOps.ts, этап 1B): порождает их ТОЛЬКО воркер
// (peersManager — единственный, кто решает, что карточка изменилась),
// переигрывает — только проектор (client/realtime/storeProjection.ts).
// Отдельного модуля (как messageOps.ts) под них нет намеренно: там модуль несёт
// applyOp с нетривиальной семантикой дедупа/слияния, здесь операции ложатся 1:1
// на уже существующий публичный API стора (upsert/patch) и своей логики не
// имеют — файл состоял бы из одного type.
//   upsert — карточки целиком (ответ на объявленный пробел зеркала; замена уже
//     лежавшей карточки). Массив, а не по одной, чтобы ответ на пачку ids доехал
//     одним кадром и лёг в стор одним set() — поштучные операции будили бы
//     подписчиков byId по разу на карточку.
//   patch — точечно изменившиеся поля известной карточки (realtime user_update:
//     имя/username приходят прямо в кадре, ходить за ними в сеть не нужно).
export type PeerOp =
  | { op: 'upsert'; peers: Peer[] }
  | { op: 'patch'; id: number; fields: Partial<Peer> }

/**
 * Владелец карточек пиров (Stage 1C.2, Task 2). Второго вывода нет: витрина
 * (`core/peerCache.ts`) — зеркало, её единственный писатель — проектор по `onPeerOps`.
 *
 * Публикация ровно двумя поводами, и оба про зеркало:
 *  1. **Значение изменилось** — карточка, которая уже лежала в кэше, заменена
 *     другой (перечитывание протухшей, патч имени по `user_update`). Только
 *     такая и может разъехаться с зеркалом, поэтому её обязаны объявить.
 *  2. **Зеркало объявило пробел** (`fillMirror`) — владелец отвечает операцией.
 *
 * Чего НЕ публикуем: карточку, которой в кэше ещё не было. Зеркало — подмножество
 * кэша (в стор попадает только пришедшее отсюда, а из кэша ничего не выселяется),
 * значит новую карточку зеркало держать не может и разъехаться на ней не с чем.
 * Именно это и делает дешёвыми двенадцать «объёмных» чтений, которые рисуют по
 * возвращённому массиву и в зеркало не смотрят (`useGroupInfo`,
 * `useGroupEdit`, `PinnedMessagesScreen`, `callEngine`, `uiNotifications`,
 * `useStoryViewer`, `useMessageActions`): открыть инфо группы на 500 участников —
 * ноль кадров и в первый раз, и в каждый следующий.
 *
 * `onPeerOps` опционален только ради юнит-тестов самого менеджера (проверяют
 * маппинг/кэш без веера); в проде его задаёт workerCore, и это покрыто
 * отдельным пином — workerCore.test.ts.
 */
export function newPeersManager({ rest, onPeerOps }: { rest: Pick<RestClient, 'get'>; onPeerOps?: (ops: PeerOp[]) => void }) {
  const cache = new Map<number, Peer>()
  // id, чья карточка в кэше заведомо протухла (realtime user_update с
  // avatar_changed: url аватара приватен per-viewer и в кадре не приходит).
  // Карточку продолжаем ОТДАВАТЬ — ровно ту же, что показывает витрина, — но
  // следующий getUsers обязан сходить за ней в сеть. Это замена прежнего
  // cache.delete(id): выселение делало кэш воркера пустым, тогда как витрина
  // держала старый avatarUrl, — два разных состояния одного факта.
  const stale = new Set<number>()

  const publish = (ops: PeerOp[]) => onPeerOps?.(ops)
  // id совпадают по построению (сравниваем разные версии одной карточки).
  const same = (a: Peer, b: Peer) => a.username === b.username && a.displayName === b.displayName && a.avatarUrl === b.avatarUrl && a.avatarPreview === b.avatarPreview

  /**
   * Общее тело чтения (сеть → кэш → офлайн-фолбэк). Само НИЧЕГО не публикует:
   * поводы объявить у вызывающих разные, и решают они. Возвращает и ответ целиком
   * (`peers`), и подмножество `changed` — карточки, ЗАМЕНИВШИЕ те, что уже лежали
   * в кэше. Только на них зеркало и может разъехаться с владельцем.
   */
  async function resolve(ids: number[]): Promise<{ peers: Peer[]; changed: Peer[] }> {
    const missing = ids.filter((id) => !cache.has(id) || stale.has(id))
    const changed: Peer[] = []
    if (missing.length) {
      try {
        const r = await rest.get<{ users: { id: number; username: string; display_name: string; avatar_url: string; avatar_preview?: string | null }[] }>('/users', { ids: missing.join(',') })
        const fetched: Peer[] = (r.users ?? []).map((u) => ({ id: u.id, username: u.username, displayName: u.display_name, avatarUrl: u.avatar_url, avatarPreview: u.avatar_preview ?? '' }))
        for (const u of fetched) {
          const prev = cache.get(u.id)
          cache.set(u.id, u); stale.delete(u.id)
          // Сервер вернул то же самое (перечитали протухшую, а аватар на деле не
          // менялся) — объявлять нечего: кадр во все вкладки стоит дороже, чем
          // сравнение четырёх полей.
          if (prev && !same(prev, u)) changed.push(u)
        }
        void saveUsers(fetched) // write-through в офлайн-стор (нормализовано по id)
      } catch (e) {
        // Сеть недоступна — поднимаем персистнутых юзеров в память, чтобы имена/
        // аватары резолвились офлайн. Не глотаем HTTP-ошибки (401/500 и т.п.).
        // Протухшую карточку персист не чинит (там лежит тот же старый аватар),
        // поэтому метку в stale не снимаем — следующий getUsers сходит снова.
        if (e instanceof HttpError) throw e
        // avatarPreview нормализуем: записи, персистнутые до Task 9, поля не имеют.
        for (const u of await loadUsers()) if (!cache.has(u.id)) cache.set(u.id, { ...u, avatarPreview: u.avatarPreview ?? '' })
      }
    }
    return { peers: ids.map((id) => cache.get(id)).filter((p): p is Peer => !!p), changed }
  }

  // Чтение для тех, кто рисует по возвращённому массиву (двенадцать мест, см.
  // докблок фабрики). Объявляем только замену — впервые заведённая карточка
  // зеркалу не адресована.
  async function getUsers(ids: number[]): Promise<Peer[]> {
    const { peers, changed } = await resolve(ids)
    if (changed.length) publish([{ op: 'upsert', peers: changed }])
    return peers
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
   * Почему поводом служит именно объявленный пробел, а не «мы это ещё ни разу не
   * публиковали»: `SuperMessagePort` не буферизует события, а веер уходит только
   * в ПОДКЛЮЧЁННЫЕ порты (`workerScope.ts:51`). «Опубликовано хоть раз» поэтому
   * не значит «есть у каждой вкладки»: вкладка, открытая позже, ничего не
   * получает задним числом, а `usePeers` за уже спрошенным id второй раз не
   * пойдёт (эффект завязан на `key`, пробел считается по стору) — она осталась бы
   * без имён навсегда. Пробел же объявляет тот, кто его наблюдает.
   *
   * ВНИМАНИЕ на будущее: наполнить зеркало может ТОЛЬКО этот вызов (и объявление
   * изменившегося факта). Обычный `getUsers` карточку в стор не кладёт — раньше
   * клал, и это маскировало бы забытый пробел. Значит новый читатель зеркала
   * обязан либо идти через `usePeers` (тот объявляет пробел сам), либо объявить
   * его тут же: иначе он молча покажет пустоту. Сегодня читатель ровно один —
   * `usePeers`, см. пометку у него.
   */
  async function fillMirror(ids: number[]): Promise<void> {
    // Ровно один кадр на вызов: ответ на пробел уже содержит всё, что изменилось,
    // поэтому берём `resolve` напрямую, а не `getUsers` — иначе на одном вызове
    // публиковались бы два кадра (`changed` внутри и весь ответ здесь), второй из
    // которых no-op в сторе, но полная сериализация в каждый порт.
    const { peers } = await resolve(ids)
    if (peers.length) publish([{ op: 'upsert', peers }])
  }

  // Инвалидация по realtime user_update. ЕДИНСТВЕННОЕ правило, и живёт оно
  // здесь: витрина ничего не решает, она переигрывает опубликованное.
  // Неизвестного пира не заводим — его никто не рисует (кэш воркера — надмножество
  // витрины: всё, что попало в стор, пришло отсюда же).
  function applyUserUpdate(evt: { id: number; username: string; display_name: string; avatar_changed: boolean }): void {
    const cur = cache.get(evt.id)
    if (!cur) return
    if (cur.username !== evt.username || cur.displayName !== evt.display_name) {
      const updated: Peer = { ...cur, username: evt.username, displayName: evt.display_name }
      cache.set(evt.id, updated)
      void saveUsers([updated])
      publish([{ op: 'patch', id: evt.id, fields: { username: evt.username, displayName: evt.display_name } }])
    }
    if (!evt.avatar_changed) return
    // Аватар сменился, но url в кадре не несут (он приватен per-viewer — сервер
    // применяет PrivacyProfilePhoto на /users). Помечаем карточку протухшей и
    // перечитываем сами: раньше за этим ходила витрина (refresh + upsert), и
    // при упавшем до-фетче она оставалась со старым аватаром, а кэш воркера — ни
    // с чем. Теперь до-фетч один, и до его успеха обе стороны показывают старую
    // карточку. Не удалось — метка осталась, сходим на следующем getUsers.
    // Объявлять результат отдельно не нужно: до-фетч заменяет уже лежавшую
    // карточку, а замену getUsers публикует сам (и молчит, если сервер вернул
    // ту же самую — объявлять тогда нечего).
    stale.add(evt.id)
    void getUsers([evt.id]).catch(() => {})
  }

  return { getUsers, fillMirror, applyUserUpdate }
}
export type PeersManager = ReturnType<typeof newPeersManager>
