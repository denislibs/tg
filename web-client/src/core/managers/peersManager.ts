// src/core/managers/peersManager.ts
import { HttpError, type RestClient } from '../net/restClient'
import { saveUsers, loadUsers } from '../store/persist'

export interface Peer { id: number; username: string; displayName: string; avatarUrl: string }

// Stage 1C.2 (Task 2): операция над карточками пиров — ЧТО изменилось в кэше
// владельца, а не снимок кэша. Форма взята у операций над окном сообщений
// (core/realtime/messageOps.ts, этап 1B): порождает их ТОЛЬКО воркер
// (peersManager — единственный, кто решает, что карточка изменилась),
// переигрывает — только проектор (client/realtime/storeProjection.ts).
// Отдельного модуля (как messageOps.ts) под них нет намеренно: там модуль несёт
// applyOp с нетривиальной семантикой дедупа/слияния, здесь операции ложатся 1:1
// на уже существующий публичный API стора (upsert/patch) и своей логики не
// имеют — файл состоял бы из одного type.
//   upsert — карточки целиком (ответ /users, подъём из офлайн-стора). Массив, а
//     не по одной, чтобы ответ на пачку ids доехал одним кадром и лёг в стор
//     одним set() — поштучные операции будили бы подписчиков byId по разу на
//     карточку (сегодня это один upsert(peers) на весь ответ).
//   patch — точечно изменившиеся поля известной карточки (realtime user_update:
//     имя/username приходят прямо в кадре, ходить за ними в сеть не нужно).
export type PeerOp =
  | { op: 'upsert'; peers: Peer[] }
  | { op: 'patch'; id: number; fields: Partial<Peer> }

/**
 * Владелец карточек пиров (Stage 1C.2, Task 2). Второго вывода нет: витрина
 * (peersStore) — зеркало, её единственный писатель — проектор по `onPeerOps`.
 * Поэтому публиковать обязан КАЖДЫЙ путь, которым карточка тут появляется или
 * меняется: ответ `/users`, подъём из офлайн-стора, патч по `user_update`,
 * до-фетч после смены аватара.
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

  const publish = (ops: PeerOp[]) => { if (ops.length) onPeerOps?.(ops) }

  async function getUsers(ids: number[]): Promise<Peer[]> {
    const missing = ids.filter((id) => !cache.has(id) || stale.has(id))
    if (missing.length) {
      try {
        const r = await rest.get<{ users: { id: number; username: string; display_name: string; avatar_url: string }[] }>('/users', { ids: missing.join(',') })
        const fetched: Peer[] = (r.users ?? []).map((u) => ({ id: u.id, username: u.username, displayName: u.display_name, avatarUrl: u.avatar_url }))
        for (const u of fetched) { cache.set(u.id, u); stale.delete(u.id) }
        void saveUsers(fetched) // write-through в офлайн-стор (нормализовано по id)
      } catch (e) {
        // Сеть недоступна — поднимаем персистнутых юзеров в память, чтобы имена/
        // аватары резолвились офлайн. Не глотаем HTTP-ошибки (401/500 и т.п.).
        // Протухшую карточку персист не чинит (там лежит тот же старый аватар),
        // поэтому метку в stale не снимаем — следующий getUsers сходит снова.
        if (e instanceof HttpError) throw e
        for (const u of await loadUsers()) if (!cache.has(u.id)) cache.set(u.id, u)
      }
    }
    const resolved = ids.map((id) => cache.get(id)).filter((p): p is Peer => !!p)
    // Публикуем ВЕСЬ ответ, а не только до-фетченное. Попадание в кэш — обычное
    // дело (карточку уже спросил другой хук или другая вкладка), и «публиковать
    // только изменения кэша» означало бы, что при попадании витрина не получает
    // ничего и карточка не доезжает до неё никогда.
    publish(resolved.length ? [{ op: 'upsert', peers: resolved }] : [])
    return resolved
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
    stale.add(evt.id)
    void getUsers([evt.id]).catch(() => {})
  }

  return { getUsers, applyUserUpdate }
}
export type PeersManager = ReturnType<typeof newPeersManager>
