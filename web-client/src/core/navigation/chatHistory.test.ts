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

/** Очередь мутаций истории контроллера идёт через `setTimeout(…, 0)`
 *  (`appNavigationController.modifyHistoryFromEvent`) — даём ей пройти,
 *  тот же приём, что в `appNavigationController.test.ts`. */
const flush = async () => {
  await new Promise((r) => setTimeout(r, 0))
}

beforeEach(() => {
  useChatStackStore.getState().clear()
  useNavigationStore.setState({ selectedId: null, draftPeer: null })
})

afterEach(() => {
  useChatStackStore.getState().clear()
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
