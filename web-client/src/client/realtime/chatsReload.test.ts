// Регрессия: до этой задачи storeProjection и refetchSubscriber держали
// НЕЗАВИСИМЫЕ 300мс-дебаунса на один и тот же loadChats (свой модульный таймер
// в каждом файле). Два триггера из разных зон в пределах одного окна давали
// два параллельных запроса /chats. Проверяем единственность общего дебаунса:
// удали импорт scheduleChatsReload из любой зоны — счётчик loadChats снова
// уедет в 2 (см. отчёт задачи — так и было воспроизведено ДО правки).
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import rootScope from '@lib/rootScope'
import { RT, type ChatUpdateEvt, type NewMessageEvt } from '../../core/realtime/events'
import { useChatsStore } from '../../stores/chatsStore'
import type { Managers } from '../bootstrap'

const loadChats = vi.fn().mockResolvedValue(undefined)
vi.mock('../../stores/chatsStore', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../stores/chatsStore')>()),
  loadChats: (...args: unknown[]) => loadChats(...args),
}))

import { registerStoreProjection } from './storeProjection'
import { __resetChatsReloadTimerForTests, registerRefetchSubscriber } from './refetchSubscriber'

describe('единственный дебаунс /chats-рефетча (storeProjection + refetchSubscriber)', () => {
  beforeAll(() => {
    const managers = {} as unknown as Managers
    registerStoreProjection(managers)
    registerRefetchSubscriber(managers)
  })

  beforeEach(() => {
    vi.useFakeTimers()
    loadChats.mockClear()
    // Модульный таймер — синглтон на весь файл (см. коммент у scheduleChatsReload
    // в refetchSubscriber.ts): без явного сброса кейс унаследовал бы висящий
    // таймер от предыдущего и первый триггер молча проглотился бы.
    __resetChatsReloadTimerForTests()
    useChatsStore.setState({ dialogs: [], meId: 1, activeChatId: null })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  // Отдельно проверяем, что зона проектора вообще доходит до scheduleChatsReload
  // (не просто «итог — 1 вызов», а именно «этот триггер сам по себе что-то
  // делает») — иначе тест ниже прошёл бы и с вырезанным вызовом в
  // storeProjection.ts: единственным источником остался бы рефетчер, и итог
  // всё равно был бы «1 вызов», хоть и не тот, что проверяется.
  it('триггер только из зоны проектора (сообщение в неизвестный чат) → loadChats вызван', () => {
    const newMsg: NewMessageEvt = {
      chat_id: 777, msg_id: 1, seq: 1, sender_id: 2, type: 'text', text: 'hi',
      media_id: null, created_at: '2026-08-10T12:00:00Z',
    }
    rootScope.dispatchEventSingle(RT.newMessage, newMsg)
    vi.advanceTimersByTime(300)
    expect(loadChats).toHaveBeenCalledTimes(1)
  })

  it('триггер из зоны проектора + зоны рефетчера в одном окне дебаунса → loadChats вызван ровно один раз', () => {
    // Зона проектора: сообщение в неизвестный чат (storeProjection.ts, RT.newMessage).
    const newMsg: NewMessageEvt = {
      chat_id: 777, msg_id: 1, seq: 1, sender_id: 2, type: 'text', text: 'hi',
      media_id: null, created_at: '2026-08-10T12:00:00Z',
    }
    rootScope.dispatchEventSingle(RT.newMessage, newMsg)

    // Зона рефетчера: chat_update по чату, которого ещё нет в списке (refetchSubscriber.ts, RT.chatUpdate).
    const chatUpd: ChatUpdateEvt = { chat_id: 888 }
    rootScope.dispatchEventSingle(RT.chatUpdate, chatUpd)

    vi.advanceTimersByTime(300)

    expect(loadChats).toHaveBeenCalledTimes(1)
  })
})
