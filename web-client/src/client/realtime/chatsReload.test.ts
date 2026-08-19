// Регрессия: до этой задачи storeProjection и refetchSubscriber держали
// НЕЗАВИСИМЫЕ 300мс-дебаунса на один и тот же рефетч (свой модульный таймер
// в каждом файле). Два триггера из разных зон в пределах одного окна давали
// два параллельных запроса /chats. Проверяем единственность общего дебаунса:
// удали импорт scheduleChatsReload из любой зоны — счётчик рефетчей снова
// уедет в 2 (см. отчёт задачи — так и было воспроизведено ДО правки).
//
// Task 6 (перенос владения диалогами): дебаунс теперь зовёт `managers.dialogs.
// refresh()` (владелец списка), не `loadChats` (диалоговая половина которого
// снесена) — мок сдвинулся вместе с проводкой.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import rootScope from '@lib/rootScope'
import { RT, type ChatUpdateEvt, type NewMessageEvt } from '../../core/realtime/events'
import { useChatsStore } from '../../stores/chatsStore'
import type { Managers } from '../bootstrap'

import { registerStoreProjection } from './storeProjection'
import { __resetChatsReloadTimerForTests, registerRefetchSubscriber } from './refetchSubscriber'

const refresh = vi.fn().mockResolvedValue(undefined)

// Кадр `chat_update` несёт `messages.chatFull` — тот же объект, что отдаёт
// `GET /chats/{peerID}/card`.
function chatUpdate(peerId: number, title = '', username?: string): ChatUpdateEvt {
  return {
    peer_id: peerId,
    chat_full: {
      _: 'messages.chatFull',
      full_chat: { _: 'channelFull', id: Math.abs(peerId), about: '', read_inbox_max_id: 0, read_outbox_max_id: 0, unread_count: 0, chat_photo: null },
      chats: [{ _: 'channel', id: Math.abs(peerId), title, username, photo: { _: 'chatPhotoEmpty' }, date: 0, pFlags: { megagroup: true } }],
      users: [],
    },
  }
}

describe('единственный дебаунс /chats-рефетча (storeProjection + refetchSubscriber)', () => {
  beforeAll(() => {
    const managers = { dialogs: { refresh } } as unknown as Managers
    registerStoreProjection(managers)
    registerRefetchSubscriber(managers)
  })

  beforeEach(() => {
    vi.useFakeTimers()
    refresh.mockClear()
    // Модульный таймер — синглтон на весь файл (см. коммент у scheduleChatsReload
    // в refetchSubscriber.ts): без явного сброса кейс унаследовал бы висящий
    // таймер от предыдущего и первый триггер молча проглотился бы.
    __resetChatsReloadTimerForTests()
    useChatsStore.setState({ dialogs: [], meId: 1, activePeerId: null })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  // Отдельно проверяем, что зона проектора вообще доходит до scheduleChatsReload
  // (не просто «итог — 1 вызов», а именно «этот триггер сам по себе что-то
  // делает») — иначе тест ниже прошёл бы и с вырезанным вызовом в
  // storeProjection.ts: единственным источником остался бы рефетчер, и итог
  // всё равно был бы «1 вызов», хоть и не тот, что проверяется.
  it('триггер только из зоны проектора (сообщение в неизвестный чат) → managers.dialogs.refresh вызван', () => {
    const newMsg: NewMessageEvt = {
      peer_id: 777, msg_id: 1, seq: 1, sender_id: 2, type: 'text', text: 'hi',
      media_id: null, created_at: '2026-08-10T12:00:00Z',
    }
    rootScope.dispatchEventSingle(RT.newMessage, newMsg)
    vi.advanceTimersByTime(300)
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('триггер из зоны проектора + зоны рефетчера в одном окне дебаунса → managers.dialogs.refresh вызван ровно один раз', () => {
    // Зона проектора: сообщение в неизвестный чат (storeProjection.ts, RT.newMessage).
    const newMsg: NewMessageEvt = {
      peer_id: 777, msg_id: 1, seq: 1, sender_id: 2, type: 'text', text: 'hi',
      media_id: null, created_at: '2026-08-10T12:00:00Z',
    }
    rootScope.dispatchEventSingle(RT.newMessage, newMsg)

    // Зона рефетчера: chat_update по чату, которого ещё нет в списке (refetchSubscriber.ts, RT.chatUpdate).
    rootScope.dispatchEventSingle(RT.chatUpdate, chatUpdate(888))

    vi.advanceTimersByTime(300)

    expect(refresh).toHaveBeenCalledTimes(1)
  })
})
