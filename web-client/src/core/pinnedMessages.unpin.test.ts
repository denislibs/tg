// `updatePinnedMessage` / `unpinAllMessages` — закрепная часть tweb `appMessagesManager`
// (`:6838-6893`): флаги `silent`/`pm_oneside` уходят в запрос, «Открепить все» — один запрос воркера.
import { describe, expect, it, vi } from 'vitest'
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
  it('один запрос воркера (не открепление по одному), без перечитывания списка', async () => {
    const { managers, unpinAll, unpin, listPins } = makeManagers()
    await expect(unpinAllMessages(managers, PEER)).resolves.toBe(true)
    expect(unpinAll).toHaveBeenCalledTimes(1)
    expect(unpinAll).toHaveBeenCalledWith(PEER, undefined)
    expect(unpin).not.toHaveBeenCalled()
    expect(listPins).not.toHaveBeenCalled()
  })

  it('тема: threadId уходит воркеру; список закрепов темы грузится по теме', async () => {
    const { managers, unpinAll, listPins } = makeManagers()
    await unpinAllMessages(managers, PEER, 77)
    expect(unpinAll).toHaveBeenCalledWith(PEER, 77)
    await getPinnedMessage(managers, PEER, 77)
    expect(listPins).toHaveBeenCalledWith(PEER, 77)
    resetPinnedMessagesCache()
    await getPinnedMessage(managers, PEER)
    expect(listPins).toHaveBeenLastCalledWith(PEER)
    expect(getPinnedMessageByMid(PEER, 7)).toBeDefined()
  })

  it('отказ воркера пробрасывается', async () => {
    const { managers, unpinAll } = makeManagers()
    unpinAll.mockRejectedValueOnce(new Error('403'))
    await expect(unpinAllMessages(managers, PEER)).rejects.toThrow('403')
  })
})
