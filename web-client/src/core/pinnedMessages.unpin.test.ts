// `updatePinnedMessage` / `unpinAllMessages` — закрепная часть tweb `appMessagesManager`
// (`:6838-6893`): флаги `silent`/`pm_oneside` уходят в запрос, «Открепить все» — один запрос
// воркера, затем кэш закрепов сбрасывается и объявляется `peer_pinned_messages {unpinAll}`.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import rootScope from '@lib/rootScope'
import { setAppState, useAppStateStore } from '@stores/appState'
import type { MyMessage } from './models'
import { getPinnedMessage, getPinnedMessageByMid, resetPinnedMessagesCache, unpinAllMessages, updatePinnedMessage } from './pinnedMessages'

const PEER = 5

function makeManagers() {
  const pin = vi.fn(async () => {})
  const unpin = vi.fn(async () => {})
  const unpinAll = vi.fn(async () => true)
  const listPins = vi.fn(async () => [{ id: 7 }, { id: 4 }] as MyMessage[])
  return { pin, unpin, unpinAll, listPins, managers: { messages: { listPins, pin, unpin }, chats: { unpinAllMessages: unpinAll } } }
}

describe('updatePinnedMessage', () => {
  it('закрепить: флаги уходят в запрос', () => {
    const { managers, pin, unpin } = makeManagers()
    void updatePinnedMessage(managers, PEER, 3, false, true, true)
    expect(pin).toHaveBeenCalledWith(PEER, 3, { silent: true, pm_oneside: true })
    expect(unpin).not.toHaveBeenCalled()
  })

  it('открепить: unpin без флагов', () => {
    const { managers, pin, unpin } = makeManagers()
    void updatePinnedMessage(managers, PEER, 3, true)
    expect(unpin).toHaveBeenCalledWith(PEER, 3)
    expect(pin).not.toHaveBeenCalled()
  })
})

describe('unpinAllMessages', () => {
  const listener = vi.fn()
  beforeEach(() => {
    resetPinnedMessagesCache()
    setAppState('hiddenPinnedMessages', {})
    rootScope.addEventListener('peer_pinned_messages', listener)
  })
  afterEach(() => {
    rootScope.removeEventListener('peer_pinned_messages', listener)
    listener.mockClear()
  })

  it('один запрос воркера (без открепления по одному), затем сброс кэша и peer_pinned_messages {unpinAll}', async () => {
    const { managers, unpinAll, unpin, listPins } = makeManagers()
    await getPinnedMessage(managers, PEER)
    expect(getPinnedMessageByMid(PEER, 7)).toBeDefined()
    listPins.mockClear()

    await expect(unpinAllMessages(managers, PEER)).resolves.toBe(true)

    expect(unpinAll).toHaveBeenCalledTimes(1)
    expect(unpinAll).toHaveBeenCalledWith(PEER, undefined)
    expect(unpin).not.toHaveBeenCalled()
    expect(listPins).not.toHaveBeenCalled()
    expect(getPinnedMessageByMid(PEER, 7)).toBeUndefined()
    expect(listener).toHaveBeenCalledWith({ peerId: PEER, threadId: undefined, unpinAll: true })
  })

  it('тема: threadId уходит воркеру и в событие; кэш пира сбрасывается целиком (tweb flushPinnedMessagesCache)', async () => {
    const { managers, unpinAll } = makeManagers()
    await getPinnedMessage(managers, PEER, 77)
    await unpinAllMessages(managers, PEER, 77)
    expect(unpinAll).toHaveBeenCalledWith(PEER, 77)
    expect(getPinnedMessageByMid(PEER, 7, 77)).toBeUndefined()
    expect(listener).toHaveBeenCalledWith({ peerId: PEER, threadId: 77, unpinAll: true })
  })

  it('скрытие плашки не трогается (tweb :6869-6888 сбрасывает только кэш)', async () => {
    const { managers } = makeManagers()
    setAppState('hiddenPinnedMessages', { [PEER]: 7 })
    await unpinAllMessages(managers, PEER)
    expect(useAppStateStore.getState().hiddenPinnedMessages[PEER]).toBe(7)
  })

  it('отказ воркера: кэш цел, событие не объявляется', async () => {
    const { managers, unpinAll } = makeManagers()
    await getPinnedMessage(managers, PEER)
    unpinAll.mockRejectedValueOnce(new Error('403'))
    await expect(unpinAllMessages(managers, PEER)).rejects.toThrow('403')
    expect(getPinnedMessageByMid(PEER, 7)).toBeDefined()
    expect(listener).not.toHaveBeenCalled()
  })
})
