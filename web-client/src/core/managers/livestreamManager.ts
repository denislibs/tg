import type { RestClient } from '../net/restClient'

// RTMP-трансляции (Telegram livestream). Менеджер — тонкая обёртка REST:
// старт/стоп/revoke доступны только админу (бэк вернёт 403 иначе), статус —
// любому участнику (креды в нём приходят только админу).

// Ответ статуса/старта/revoke. rtmp_url/stream_key присутствуют только у админа.
interface RawLivestream {
  active: boolean
  viewers: number
  is_admin: boolean
  started_at?: string
  rtmp_url?: string
  stream_key?: string
}

export interface LivestreamStatus {
  active: boolean
  viewers: number
  isAdmin: boolean
  startedAt?: string
  /** URL RTMP-сервера для OBS (только админ) */
  rtmpUrl?: string
  /** секретный ключ трансляции для OBS (только админ) */
  streamKey?: string
}

function map(r: RawLivestream): LivestreamStatus {
  return {
    active: r.active,
    viewers: r.viewers ?? 0,
    isAdmin: r.is_admin,
    startedAt: r.started_at,
    rtmpUrl: r.rtmp_url,
    streamKey: r.stream_key,
  }
}

interface LivestreamDeps {
  rest: RestClient
}

export function newLivestreamManager({ rest }: LivestreamDeps) {
  return {
    // Статус трансляции чата (активна ли, число зрителей; креды — только админу).
    async status(chatId: number): Promise<LivestreamStatus> {
      return map(await rest.get<RawLivestream>(`/chats/${chatId}/livestream`))
    },
    // Запустить трансляцию (админ) → в ответе креды для OBS.
    async start(chatId: number): Promise<LivestreamStatus> {
      return map(await rest.post<RawLivestream>(`/chats/${chatId}/livestream/start`, {}))
    },
    // Завершить трансляцию (админ).
    async stop(chatId: number): Promise<void> {
      await rest.post(`/chats/${chatId}/livestream/stop`, {})
    },
    // Перевыпустить stream key (админ) → новые креды.
    async revokeKey(chatId: number): Promise<LivestreamStatus> {
      return map(await rest.post<RawLivestream>(`/chats/${chatId}/livestream/revoke_key`, {}))
    },
  }
}

export type LivestreamManager = ReturnType<typeof newLivestreamManager>
