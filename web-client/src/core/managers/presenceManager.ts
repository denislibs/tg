import type { RestClient } from '../net/restClient'
import type { PresenceEvt } from '../realtime/events'
import type { UserStatus } from '../peers/peer'

/** `contactStatus` — СТРОКА снимка присутствия: ссылка на пользователя плюс
 *  его статус объединением. Прежде та же пара ехала безымянным словарём внутри
 *  обёртки `{presence: […]}` — и клиент типизировал её КАДРОМ
 *  (`updateUserStatus`), которого сервер не присылал. */
interface ContactStatus { _: 'contactStatus'; user_id: number; status: UserStatus }

interface RestLike {
  get: RestClient['get']
}

// Fetches the initial online / last-seen snapshot for a set of users. Live
// updates then arrive via rt:presence; this just seeds the state on open.
export function newPresenceManager({ rest }: { rest: RestLike }) {
  return {
    async get(ids: number[]): Promise<PresenceEvt[]> {
      if (!ids.length) return []
      const r = await rest.get<ContactStatus[]>('/presence', { ids: ids.join(',') })
      // Витрина отдаёт СТРОКИ снимка, а стору нужны КАДРЫ: перевод один и
      // здесь — раньше строку выдавали за кадр, просто не проверяя.
      return (r ?? []).map((c) => ({ _: 'updateUserStatus', user_id: c.user_id, status: c.status }) as PresenceEvt)
    },
  }
}

export type PresenceManager = ReturnType<typeof newPresenceManager>
