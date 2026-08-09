import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useChatsStore } from './chatsStore'
import { registerRefetchSubscriber } from '../client/realtime/refetchSubscriber'
import { eventBus } from '../core/realtime/eventBus'
import { RT } from '../core/realtime/events'
import type { Managers } from '../client/bootstrap'
import type { Dialog } from '../core/models'

// Форма Dialog — из core/models.ts:88-118 (как её строит mapDialog): поля
// title/username/photoUrl присутствуют всегда, photoUrl — путь
// «/media/{id}/content» (backend chatsrepo.go:190), а не готовый URL с токеном.
const dlg = (chatId: number, title: string, extra: Partial<Dialog> = {}): Dialog => ({
  chatId,
  type: 'group',
  lastReadSeq: 0,
  peerReadSeq: 0,
  unread: 0,
  muted: false,
  pinned: false,
  archived: false,
  title,
  username: '',
  photoUrl: undefined,
  lastMessage: { seq: 1, text: 'привет', senderId: 5, at: '2026-08-09T10:00:00Z' },
  ...extra,
})

beforeEach(() => {
  useChatsStore.setState({ dialogs: [dlg(1, 'Альфа'), dlg(2, 'Бета')], loaded: true })
})

describe('applyChatMeta', () => {
  it('применяет снимок в существующий диалог', () => {
    useChatsStore.getState().applyChatMeta({ chat_id: 1, title: 'Альфа+', username: 'alpha' })

    const d = useChatsStore.getState().dialogs.find((x) => x.chatId === 1)
    expect(d?.title).toBe('Альфа+')
    expect(d?.username).toBe('alpha')
  })

  it('соседний диалог сохраняет ССЫЛКУ (не перерисовывается)', () => {
    const betaBefore = useChatsStore.getState().dialogs.find((x) => x.chatId === 2)

    useChatsStore.getState().applyChatMeta({ chat_id: 1, title: 'Альфа+' })

    expect(useChatsStore.getState().dialogs.find((x) => x.chatId === 2)).toBe(betaBefore)
  })

  it('снимок совпал с текущим — массив НЕ пересоздаётся', () => {
    const before = useChatsStore.getState().dialogs

    useChatsStore.getState().applyChatMeta({ chat_id: 1, title: 'Альфа', username: '', photo_media_id: null })

    expect(useChatsStore.getState().dialogs).toBe(before)
  })

  it('снимок совпал — сам диалог тоже сохраняет ССЫЛКУ', () => {
    const alphaBefore = useChatsStore.getState().dialogs[0]

    useChatsStore.getState().applyChatMeta({ chat_id: 1, title: 'Альфа' })

    expect(useChatsStore.getState().dialogs[0]).toBe(alphaBefore)
  })

  it('чата нет в списке — ничего не делаем и не падаем', () => {
    const before = useChatsStore.getState().dialogs

    useChatsStore.getState().applyChatMeta({ chat_id: 999, title: 'Чужой' })

    expect(useChatsStore.getState().dialogs).toBe(before)
  })

  it('порядок не меняется: метаданные не влияют на сортировку', () => {
    useChatsStore.getState().applyChatMeta({ chat_id: 2, title: 'Бета+' })

    expect(useChatsStore.getState().dialogs.map((d) => d.chatId)).toEqual([1, 2])
  })

  it('photo_media_id → путь /media/{id}/content (как отдаёт /chats)', () => {
    useChatsStore.getState().applyChatMeta({ chat_id: 1, title: 'Альфа', photo_media_id: 42 })

    expect(useChatsStore.getState().dialogs[0].photoUrl).toBe('/media/42/content')
  })

  it('photo_media_id: null — фото снято', () => {
    useChatsStore.setState({ dialogs: [dlg(1, 'Альфа', { photoUrl: '/media/42/content' }), dlg(2, 'Бета')] })

    useChatsStore.getState().applyChatMeta({ chat_id: 1, title: 'Альфа', photo_media_id: null })

    expect(useChatsStore.getState().dialogs[0].photoUrl).toBeUndefined()
  })

  // Снимок абсолютный: username снят → в снимке ''. Кладём verbatim, как маппинг
  // ответа /chats (models.ts:675), чтобы одно и то же поле не имело двух форм.
  it('пустой username в снимке — публичная ссылка снята', () => {
    useChatsStore.setState({ dialogs: [dlg(1, 'Альфа', { username: 'alpha' }), dlg(2, 'Бета')] })

    useChatsStore.getState().applyChatMeta({ chat_id: 1, title: 'Альфа', username: '' })

    expect(useChatsStore.getState().dialogs[0].username).toBe('')
  })

  it('поля вне снимка (unread, pinned, lastMessage) не затираются', () => {
    useChatsStore.setState({ dialogs: [dlg(1, 'Альфа', { unread: 7, pinned: true }), dlg(2, 'Бета')] })

    useChatsStore.getState().applyChatMeta({ chat_id: 1, title: 'Альфа+' })

    const d = useChatsStore.getState().dialogs[0]
    expect(d.unread).toBe(7)
    expect(d.pinned).toBe(true)
    expect(d.lastMessage?.text).toBe('привет')
  })
})

describe('refetchSubscriber: chat_update без похода в сеть', () => {
  it('кадр chat_update применяется снимком, managers.chats.listDialogs НЕ зовётся', () => {
    // Фейковые таймеры: прежний обработчик уходил в сеть через дебаунсер (300 мс),
    // поэтому «не позвали» надо проверять ПОСЛЕ прокрутки таймеров, иначе тест
    // прошёл бы и на возвращённом рефетче.
    vi.useFakeTimers()
    const listDialogs = vi.fn().mockResolvedValue([])
    registerRefetchSubscriber({
      chats: { listDialogs },
      auth: { me: vi.fn().mockResolvedValue(null) },
      messages: { listPins: vi.fn() },
      folders: { list: vi.fn() },
    } as unknown as Managers)

    eventBus.publish(RT.chatUpdate, { chat_id: 2, title: 'Бета+', username: 'beta' })
    vi.advanceTimersByTime(1000)
    vi.useRealTimers()

    expect(listDialogs).not.toHaveBeenCalled()
    expect(useChatsStore.getState().dialogs.map((d) => d.title)).toEqual(['Альфа', 'Бета+'])
  })

  // Меня добавили в группу (backend group.go:145-151: AddMember → publishChatUpdate):
  // диалога ещё нет ни в списке, ни в снимке нет полей, чтобы его собрать, —
  // единственный источник нового диалога у нас /chats. Только этот случай и ходит
  // в сеть.
  it('чата ещё нет в списке — дебаунснутый рефетч /chats', () => {
    vi.useFakeTimers()
    const listDialogs = vi.fn().mockResolvedValue([])
    registerRefetchSubscriber({
      chats: { listDialogs },
      auth: { me: vi.fn().mockResolvedValue(null) },
      messages: { listPins: vi.fn() },
      folders: { list: vi.fn() },
    } as unknown as Managers)

    eventBus.publish(RT.chatUpdate, { chat_id: 777, title: 'Новая группа' })
    eventBus.publish(RT.chatUpdate, { chat_id: 778, title: 'И ещё одна' })
    vi.advanceTimersByTime(1000)
    vi.useRealTimers()

    expect(listDialogs).toHaveBeenCalledTimes(1) // дебаунс: два кадра — один запрос
  })

  it('полный рефетч /chats остаётся за rt:resync (too_long)', () => {
    const listDialogs = vi.fn().mockResolvedValue([])
    registerRefetchSubscriber({
      chats: { listDialogs },
      auth: { me: vi.fn().mockResolvedValue(null) },
      messages: { listPins: vi.fn() },
      folders: { list: vi.fn() },
    } as unknown as Managers)

    eventBus.publish('rt:resync', undefined)

    expect(listDialogs).toHaveBeenCalledTimes(1)
  })
})
