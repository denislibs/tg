import { describe, it, expect, beforeEach, vi } from 'vitest'

// Управляемый мок конфига: флаг флипаем в тестах.
const { state } = vi.hoisted(() => ({ state: { enabled: false, serverStaticPublicKeys: [] as string[] } }))
vi.mock('../../config/app', () => ({ AppConfig: { dnp: state } }))
vi.mock('./dnp', () => ({ makeDnpTransport: vi.fn(() => ({ type: 'DnpTransport' })) }))

import { createTransport } from './createTransport'
import { WsClient } from './wsClient'
import { makeDnpTransport } from './dnp'

describe('createTransport', () => {
  beforeEach(() => { state.enabled = false })

  it('returns PlainTransport (WsClient) when DNP disabled', () => {
    expect(createTransport()).toBeInstanceOf(WsClient)
  })

  it('calls makeDnpTransport when enabled (guarded flag)', () => {
    state.enabled = true
    createTransport()
    expect(makeDnpTransport).toHaveBeenCalled()
  })
})
