import { describe, it, expect, beforeEach, vi } from 'vitest'

// Управляемый мок конфига: флаг флипаем в тестах.
const { state } = vi.hoisted(() => ({ state: { enabled: false, serverStaticPublicKeys: [] as string[] } }))
vi.mock('../../config/app', () => ({ AppConfig: { dnp: state } }))

import { createTransport } from './createTransport'
import { WsClient } from './wsClient'

describe('createTransport', () => {
  beforeEach(() => { state.enabled = false })

  it('returns PlainTransport (WsClient) when DNP disabled', () => {
    expect(createTransport()).toBeInstanceOf(WsClient)
  })

  it('throws via DNP stub when enabled (guarded flag)', () => {
    state.enabled = true
    expect(() => createTransport()).toThrow('not implemented yet (PR-1b)')
  })
})
