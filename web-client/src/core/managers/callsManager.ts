import type { RestClient } from '../net/restClient'
import type { UserReal } from '../peers/peer'
import { mapMyMessage, type MyMessage, type RawMyMessage } from '../models'

// ICE-конфиг для WebRTC-звонков: STUN + TURN с эфемерными кредами
// (бэк подписывает их HMAC'ом от секрета coturn — GET /calls/ice).
interface RawIce {
  ice_servers: { urls: string[]; username?: string; credential?: string }[]
  ttl: number
}

export interface IceConfig {
  servers: RTCIceServer[]
  ttlSeconds: number
}

/**
 * Журнал звонков — вектор СООБЩЕНИЙ плюс вектор пиров, ровно как история чата.
 *
 * Собственной проводной формы `CallLogEntry{id, peer_id, peer, out, text, date}`
 * у него больше нет: это была одна из десяти форм сообщения на проводе (решение
 * Р5), причём с вклеенной в КАЖДУЮ запись карточкой собеседника. Теперь запись
 * журнала это `messageService` с `messageActionPhoneCall`, а карточки едут
 * общим вектором `users` — так же собирает вкладку «Звонки» и оригинал.
 */
export interface CallLog {
  messages: MyMessage[]
  users: UserReal[]
}

interface CallsDeps {
  rest: RestClient
  /** id зрителя — маппер уточняет им служебное действие (см. mapMyMessage). */
  getMeId?: () => number | null
  /** Приёмник пиров ответа: карточки собеседников едут вектором `users`, и о
   *  них обязан узнать ВЛАДЕЛЕЦ зеркала, а не вкладка записью напрямую. */
  peers?: { saveApiPeers(o: { users?: UserReal[] }): void }
}

export function newCallsManager({ rest, getMeId, peers }: CallsDeps) {
  return {
    async iceConfig(): Promise<IceConfig> {
      const r = await rest.get<RawIce>('/calls/ice')
      return {
        servers: (r.ice_servers ?? []).map((s) => ({
          urls: s.urls,
          ...(s.username ? { username: s.username, credential: s.credential } : {}),
        })),
        ttlSeconds: r.ttl ?? 3600,
      }
    },
    // Журнал звонков (вкладка «Звонки»), новые сверху.
    async log(offset = 0, limit = 40): Promise<CallLog> {
      const r = await rest.get<{ messages: RawMyMessage[]; users: UserReal[] }>(`/calls?offset=${offset}&limit=${limit}`)
      const meId = getMeId?.() ?? null
      peers?.saveApiPeers({ users: r.users })
      return { messages: (r.messages ?? []).map((m) => mapMyMessage(m, meId)), users: r.users ?? [] }
    },
  }
}

export type CallsManager = ReturnType<typeof newCallsManager>
