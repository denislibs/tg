import type { RestClient } from '../net/restClient'
import type { UserReal } from '../peers/peer'

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
  /** ключ разговора = id собеседника (приватный диалог): прежняя пара
   *  `chatId` + `peerId` описывала одно и то же двумя числами. */
  peerId: PeerId
  /** собеседник — конструктор `user` целиком; имя собирает клиент
   *  (`core/peers/getPeerTitle.ts`), аватарка это `peer.photo.photo_id`.
   *  Прежние `peerName`/`peerAvatar` были плоским снимком пользователя рядом
   *  с настоящим — вторым источником тех же данных. */
  peer: UserReal
  out: boolean
  text: string
  date: string
}
interface RawCallLog {
  id: number
  peer_id: PeerId
  peer: UserReal
  out: boolean
  text: string
  date: string
}
const mapCall = (c: RawCallLog): CallLogEntry => ({
  id: c.id, peerId: c.peer_id, peer: c.peer,
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
