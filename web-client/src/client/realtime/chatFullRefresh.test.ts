// A2-29: кадр `chat_update` перечитывает уже загруженную полную карточку чата —
// порт слушателя `channel_update` → refreshFullPeer (tweb
// appProfileManager.ts:120-122). Снимок из кадра собран без зрителя, поэтому
// в зеркало он не кладётся, а запускает перечитывание.
import { beforeAll, describe, expect, it, vi } from 'vitest'
import rootScope from '@lib/rootScope'
import { RT, type ChatUpdateEvt } from '../../core/realtime/events'
import type { Managers } from '../bootstrap'

const refreshIfNeeded = vi.fn()
vi.mock('../../stores/fullPeers.solid', () => ({ refreshFullPeerIfNeeded: (id: number) => refreshIfNeeded(id) }))

const { registerRefetchSubscriber } = await import('./refetchSubscriber')

function chatUpdate(chatId: number): ChatUpdateEvt {
  return {
    _: 'updateChatFullSnapshot',
    peer: { _: 'peerChannel', channel_id: chatId },
    chat_full: {
      _: 'messages.chatFull',
      full_chat: { _: 'channelFull', id: chatId, about: '', read_inbox_max_id: 0, read_outbox_max_id: 0, unread_count: 0, chat_photo: null },
      chats: [{ _: 'channel', id: chatId, title: 'Группа', photo: { _: 'chatPhotoEmpty' }, date: 0, pFlags: { megagroup: true } }],
      users: [],
    },
  }
}

describe('chat_update → перечитать полную карточку (A2-29)', () => {
  beforeAll(() => {
    registerRefetchSubscriber({ dialogs: { refresh: vi.fn().mockResolvedValue(undefined) } } as unknown as Managers)
  })

  it('зовёт refreshFullPeerIfNeeded по пиру кадра', () => {
    rootScope.dispatchEventSingle(RT.chatUpdate, chatUpdate(42))
    expect(refreshIfNeeded).toHaveBeenCalledWith(-42)
  })
})
