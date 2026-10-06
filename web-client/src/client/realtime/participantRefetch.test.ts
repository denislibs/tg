// Кадр участника перечитывает ПОЛНУЮ карточку чата — вторая половина tweb
// `invalidateChannelParticipants` (`appProfileManager.ts:918-926`): только если
// карточка уже лежит в зеркале (`getCachedFullChat`), иначе перечитывать нечего.
import { afterEach, describe, expect, it, vi } from 'vitest'
import rootScope from '@lib/rootScope'
import { RT } from '../../core/realtime/events'
import { resetChatFullMirror, saveChatFull } from '../../core/chatFullCache'
import type { ChannelFull } from '../../core/peers/peer'
import type { Managers } from '../bootstrap'

const refreshFullPeer = vi.hoisted(() => vi.fn())
vi.mock('../../stores/fullPeers.solid', () => ({ refreshFullPeer }))

import { registerRefetchSubscriber } from './refetchSubscriber'

const full = (id: number): ChannelFull => ({
  _: 'channelFull', id, about: '', read_inbox_max_id: 0, read_outbox_max_id: 0, unread_count: 0, chat_photo: null,
})
const frame = (channelId: number) => ({ _: 'updateChannelParticipant' as const, channel_id: channelId, date: 1, user_id: 7 })

describe('refetchSubscriber: chat_participant → refreshFullPeer', () => {
  afterEach(() => {
    resetChatFullMirror()
    refreshFullPeer.mockClear()
  })

  it('карточка в зеркале — перечитывается по ключу чата', () => {
    registerRefetchSubscriber({} as unknown as Managers)
    saveChatFull(-30, full(30))
    rootScope.dispatchEventSingle(RT.chatParticipant, frame(30))
    expect(refreshFullPeer).toHaveBeenCalledWith(-30)
  })

  it('карточки нет — сети нет', () => {
    registerRefetchSubscriber({} as unknown as Managers)
    rootScope.dispatchEventSingle(RT.chatParticipant, frame(31))
    expect(refreshFullPeer).not.toHaveBeenCalled()
  })
})
