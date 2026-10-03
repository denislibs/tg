// Остров композера (`reactChatInput.ts`, ВРЕМЕННО до К-4): класс отдаёт `Chat` и
// соседям члены tweb `ChatInput`, а состояние ввода держит React-дерево. Здесь —
// проводка класса: монтирование на `finishPeerChange`, обновление тем же корнем,
// ручки дерева за методами класса, излишек высоты и снятие на `destroy`.
// Дерево подменено: предмет — класс, а не композер.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createElement, useLayoutEffect } from 'react'
import type { Managers } from '@/client/bootstrap'
import type { MyMessage } from '@core/models'
import type { AppImManager } from '@lib/appImManager'
import { ChatType } from './chatType'
import type { ReactChatInputHandle, ReactChatInputHost } from './reactChatInput'
import type { ReactChatInputViewProps } from './reactChatInputView'

const renders: ReactChatInputViewProps[] = []
let handle: ReactChatInputHandle
const fns = {
  canSendPlain: vi.fn(() => true),
  initMessageReply: vi.fn(),
  initMessageEditing: vi.fn(),
  sendDocument: vi.fn(() => true),
  clearHelper: vi.fn(),
  showNewMediaPopup: vi.fn(),
}
const updateChatInputHeight = vi.fn()

vi.mock('./reactChatInputView', () => ({
  default: (props: ReactChatInputViewProps) => {
    renders.push(props)
    useLayoutEffect(() => {
      props.input.handle = handle
      return () => { props.input.handle = undefined }
    }, [props.input])
    return createElement('div', { className: 'chat-input-container' },
      createElement('div', { className: 'input-message-input', contentEditable: true }))
  },
}))

const { default: ReactChatInput } = await import('./reactChatInput')

let resizeCallback: (() => void) | undefined
class FakeResizeObserver {
  constructor(cb: () => void) { resizeCallback = cb }
  observe() {}
  disconnect() { resizeCallback = undefined }
}

function makeHost(over: Partial<ReactChatInputHost> = {}): ReactChatInputHost {
  return {
    peerId: 42,
    type: ChatType.Chat,
    container: document.createElement('div'),
    canSend: () => Promise.resolve(true),
    updateChatInputHeight,
    bubbles: { onGoDownClick: vi.fn() },
    ...over,
  }
}

function makeInput(host = makeHost()) {
  const input = new ReactChatInput(host, {} as AppImManager, {} as Managers)
  input.construct()
  return input
}

beforeEach(() => {
  renders.length = 0
  Object.values(fns).forEach((fn) => fn.mockClear())
  updateChatInputHeight.mockClear()
  handle = { ...fns }
  vi.stubGlobal('ResizeObserver', FakeResizeObserver)
})
afterEach(() => {
  vi.unstubAllGlobals()
})

describe('ReactChatInput: узел и монтирование', () => {
  it('construct строит `.chat-input.chat-input-main` (tweb input.ts:231)', () => {
    const input = makeInput()
    expect(input.chatInput.classList.contains('chat-input')).toBe(true)
    expect(input.chatInput.classList.contains('chat-input-main')).toBe(true)
  })

  it('до finishPeerChange дерева нет: ручки без эффекта, canSendPlain — false', async() => {
    const input = makeInput()
    expect(input.canSendPlain()).toBe(false)
    expect(input.messageInput).toBeUndefined()
    expect(await input.sendMessageWithDocument({ document: {} as never })).toBe(false)
    input.initMessageReply({ replyToMsgId: 1 })
    expect(fns.initMessageReply).not.toHaveBeenCalled()
  })

  it('колбэк finishPeerChange монтирует дерево с пиром Chat, повторный — обновляет тот же корень', async() => {
    const host = makeHost()
    const input = makeInput(host)

    const mount = await input.finishPeerChange()
    expect(renders).toHaveLength(0) // монтирует колбэк, а не сам вызов (tweb chat.ts:1240-1244)
    mount()
    expect(renders[renders.length - 1]).toMatchObject({ peerId: 42, threadId: undefined })
    expect(input.messageInput).toBe(input.chatInput.querySelector('.input-message-input'))

    host.peerId = 7
    host.threadId = 3
    ;(await input.finishPeerChange())()
    expect(renders[renders.length - 1]).toMatchObject({ peerId: 7, threadId: 3 })
    expect(input.chatInput.querySelectorAll('.chat-input-container')).toHaveLength(1)
  })

  it('destroy снимает корень; поздний колбэк после destroy ничего не монтирует', async() => {
    const input = makeInput()
    const mount = await input.finishPeerChange()
    input.destroy()
    mount()
    expect(renders).toHaveLength(0)
    expect(input.chatInput.childElementCount).toBe(0)
  })
})

describe('ReactChatInput: члены tweb ChatInput — ручки дерева', () => {
  it('reply/editing/document/clearHelper/canSendPlain уходят в дерево', async() => {
    const input = makeInput()
    ;(await input.finishPeerChange())()

    const message = { _: 'message', id: 5 } as MyMessage
    input.initMessageReply(input.getChatInputReplyToFromMessage(message))
    expect(fns.initMessageReply).toHaveBeenCalledWith({ replyToMsgId: 5 })

    input.initMessageEditing(9)
    expect(fns.initMessageEditing).toHaveBeenCalledWith(9)

    expect(await input.sendMessageWithDocument({ document: { id: 1 } as never })).toBe(true)
    expect(fns.sendDocument).toHaveBeenCalledWith({ id: 1 })

    input.clearHelper()
    expect(fns.clearHelper).toHaveBeenCalled()

    expect(input.canSendPlain()).toBe(true)
  })
})

describe('ReactChatInput: попап медиа (шов popups/newMedia.ts, блок K appImManager)', () => {
  it('с ручкой — файлы уходят в дерево; до монтирования — ждут ручку; после destroy — нет', async() => {
    const file = new File(['x'], 'a.png', { type: 'image/png' })

    const early = makeInput()
    early.showNewMediaPopup([file], 'media')
    expect(fns.showNewMediaPopup).not.toHaveBeenCalled()
    expect(early.pendingNewMediaPopup).toEqual([[file], 'media'])

    const input = makeInput()
    ;(await input.finishPeerChange())()
    input.showNewMediaPopup([file], 'document')
    expect(fns.showNewMediaPopup).toHaveBeenCalledWith([file], 'document')
    expect(input.pendingNewMediaPopup).toBeUndefined()

    input.destroy()
    input.showNewMediaPopup([file], 'media')
    expect(input.pendingNewMediaPopup).toBeUndefined()
  })
})

describe('ReactChatInput: излишек высоты (tweb chat.ts:283)', () => {
  it('высота сверх 3rem уходит в chat.updateChatInputHeight, без повторов того же числа', () => {
    const input = makeInput()
    let height = 48
    Object.defineProperty(input.chatInput, 'offsetHeight', { get: () => height })

    resizeCallback?.()
    height = 80
    resizeCallback?.()
    resizeCallback?.()
    height = 30
    resizeCallback?.()

    expect(updateChatInputHeight.mock.calls).toEqual([[0], [32], [0]])
  })

  it('destroy отключает наблюдатель', () => {
    const input = makeInput()
    input.destroy()
    expect(resizeCallback).toBeUndefined()
  })
})
