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
  }
}

export type CallsManager = ReturnType<typeof newCallsManager>
