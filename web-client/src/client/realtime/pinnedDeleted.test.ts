// Удаление закреплённого сообщения (tweb `handleDeletedMessages`, appMessagesManager.ts
// :14078-14080 → `resetPinnedMessagesCache`): сервер кадра закрепа не шлёт, tweb снимает
// закреп сам. Воркер объявляет `peer_pinned_deleted {peerId, mids, pinned}` (клиентские
// номера), вкладка сбрасывает кэш закрепов и объявляет `peer_pinned_messages`.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import rootScope from '@lib/rootScope'
import { getPinnedMessageByMid, getPinnedMessage, resetPinnedMessagesCache } from '../../core/pinnedMessages'
import type { MyMessage } from '../../core/models'
import type { Managers } from '../bootstrap'

import { registerRefetchSubscriber } from './refetchSubscriber'

describe('refetchSubscriber: удаление закреплённого сбрасывает кэш закрепов и плашку', () => {
  const PEER = 5
  const pinned = (...ids: number[]) => ids.map((id) => ({ id }) as MyMessage)
  const listPins = vi.fn()
  const managers = { messages: { listPins } } as unknown as Managers
  const listener = vi.fn()

  // подписчик регистрируется один раз: повторная регистрация задвоила бы обработчики
  beforeAll(() => {
    registerRefetchSubscriber(managers)
    rootScope.addEventListener('peer_pinned_messages', listener)
  })
  afterAll(() => { rootScope.removeEventListener('peer_pinned_messages', listener) })
  beforeEach(() => {
    resetPinnedMessagesCache()
    listPins.mockReset()
    listener.mockClear()
  })

  it('воркер знает закреплённое: сброс кэша и peer_pinned_messages {pinned: false}', async () => {
    listPins.mockResolvedValue(pinned(5, 7))
    await getPinnedMessage(managers as never, PEER)
    expect(getPinnedMessageByMid(PEER, 5)).toBeDefined()

    rootScope.dispatchEventSingle('peer_pinned_deleted', { peerId: PEER, mids: [5], pinned: [5] })

    expect(getPinnedMessageByMid(PEER, 5)).toBeUndefined()
    expect(listener).toHaveBeenCalledWith({ peerId: PEER, mids: [5], pinned: false })
  })

  it('закреп вне окна воркера (pinned пуст), но номер есть в кэше закрепов → сброс', async () => {
    listPins.mockResolvedValue(pinned(9))
    await getPinnedMessage(managers as never, PEER)

    rootScope.dispatchEventSingle('peer_pinned_deleted', { peerId: PEER, mids: [9], pinned: [] })

    expect(getPinnedMessageByMid(PEER, 9)).toBeUndefined()
    expect(listener).toHaveBeenCalledWith({ peerId: PEER, mids: [9], pinned: false })
  })

  it('кэш закрепов темы (ключ peerId_threadId) тоже находит номер', async () => {
    listPins.mockResolvedValue(pinned(9))
    await getPinnedMessage(managers as never, PEER, 77)

    rootScope.dispatchEventSingle('peer_pinned_deleted', { peerId: PEER, mids: [9], pinned: [] })

    expect(getPinnedMessageByMid(PEER, 9, 77)).toBeUndefined()
    expect(listener).toHaveBeenCalledOnce()
  })

  it('номера нет ни в pinned, ни в кэше → ничего: без события и без перечитки /pins', async () => {
    listPins.mockResolvedValue(pinned(5))
    await getPinnedMessage(managers as never, PEER)
    listPins.mockClear()

    rootScope.dispatchEventSingle('peer_pinned_deleted', { peerId: PEER, mids: [100], pinned: [] })

    expect(getPinnedMessageByMid(PEER, 5)).toBeDefined()
    expect(listener).not.toHaveBeenCalled()
    expect(listPins).not.toHaveBeenCalled()
  })

  it('чужой пир: кэш другого чата не трогается', async () => {
    listPins.mockResolvedValue(pinned(9))
    await getPinnedMessage(managers as never, PEER)

    rootScope.dispatchEventSingle('peer_pinned_deleted', { peerId: 6, mids: [9], pinned: [] })

    expect(getPinnedMessageByMid(PEER, 9)).toBeDefined()
    expect(listener).not.toHaveBeenCalled()
  })

  it('запрос закрепов ещё в полёте: ответ мог предшествовать удалению → сброс', () => {
    listPins.mockReturnValue(new Promise(() => {}))
    void getPinnedMessage(managers as never, PEER)

    rootScope.dispatchEventSingle('peer_pinned_deleted', { peerId: PEER, mids: [9], pinned: [] })

    expect(listener).toHaveBeenCalledWith({ peerId: PEER, mids: [9], pinned: false })
  })

  // Очистка истории (tweb `flushStoragesByPeerId` :6747 → `flushPinnedMessagesCache`).
  it('dialog_flush → кэш закрепов пира сброшен, плашка перечитывает', async () => {
    listPins.mockResolvedValue(pinned(5))
    await getPinnedMessage(managers as never, PEER)

    rootScope.dispatchEventSingle('dialog_flush', { peerId: PEER, dialog: undefined })

    expect(getPinnedMessageByMid(PEER, 5)).toBeUndefined()
    expect(listener).toHaveBeenCalledWith({ peerId: PEER, mids: [], pinned: false })
  })
})
