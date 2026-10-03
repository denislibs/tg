// Плашка закрепа — порт tweb `chat/pinnedMessage.tsx`: какой закреп показан (по нижнему
// видимому баблу), переход по клику с перелистыванием на следующий, переключение между
// закрепами, открепление (крестик → попап; кадр закрепления → перечитка списка), скрытие.
// Настоящие: плашка, кэш закрепов `core/pinnedMessages.ts`, событие `peer_pinned_messages`.
// Замоканы граница с воркером (`listPins`, `media.meta`) и попап открепления.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import '@/test/lang'
import { makeMessage } from '@core/messages/testMessage'
import type { MyMessage } from '@core/models'
import { onPinnedMessagesUpdate, resetPinnedMessagesCache } from '@core/pinnedMessages'
import { useAppStateStore } from '@stores/appState'
import rootScope from '@lib/rootScope'
import type Chat from './chat'
import createChatPinnedMessage, { type ChatPinnedMessageController, type PinnedMessageManagers } from './pinnedMessage.solid'

const showPinMessagePopup = vi.hoisted(() => vi.fn())
vi.mock('@components/popups/unpinMessage', () => ({ default: showPinMessagePopup }))

const PEER = 10
const msg = (id: number, text = 'pin ' + id) => makeMessage({ id, peerId: PEER, fromId: 1, text })

let pins: MyMessage[]
let listPins: ReturnType<typeof vi.fn>
let bottomMid: number
let chat: Chat & { setMessageId: ReturnType<typeof vi.fn> }
let topbar: { setFloating: ReturnType<typeof vi.fn<() => void>>, openPinned: ReturnType<typeof vi.fn<(byCurrent: boolean) => void>> }
let plate: ChatPinnedMessageController

function makeChat() {
  const bubbleEl = () => {
    const el = document.createElement('div')
    el.dataset.mid = '' + bottomMid
    return el
  }

  return {
    peerId: PEER,
    threadId: undefined,
    isPinnedMessagesNeeded: () => true,
    getMessage: () => undefined,
    setPeerPromise: null,
    setMessageId: vi.fn(),
    bubbles: {
      scrollable: { loadedAll: { bottom: true }, isScrolledToEnd: true, container: document.createElement('div') },
      getBubbleByPoint: () => bubbleEl(),
    },
  } as unknown as Chat & { setMessageId: ReturnType<typeof vi.fn> }
}

const subtitle = () => plate.container.querySelector('.pinned-message-subtitle .animated-super-row:not(.is-hiding)')?.textContent
const settle = () => vi.waitFor(() => {
  expect(listPins).toHaveBeenCalled()
})

async function flush() {
  for(let i = 0; i < 10; i++) await Promise.resolve()
  await vi.advanceTimersByTimeAsync(250)
}

beforeEach(() => {
  vi.useFakeTimers()
  resetPinnedMessagesCache()
  useAppStateStore.setState({ hiddenPinnedMessages: {} })
  pins = [msg(5), msg(20), msg(12)]
  listPins = vi.fn(async() => pins.slice())
  bottomMid = 100
  chat = makeChat()
  topbar = { setFloating: vi.fn<() => void>(), openPinned: vi.fn<(byCurrent: boolean) => void>() }
  const managers = {
    messages: { listPins, pin: vi.fn(), unpin: vi.fn() },
    media: { meta: vi.fn(async() => ({ hasThumb: false })), downloadMediaURL: vi.fn() },
  } as unknown as PinnedMessageManagers
  plate = createChatPinnedMessage(topbar, chat, managers)
  document.body.append(plate.container)
  showPinMessagePopup.mockClear()
})

afterEach(() => {
  plate.destroy()
  vi.useRealTimers()
})

describe('плашка закрепа', () => {
  it('у низа истории показывает последний закреп, номер-счётчик схлопнут', async() => {
    plate.setCorrectIndex(0)
    await settle()
    await flush()

    expect(plate.isVisible()).toBe(true)
    expect(plate.container.dataset.mid).toBe('20')
    expect(subtitle()).toBe('pin 20')
    expect(plate.container.querySelector('.animated-counter')!.classList.contains('is-last')).toBe(true)
    expect(plate.container.classList.contains('is-many')).toBe(true)
    // показ плашки пересчитывает распорку под шапкой
    expect(topbar.setFloating).toHaveBeenCalled()
  })

  it('переключение между закрепами: нижний бабл выше закрепа показывает предыдущий закреп', async() => {
    plate.setCorrectIndex(0)
    await settle()
    await flush()

    plate.testMid(15)
    await flush()
    expect(plate.container.dataset.mid).toBe('12')
    expect(subtitle()).toBe('pin 12')
    expect(plate.container.querySelector('.animated-counter')!.classList.contains('is-last')).toBe(false)
    expect(plate.pinnedMessages).toEqual({ mid: 12, index: 1, count: 3 })

    plate.testMid(6)
    await flush()
    expect(plate.container.dataset.mid).toBe('5')
    expect(plate.pinnedMessages).toEqual({ mid: 5, index: 2, count: 3 })
  })

  it('клик ведёт к показанному закрепу и перелистывает на следующий (старее), с последнего — на новейший', async() => {
    plate.setCorrectIndex(0)
    await settle()
    await flush()

    const body = plate.container.querySelector<HTMLElement>('.pinned-message-wrapper')!
    body.click()
    await flush()
    expect(chat.setMessageId).toHaveBeenLastCalledWith({ lastMsgId: 20 })
    expect(plate.container.dataset.mid).toBe('12')

    body.click()
    await flush()
    expect(chat.setMessageId).toHaveBeenLastCalledWith({ lastMsgId: 12 })
    expect(plate.container.dataset.mid).toBe('5')

    body.click()
    await flush()
    expect(chat.setMessageId).toHaveBeenLastCalledWith({ lastMsgId: 5 })
    expect(plate.container.dataset.mid).toBe('20')
  })

  it('крестик открывает попап открепления показанного закрепа (есть право закреплять)', async() => {
    plate.setCorrectIndex(0)
    await settle()
    await flush()

    plate.container.querySelector<HTMLElement>('.pinned-message-unpin')!.click()
    expect(showPinMessagePopup).toHaveBeenCalledWith(PEER, 20, true, undefined, undefined)
  })

  it('открепление (кадр закрепления) перечитывает список: плашка переходит на оставшийся, пустой — прячется', async() => {
    plate.setCorrectIndex(0)
    await settle()
    await flush()

    pins = [msg(5), msg(12)]
    onPinnedMessagesUpdate(PEER, [20], false)
    await flush()
    expect(listPins).toHaveBeenCalledTimes(2)
    expect(plate.container.dataset.mid).toBe('12')
    expect(plate.container.classList.contains('is-many')).toBe(true)

    pins = []
    onPinnedMessagesUpdate(PEER, [5, 12], false)
    await flush()
    expect(plate.isVisible()).toBe(false)
    expect(plate.pinnedMessages).toBeUndefined()
  })

  it('«скрыть закреплённые» прячет плашку до нового закрепа', async() => {
    plate.setCorrectIndex(0)
    await settle()
    await flush()

    rootScope.dispatchEventSingle('peer_pinned_hidden', { peerId: PEER, maxId: 20 })
    expect(plate.isVisible()).toBe(false)
    expect(plate.isUserHidden()).toBe(true)

    pins = [msg(5), msg(20), msg(12), msg(30)]
    onPinnedMessagesUpdate(PEER, [30], true)
    await flush()
    expect(plate.isUserHidden()).toBe(false)
    expect(plate.isVisible()).toBe(true)
    expect(plate.container.dataset.mid).toBe('30')
  })

  it('чужой пир не трогает плашку', async() => {
    plate.setCorrectIndex(0)
    await settle()
    await flush()

    onPinnedMessagesUpdate(PEER + 1, [20], false)
    await flush()
    expect(listPins).toHaveBeenCalledTimes(1)
    expect(plate.container.dataset.mid).toBe('20')
  })
})

describe('плашка треда комментариев (setStaticMessage, расхождение 6)', () => {
  it('корень — автопересланное зеркало поста; приезжает со страницей ленты — плашка дорисовывается', async() => {
    const { putMirrorPage, resetMessagesMirror } = await import('@core/history/messagesMirror')
    resetMessagesMirror()
    const THREAD = 45
    const threadChat = Object.assign(makeChat(), {
      threadId: THREAD,
      messagesStorageKey: 'thread-key',
      isPinnedMessagesNeeded: () => false,
    })
    const managers = {
      messages: { listPins, pin: vi.fn(), unpin: vi.fn() },
      media: { meta: vi.fn(async() => ({ hasThumb: false })), downloadMediaURL: vi.fn() },
    } as unknown as PinnedMessageManagers
    const staticPlate = createChatPinnedMessage(topbar, threadChat, managers)
    document.body.append(staticPlate.container)

    staticPlate.setStaticMessage(THREAD)
    await flush()
    expect(staticPlate.container.querySelector('.pinned-message-subtitle')?.textContent).toBe('')

    const root = { ...makeMessage({ id: 77, peerId: PEER, fromId: 1, text: 'пост канала' }), fwd_from: { _: 'messageFwdHeader', date: 0, saved_from_peer: { _: 'peerChannel', channel_id: 4 }, saved_from_msg_id: THREAD } } as MyMessage
    putMirrorPage('thread-key', [root, msg(78, 'комментарий')])
    await flush()
    expect(staticPlate.container.querySelector('.pinned-message-subtitle')?.textContent).toContain('пост канала')

    staticPlate.destroy()
  })
})
