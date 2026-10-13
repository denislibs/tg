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
    const m = newNotifyManager({ rest: { get } as unknown as RestClient, onLocalUpdate: vi.fn(), frameVersion: () => 0 })

    expect(await m.getNotifySettings('notifyChats')).toEqual(settings(0, true))
    expect(get).toHaveBeenCalledWith('/me/notify_settings', { peer: 'notifyChats' })
  })

  it('getNotifyPeerTypeSettings() спрашивает все три ключа (tweb :114-127)', async () => {
    const get = vi.fn(async (_path: string, q?: Record<string, string | number>) =>
      settings(q?.peer === 'notifyUsers' ? 0x7fffffff : 0, q?.peer !== 'notifyChats'))
    const m = newNotifyManager({ rest: { get } as unknown as RestClient, onLocalUpdate: vi.fn(), frameVersion: () => 0 })

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
    const m = newNotifyManager({ rest: { put } as unknown as RestClient, onLocalUpdate, frameVersion: () => 0 })

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
    const m = newNotifyManager({ rest: { put } as unknown as RestClient, onLocalUpdate, frameVersion: () => 0 })

    await expect(m.updateNotifySettings('notifyChats', { show_previews: false })).rejects.toThrow('500')
    expect(onLocalUpdate).not.toHaveBeenCalled()
  })

  // Кадр пришёл, пока шёл GET: ответ старее применённого — читаем заново.
  it('кадр этого ключа во время GET — ответ перечитывается', async () => {
    let version = 0
    let n = 0
    const get = vi.fn(async () => { n++; if (n === 1) version++; return settings(0, n === 1 ? true : false) })
    const m = newNotifyManager({ rest: { get } as unknown as RestClient, onLocalUpdate: vi.fn(), frameVersion: () => version })

    expect(await m.getNotifySettings('notifyChats')).toEqual(settings(0, false))
    expect(get).toHaveBeenCalledTimes(2)
  })

  it('одновременные getNotifyPeerTypeSettings делят один запрос', async () => {
    const get = vi.fn(async () => settings(0, true))
    const m = newNotifyManager({ rest: { get } as unknown as RestClient, onLocalUpdate: vi.fn(), frameVersion: () => 0 })

    await Promise.all([m.getNotifyPeerTypeSettings(), m.getNotifyPeerTypeSettings()])
    expect(get).toHaveBeenCalledTimes(3)
    await m.getNotifyPeerTypeSettings() // после завершения — новый запрос
    expect(get).toHaveBeenCalledTimes(6)
  })

  // Наш сервер шлёт кадр и инициатору: пришёл более новый кадр этого ключа, пока
  // шёл PUT, — опоздавший ответ не должен затирать его местным апдейтом.
  it('кадр этого ключа во время PUT отменяет местный апдейт; кадр другого ключа — нет', async () => {
    const versions: Record<string, number> = { notifyUsers: 0, notifyChats: 0 }
    const put = vi.fn(async () => { versions.notifyUsers++; return { _: 'boolTrue' } })
    const onLocalUpdate = vi.fn()
    const m = newNotifyManager({ rest: { put } as unknown as RestClient, onLocalUpdate, frameVersion: (k) => versions[k] ?? 0 })

    await m.updateNotifySettings('notifyUsers', { show_previews: false })
    expect(onLocalUpdate).not.toHaveBeenCalled()

    put.mockImplementationOnce(async () => { versions.notifyChats++; return { _: 'boolTrue' } })
    await m.updateNotifySettings('notifyUsers', { show_previews: true })
    expect(onLocalUpdate).toHaveBeenCalledTimes(1)
  })

  // Реестр RPC зовёт метод отвязанным (см. privacyManager.test.ts).
  it('методы работают отвязанными', async () => {
    const get = vi.fn(async () => settings(0, true))
    // oxlint-disable-next-line typescript/unbound-method -- отвязанный вызов и есть предмет теста
    const { getNotifySettings } = newNotifyManager({ rest: { get } as unknown as RestClient, onLocalUpdate: vi.fn(), frameVersion: () => 0 })
    await getNotifySettings('notifyBroadcasts')
    expect(get).toHaveBeenCalled()
  })
})
