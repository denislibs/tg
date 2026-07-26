import type { RestClient } from '../net/restClient'

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

// Запись журнала звонков (вкладка «Звонки»). text — JSON лога звонка
// {video, reason, duration}, парсится тем же parseCallLog, что и чат-бабл.
export interface CallLogEntry {
  id: number
  chatId: number
  peerId: number
  peerName: string
  peerAvatar: string
  out: boolean
  text: string
  date: string
}
interface RawCallLog {
  id: number
  chat_id: number
  peer_id: number
  peer_name: string
  peer_avatar?: string
  out: boolean
  text: string
  date: string
}
const mapCall = (c: RawCallLog): CallLogEntry => ({
  id: c.id, chatId: c.chat_id, peerId: c.peer_id,
  peerName: c.peer_name, peerAvatar: c.peer_avatar ?? '',
  out: c.out, text: c.text, date: c.date,
})

interface CallsDeps {
  rest: RestClient
}

export function newCallsManager({ rest }: CallsDeps) {
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
    async log(offset = 0, limit = 40): Promise<CallLogEntry[]> {
      const r = await rest.get<{ calls: RawCallLog[] }>(`/calls?offset=${offset}&limit=${limit}`)
      return (r.calls ?? []).map(mapCall)
    },
  }
}

export type CallsManager = ReturnType<typeof newCallsManager>
