import type { RestClient } from '../net/restClient'

// One active session (device) as the UI uses it — the settings «Active
// Sessions» screen. `current` marks this very session.
export interface Session {
  id: number
  name: string // human device name, e.g. "Chrome · macOS" (parsed from the UA at sign-in)
  platform: string // client-sent platform, e.g. "browser"
  lastActive: string
  current: boolean
  ip: string
  location: string // GeoIP place, may be empty
}

/**
 * `authorization` — сессия устройства конструктором схемы.
 *
 * «Текущая» — ФЛАГ, а не булево поле рядом: его ОТСУТСТВИЕ и есть «не текущая».
 * Даты в СЕКУНДАХ эпохи. Адрес сессии зовётся `hash` — имя схемы.
 */
export interface AuthorizationWire {
  _: 'authorization'
  pFlags?: { current?: true }
  hash: number
  device_model: string
  platform: string
  date_created: number
  date_active: number
  ip: string
  country: string
}

export interface AccountAuthorizations {
  _: 'account.authorizations'
  authorization_ttl_days: number
  authorizations: AuthorizationWire[]
}

const mapSession = (s: AuthorizationWire): Session => ({
  id: s.hash,
  name: s.device_model,
  platform: s.platform,
  lastActive: new Date(s.date_active * 1000).toISOString(),
  current: !!s.pFlags?.current,
  ip: s.ip,
  location: s.country,
})

interface SessionsDeps {
  rest: RestClient
}

export function newSessionsManager({ rest }: SessionsDeps) {
  return {
    async list(): Promise<Session[]> {
      const r = await rest.get<AccountAuthorizations>('/sessions')
      return (r.authorizations ?? []).map(mapSession)
    },

    /** Terminate one session; its token dies and its sockets are force-closed. */
    async terminate(id: number): Promise<void> {
      await rest.del(`/sessions/${id}`)
    },

    /** «Terminate All Other Sessions» — everything except the current one. */
    async terminateOthers(): Promise<void> {
      // Числа отозванных в ответе нет: его не читал никто, а список сессий
      // экран перезапрашивает.
      await rest.del('/sessions/others')
    },
  }
}

export type SessionsManager = ReturnType<typeof newSessionsManager>
