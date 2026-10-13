// Глобальные настройки уведомлений на конструкторах схемы: адрес — ключ
// `notifyUsers|notifyChats|notifyBroadcasts` (tweb `appNotificationsManager`
// getNotifySettings :78-112 / updateNotifySettings :148-160).
import { describe, expect, it, vi } from 'vitest'
import type { RestClient } from '../net/restClient'

import { newNotifyManager } from './notifyManager'

const settings = (mute_until: number, show_previews: boolean) => ({ _: 'peerNotifySettings', mute_until, show_previews })

describe('notifyManager', () => {
  it('getNotifySettings(key) → GET /me/notify_settings?peer=key', async () => {
    const get = vi.fn(async () => settings(0, true))
    const m = newNotifyManager({ rest: { get } as unknown as RestClient, onLocalUpdate: vi.fn() })

    expect(await m.getNotifySettings('notifyChats')).toEqual(settings(0, true))
    expect(get).toHaveBeenCalledWith('/me/notify_settings', { peer: 'notifyChats' })
  })

  it('getNotifyPeerTypeSettings() спрашивает все три ключа (tweb :114-127)', async () => {
    const get = vi.fn(async (_path: string, q?: Record<string, string | number>) =>
      settings(q?.peer === 'notifyUsers' ? 0x7fffffff : 0, q?.peer !== 'notifyChats'))
    const m = newNotifyManager({ rest: { get } as unknown as RestClient, onLocalUpdate: vi.fn() })

    expect(await m.getNotifyPeerTypeSettings()).toEqual({
      notifyUsers: settings(0x7fffffff, true),
      notifyChats: settings(0, false),
      notifyBroadcasts: settings(0, true),
    })
    expect(get).toHaveBeenCalledTimes(3)
  })

  it('updateNotifySettings → PUT с inputPeerNotifySettings, затем местный updateNotifySettings (tweb :148-160, :129-146)', async () => {
    const order: string[] = []
    const put = vi.fn(async () => { order.push('put'); return { _: 'boolTrue' } })
    const onLocalUpdate = vi.fn(() => { order.push('local') })
    const m = newNotifyManager({ rest: { put } as unknown as RestClient, onLocalUpdate })

    await m.updateNotifySettings('notifyUsers', { mute_until: 0x7fffffff })

    expect(put).toHaveBeenCalledWith('/me/notify_settings?peer=notifyUsers', { _: 'inputPeerNotifySettings', mute_until: 2147483647 })
    expect(onLocalUpdate).toHaveBeenCalledWith({
      _: 'updateNotifySettings',
      peer: { _: 'notifyUsers' },
      notify_settings: { _: 'peerNotifySettings', mute_until: 2147483647 },
    })
    expect(order).toEqual(['put', 'local'])
  })

  it('отказ сервера не порождает местного апдейта', async () => {
    const put = vi.fn(async () => { throw new Error('500') })
    const onLocalUpdate = vi.fn()
    const m = newNotifyManager({ rest: { put } as unknown as RestClient, onLocalUpdate })

    await expect(m.updateNotifySettings('notifyChats', { show_previews: false })).rejects.toThrow('500')
    expect(onLocalUpdate).not.toHaveBeenCalled()
  })

  // Реестр RPC зовёт метод отвязанным (см. privacyManager.test.ts).
  it('методы работают отвязанными', async () => {
    const get = vi.fn(async () => settings(0, true))
    // oxlint-disable-next-line typescript/unbound-method -- отвязанный вызов и есть предмет теста
    const { getNotifySettings } = newNotifyManager({ rest: { get } as unknown as RestClient, onLocalUpdate: vi.fn() })
    await getNotifySettings('notifyBroadcasts')
    expect(get).toHaveBeenCalled()
  })
})
