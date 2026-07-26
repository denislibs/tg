import type { RestClient } from '../net/restClient'

export interface PushSub { endpoint: string; p256dh: string; auth: string }

export function newPushManager({ rest }: { rest: Pick<RestClient, 'get' | 'post'> }) {
  return {
    async vapidKey(): Promise<string> {
      const r = await rest.get<{ public_key: string }>('/push/vapid_public_key')
      return r.public_key
    },
    async subscribe(sub: PushSub): Promise<{ ok: boolean }> {
      return rest.post<{ ok: boolean }>('/push/subscribe', sub)
    },
  }
}

export type PushManager = ReturnType<typeof newPushManager>
