import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useChatsStore } from './chatsStore'
import { __resetChatsReloadTimerForTests, registerRefetchSubscriber } from '../client/realtime/refetchSubscriber'
import rootScope from '@lib/rootScope'
import { RT, type ChatUpdateEvt } from '../core/realtime/events'
import type { Managers } from '../client/bootstrap'
import type { Dialog } from '../core/models'

// Форма Dialog — из core/models.ts:88-118 (как её строит mapDialog): поля
// title/username/photo присутствуют всегда; photo — объединение `ChatPhoto`
// с готовым `photo_id`, а не путь «/media/{id}/content» и не URL с токеном.
const dlg = (peerId: number, title: string, extra: Partial<Dialog> = {}): Dialog => ({
  peerId,
  type: 'group',
  lastReadSeq: 0,
  peerReadSeq: 0,
  unread: 0,
  muted: false,
  pinned: false,
  archived: false,
  title,
  username: '',
  photo: undefined,
  // Даты у чатов РАЗНЫЕ и убывают с peerId, чтобы порядок фикстуры [1, 2] совпадал
  // с каноническим (dialogIndex): при одинаковых датах ничью разводит peerId, и
  // канонический порядок был бы [2, 1] — тесты про сохранение ссылок проверяли бы
  // тогда не то (список пересортировался бы на первом же applyChatMeta).
  lastMessage: { seq: 1, text: 'привет', senderId: 5, at: peerId === 1 ? '2026-08-09T11:00:00Z' : '2026-08-09T10:00:00Z' },
  ...extra,
})

beforeEach(() => {
  useChatsStore.setState({ dialogs: [dlg(1, 'Альфа'), dlg(2, 'Бета')], loaded: true })
})

// Task 3 (перенос владения диалогами): applyChatMeta отсюда убран — тело
// переехало в core/managers/dialogsManager.ts (тесты на слияние снимка/индекс —
// dialogsManager.test.ts, describe «realtime-кадры применяет владелец»). Здесь
// остаётся только вторая половина сценария — refetchSubscriber на main: он
// применение снимка больше не делает (это теперь workerCore.ts::dispatch ДО
// того, как сырой rt:chat_update вообще доезжает досюда), а решает единственное,
// что владелец решить не может — «чата ещё нет в списке → рефетч /chats».

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

describe('refetchSubscriber: chat_update', () => {
  // Уборка: каждый it() ниже зовёт registerRefetchSubscriber() заново, а
  // слушатели предыдущих кейсов на rootScope не отписываются — без явной
  // очистки они копятся и реагируют на кадры следующих кейсов своими
  // (уже неактуальными) моками. Раньше это было безопасно, потому что дебаунс
  // на /chats был закрытым замыканием per-регистрация; теперь это единый
  // модульный таймер (см. scheduleChatsReload в refetchSubscriber.ts) —
  // более ранний слушатель мог бы застолбить его первым. rootScope.cleanup()
  // снимает все слушатели, __resetChatsReloadTimerForTests() обнуляет таймер.
  afterEach(() => {
    rootScope.cleanup()
    __resetChatsReloadTimerForTests()
  })

  it('чат уже в списке — managers.dialogs.refresh НЕ зовётся (снимок применяет владелец, не main)', () => {
    // Фейковые таймеры: обработчик уходит в сеть через дебаунсер (300 мс),
    // поэтому «не позвали» надо проверять ПОСЛЕ прокрутки таймеров, иначе тест
    // прошёл бы и на возвращённом рефетче.
    vi.useFakeTimers()
    const refresh = vi.fn().mockResolvedValue(undefined)
    registerRefetchSubscriber({
      dialogs: { refresh },
      auth: { me: vi.fn().mockResolvedValue(null) },
      messages: { listPins: vi.fn() },
      folders: { list: vi.fn() },
    } as unknown as Managers)

    rootScope.dispatchEventSingle(RT.chatUpdate, chatUpdate(2, 'Бета+', 'beta'))
    vi.advanceTimersByTime(1000)
    vi.useRealTimers()

    expect(refresh).not.toHaveBeenCalled()
  })

  // Меня добавили в группу (backend group.go:145-151: AddMember → publishChatUpdate):
  // диалога ещё нет ни в списке, ни в снимке нет полей, чтобы его собрать, —
  // единственный источник нового диалога у нас /chats (владелец, managers.dialogs.
  // refresh()). Только этот случай и ходит в сеть.
  it('чата ещё нет в списке — дебаунснутый рефетч /chats', () => {
    vi.useFakeTimers()
    const refresh = vi.fn().mockResolvedValue(undefined)
    registerRefetchSubscriber({
      dialogs: { refresh },
      auth: { me: vi.fn().mockResolvedValue(null) },
      messages: { listPins: vi.fn() },
      folders: { list: vi.fn() },
    } as unknown as Managers)

    rootScope.dispatchEventSingle(RT.chatUpdate, chatUpdate(777, 'Новая группа'))
    rootScope.dispatchEventSingle(RT.chatUpdate, chatUpdate(778, 'И ещё одна'))
    vi.advanceTimersByTime(1000)
    vi.useRealTimers()

    expect(refresh).toHaveBeenCalledTimes(1) // дебаунс: два кадра — один запрос
  })

  it('полный рефетч /chats остаётся за rt:resync (too_long)', () => {
    const refresh = vi.fn().mockResolvedValue(undefined)
    registerRefetchSubscriber({
      dialogs: { refresh },
      auth: { me: vi.fn().mockResolvedValue(null) },
      messages: { listPins: vi.fn() },
      folders: { list: vi.fn() },
    } as unknown as Managers)

    rootScope.dispatchEventSingle('rt:resync', null)

    expect(refresh).toHaveBeenCalledTimes(1)
  })
})
