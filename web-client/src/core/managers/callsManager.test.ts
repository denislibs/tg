import { describe, expect, it } from 'vitest'
import type { RestClient } from '../net/restClient'
import { newCallsManager } from './callsManager'

describe('callsManager.iceConfig', () => {
  it('ice_servers и ttl ответа /calls/ice — в RTCIceServer[] и ttlSeconds; креды только у TURN', async () => {
    const rest = {
      get: async (path: string) => {
        expect(path).toBe('/calls/ice')
        return {
          ice_servers: [
            { urls: ['stun:stun.test:19302'] },
            { urls: ['turn:t.test:3478?transport=udp'], username: '1792184773:7', credential: 'c' },
          ],
          ttl: 86_400,
        }
      },
    } as unknown as RestClient
    expect(await newCallsManager({ rest }).iceConfig()).toEqual({
      servers: [
        { urls: ['stun:stun.test:19302'] },
        { urls: ['turn:t.test:3478?transport=udp'], username: '1792184773:7', credential: 'c' },
      ],
      ttlSeconds: 86_400,
    })
  })
})
