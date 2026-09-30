// `openPeer` — вход «открыть пира» из любого списка (строка поиска, участник,
// контакт). Граница, где оригинал отсекает пустой ключ:
// `appImManager.setInnerPeer` (tweb appImManager.ts:3392-3396) —
// `if(peerId === NULL_PEER_ID || !peerId) return`. Пустой/NaN ключ из
// `data-peer-id` не должен становиться ни выбором, ни черновиком.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useNavigationStore } from '@stores/navigationStore'
import { useChatStackStore } from '@stores/chatStackStore'
import { useChatsStore } from '@stores/chatsStore'
import { openPeer } from './openPeer'

const managers = { presence: { get: vi.fn(async () => []) } }

beforeEach(() => {
  managers.presence.get.mockClear()
  useChatsStore.setState({ meId: 1, dialogs: [] })
  useNavigationStore.setState({ selectedId: null, draftPeer: null })
  useChatStackStore.setState({ stack: [] }, false)
})

describe('openPeer: пустой ключ пира', () => {
  it.each([0, Number.NaN])('ключ %s не открывает ничего и в сеть не ходит', (id) => {
    openPeer(managers, { id, title: 'x' })

    expect(useNavigationStore.getState().selectedId).toBeNull()
    expect(useNavigationStore.getState().draftPeer).toBeNull()
    expect(useChatStackStore.getState().stack).toEqual([])
    expect(managers.presence.get).not.toHaveBeenCalled()
  })

  it('человек без диалога — черновик с числовым ключом (контроль)', () => {
    openPeer(managers, { id: 777001, title: 'Алиса Иванова' })

    expect(useNavigationStore.getState().selectedId).toBe('draft:777001')
    expect(useChatStackStore.getState().stack.map((d) => d.peerId)).toEqual([777001])
  })
})
