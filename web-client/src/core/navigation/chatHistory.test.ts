// Пины трёх расхождений с оригиналом из докблока `chatHistory.ts`: смена чата
// не создаёт запись истории, хэш адресует пир ВЕРХНЕГО инстанса (без ветки
// треда), пустой стек — пустой хэш. Плюс пин на находку ревью задачи 1
// (Critical): черновик с известным username пишется в ДВА приёма
// (`selectChat('draft:<id>')`, потом отдельно `setDraftPeer`), и подписка
// обязана дожидаться ОБОИХ.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { hashForChat, startChatHistory, syncChatHash } from './chatHistory'
import { useChatStackStore } from '../../stores/chatStackStore'
import { useNavigationStore } from '../../stores/navigationStore'
import appNavigationController from './appNavigationController'

/** Очередь мутаций истории контроллера идёт через `setTimeout(…, 0)`
 *  (`appNavigationController.modifyHistoryFromEvent`) — даём ей пройти
 *  НЕСКОЛЬКО тиков (мутация может сама поставить в очередь следующую, как у
 *  Back: `legacySettleForBack` → `history.back()`), тот же приём и то же
 *  число тиков, что в `appNavigationController.test.ts:62-66`. */
const flush = async (times = 4) => {
  for (let i = 0; i < times; ++i) {
    await new Promise((r) => setTimeout(r, 0))
  }
}

beforeEach(() => {
  useChatStackStore.getState().clear()
  useNavigationStore.setState({ selectedId: null, draftPeer: null })
})

afterEach(() => {
  useChatStackStore.getState().clear()
  // `appNavigationController` — синглтон, живой на весь файл: любой тест,
  // гоняющий `startChatHistory()` при непустом стеке (включая тесты хэша
  // выше — 'черновик' открывает draft-чат), заводит запись `im`. Без уборки
  // здесь она пережила бы свой тест и ломала бы первый же `toBeUndefined()`
  // в следующем.
  appNavigationController.removeByType('im')
})

describe('chatHistory', () => {
  it('смена чата НЕ создаёт записи истории', async () => {
    const push = vi.spyOn(history, 'pushState')
    useChatStackStore.getState().setPeer({ peerId: 42, type: 'chat' })
    syncChatHash()
    await flush()

    expect(push).not.toHaveBeenCalled()
    expect(location.hash).toBe('#42')
    push.mockRestore()
  })

  it('уход вглубь не меняет хэш: он адресует пир верхнего инстанса, а не ветку', async () => {
    useChatStackStore.getState().setPeer({ peerId: 42, type: 'chat' })
    useChatStackStore.getState().setInnerPeer({
      peerId: 77, type: 'discussion', threadId: 5,
      thread: { rootMsgId: 5, title: '', kind: 'comments' },
    })
    syncChatHash()
    await flush()

    expect(location.hash).toBe('#77')
  })

  it('пустой стек — пустой хэш', async () => {
    useChatStackStore.getState().setPeer({ peerId: 42, type: 'chat' })
    syncChatHash()
    await flush()

    useChatStackStore.getState().clear()
    syncChatHash()
    await flush()

    expect(location.hash).toBe('')
  })

  it('hashForChat: пустой стек даёт пустую строку без вызова контроллера', () => {
    expect(hashForChat()).toBe('')
  })

  it('черновик: @username из setDraftPeer тоже двигает хэш, а не только selectChat', async () => {
    const stop = startChatHistory()
    try {
      // Тот самый двухприёмный порядок из useNavigationActions.openPeer/
      // useUrlSync (резолв #@username): сначала selectChat кладёт peerId в
      // стек и обнуляет draftPeer, ЗАТЕМ отдельным вызовом приезжает сам peer.
      useNavigationStore.getState().selectChat('draft:777')
      await flush()
      useNavigationStore.getState().setDraftPeer({ id: 777, title: 'X', username: 'xuser' })
      await flush()

      expect(location.hash).toBe('#@xuser')
    } finally {
      stop()
    }
  })
})

/**
 * Запись `im` — порт appImManager.ts:2628-2638 (пуш, условие `prevTabId
 * !== undefined && id > prevTabId` внутри `id < APP_TABS.PROFILE ||
 * !findItemByType('im')`) и `setPeer({})` — всех её веток, что у нас есть
 * предмет (:2761-2774 глубина>1 → spliceChats(chatIndex); :2825-2828 иначе —
 * чат очищается, таб уходит на список). Back/Esc закрывают чат ОДНОЙ этой
 * записью — уход вглубь (setInnerPeer, appImManager.ts:2831-2872) `selectTab`
 * сам не зовёт, второй записи не добавляет.
 *
 * `appNavigationController` — синглтон, живой на весь файл (не новый
 * инстанс, как в `appNavigationController.test.ts`, — `chatHistory.ts`
 * работает именно с синглтоном), поэтому убираем за собой запись 'im' и
 * мокаем `history.back`/`pushState`, чтобы не гонять реальную навигацию
 * jsdom между тестами — тот же приём, что `appNavigationController.test.ts:74-86`.
 */
describe('chatHistory — запись im', () => {
  let backSpy: ReturnType<typeof vi.spyOn>
  let pushStateSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    backSpy = vi.spyOn(history, 'back').mockImplementation(() => {})
    pushStateSpy = vi.spyOn(history, 'pushState').mockImplementation(() => {})
  })

  afterEach(async () => {
    appNavigationController.removeByType('im')
    await flush()
    backSpy.mockRestore()
    pushStateSpy.mockRestore()
  })

  it('открытие чата из списка кладёт РОВНО одну запись im', () => {
    const stop = startChatHistory()
    try {
      expect(appNavigationController.findItemByType('im')).toBeUndefined()
      useNavigationStore.getState().selectChat('42')
      expect(appNavigationController.findItemByType('im')).toBeDefined()
    } finally {
      stop()
    }
  })

  // Мутационный пин: сними в реализации гард `!findItemByType('im')` — уход
  // вглубь начнёт пушить вторую запись, и этот тест обязан покраснеть.
  it('уход вглубь второй записи НЕ добавляет', () => {
    const stop = startChatHistory()
    const pushSpy = vi.spyOn(appNavigationController, 'pushItem')
    try {
      useNavigationStore.getState().selectChat('42')
      expect(pushSpy).toHaveBeenCalledTimes(1)

      useChatStackStore.getState().setInnerPeer({
        peerId: 77,
        type: 'discussion',
        threadId: 5,
        thread: { rootMsgId: 5, title: '', kind: 'comments' },
      })
      // tweb appImManager.ts:2628 — id > prevTabId ложно при уходе вглубь
      expect(pushSpy).toHaveBeenCalledTimes(1)
    } finally {
      pushSpy.mockRestore()
      stop()
    }
  })

  it('Back из треда срезает верхний инстанс, чат остаётся открытым', () => {
    const stop = startChatHistory()
    try {
      useNavigationStore.getState().selectChat('42')
      useChatStackStore.getState().setInnerPeer({
        peerId: 77,
        type: 'discussion',
        threadId: 5,
        thread: { rootMsgId: 5, title: '', kind: 'comments' },
      })
      expect(useChatStackStore.getState().stack).toHaveLength(2)

      appNavigationController.back('im')

      expect(useChatStackStore.getState().stack).toHaveLength(1)
      expect(useChatStackStore.getState().stack[0]?.peerId).toBe(42)
      expect(useNavigationStore.getState().selectedId).toBe('42')
    } finally {
      stop()
    }
  })

  it('Back из корневого чата закрывает чат', () => {
    const stop = startChatHistory()
    try {
      useNavigationStore.getState().selectChat('42')
      expect(useChatStackStore.getState().stack).toHaveLength(1)

      appNavigationController.back('im')

      expect(useChatStackStore.getState().stack).toHaveLength(0)
      expect(useNavigationStore.getState().selectedId).toBeNull()
    } finally {
      stop()
    }
  })

  it('смена чата на другой из списка новой записи не добавляет', () => {
    const stop = startChatHistory()
    const pushSpy = vi.spyOn(appNavigationController, 'pushItem')
    try {
      useNavigationStore.getState().selectChat('42')
      expect(pushSpy).toHaveBeenCalledTimes(1)

      useNavigationStore.getState().selectChat('43')
      expect(pushSpy).toHaveBeenCalledTimes(1)
    } finally {
      pushSpy.mockRestore()
      stop()
    }
  })
})
