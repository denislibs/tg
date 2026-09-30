// `selectChat` — порт `appImManager.setPeer` для выбора из списка. Пустой ключ
// (`''`, `'0'`, `'draft:'`, не число) у оригинала чата не открывает: `setPeer`
// с `!peerId` уводит к списку (tweb appImManager.ts:3322), а инстанса с
// пустым пиром, который ушёл бы в сеть (`/chats/0/history`), не бывает.
import { beforeEach, describe, expect, it } from 'vitest'
import { useNavigationStore } from './navigationStore'
import { useChatStackStore } from './chatStackStore'

beforeEach(() => {
  useNavigationStore.setState({ selectedId: null, draftPeer: null })
  useChatStackStore.setState({ stack: [] }, false)
})

describe('navigationStore.selectChat', () => {
  it.each(['0', 'draft:0', 'draft:', 'abc'])('пустой ключ %j стек не наполняет', (id) => {
    useChatStackStore.getState().setPeer({ peerId: 5, type: 'chat' })
    useNavigationStore.getState().selectChat(id)
    expect(useChatStackStore.getState().stack).toEqual([])
  })

  it('ключ черновика `draft:<id>` кладёт в стек числовой пир', () => {
    useNavigationStore.getState().selectChat('draft:777001')
    expect(useChatStackStore.getState().stack.map((d) => d.peerId)).toEqual([777001])
  })
})
