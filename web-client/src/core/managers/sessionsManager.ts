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

interface RawSession {
  id: number
  name: string
  platform: string
  last_active: string
  current: boolean
  ip: string
  location: string
}

const mapSession = (s: RawSession): Session => ({
  id: s.id,
  name: s.name,
  platform: s.platform,
  lastActive: s.last_active,
  current: s.current,
  ip: s.ip,
  location: s.location,
})

interface SessionsDeps {
  rest: RestClient
}

export function newSessionsManager({ rest }: SessionsDeps) {
  return {
    async list(): Promise<Session[]> {
      const r = await rest.get<{ sessions: RawSession[] }>('/sessions')
      return (r.sessions ?? []).map(mapSession)
    },

    /** Terminate one session; its token dies and its sockets are force-closed. */
    async terminate(id: number): Promise<void> {
      await rest.del(`/sessions/${id}`)
    },

    /** «Terminate All Other Sessions» — everything except the current one. */
    async terminateOthers(): Promise<number> {
      const r = await rest.del<{ ok: boolean; revoked: number }>('/sessions/others')
      return r.revoked
    },
  }
}

export type SessionsManager = ReturnType<typeof newSessionsManager>
