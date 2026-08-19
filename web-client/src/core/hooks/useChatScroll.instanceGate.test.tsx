// src/core/hooks/useChatScroll.instanceGate.test.tsx
//
// Ревью Task 6 нашло реальный баг: useChatScroll бьёт по grep'у Step 1
// (window.addEventListener|document.addEventListener|document.body.classList)
// только по строке `window.addEventListener('focus', ...)`, но мест, способных
// отметить чат прочитанным (markRead) независимо от того, смотрит ли
// пользователь на этот инстанс, в хуке ЧЕТЫРЕ — и ни одно не было гейтировано
// активностью инстанса:
//   1. rootScope.addEventListener(RT.newMessage, ...) — глобальная подписка;
//   2. эффект «mark read on open / at the bottom» — реагирует на win.msgs;
//   3. window.addEventListener('focus', ...) — глобальное событие;
//   4. markRead ВНУТРИ onAdditionalScroll (атрибут «прижат к низу») — не
//      addEventListener сама по себе, но зовётся программно на монтировании и
//      на каждое изменение win.msgs/win.reachedBottom (эффекты хука), то есть
//      у ЛЮБОГО смонтированного инстанса, а не только у того, на чей
//      собственный scroll-контейнер пришло настоящее пользовательское событие.
// Механизм общий: у скрытого (display:none) инстанса в стеке
// scrollHeight/clientHeight/scrollTop равны 0 (happy-dom тоже это отражает —
// геометрия непатченного элемента всегда нулевая), поэтому любое условие вида
// «прижат к низу» (`scrollHeight - scrollTop - clientHeight < 240`,
// `atBottomRef`) тривиально истинно — фоновый инстанс читает чат за
// пользователя. Этот файл бьёт по НАСТОЯЩЕМУ хуку через настоящий React-эффект-
// цикл (не копирует гейт в тесте) — рендерит его внутри ChatInstanceProvider с
// isActive: false/true и проверяет вызов managers.realtime.markRead. Пути 1-3
// изолированы явно (см. комментарии у каждого describe); путь 4 срабатывает
// вместе с путём 2 на монтировании — те же тесты, что доказывают гейт 2,
// красятся мутацией и гейта 4 (см. отчёт).
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render } from '@testing-library/react'
import { useChatScroll } from './useChatScroll'
import { ManagersProvider } from './useManagers'
import { ChatInstanceProvider } from '../chat/chatInstanceContext'
import type { ChatInstanceDesc } from '../../stores/chatStackStore'
import type { MessageWindow } from './useMessageWindow'
import type { Message } from '../models'
import rootScope from '@lib/rootScope'
import { RT, type NewMessageEvt } from '../realtime/events'

afterEach(cleanup)

function msg(seq: number): Message {
  return {
    id: seq, peerId: 1, seq, senderId: 1, type: 'text', text: `m${seq}`,
    replyToId: null, mediaId: null, createdAt: '2026-06-24T10:00:00Z', threadRootId: null,
  }
}

function makeWin(msgs: Message[], overrides: Partial<MessageWindow> = {}): MessageWindow {
  return {
    msgs, reachedTop: false, reachedBottom: true, loadingOlder: false, loadingNewer: false,
    loading: false, loadedFromCache: false,
    loadOlder: async () => {}, loadNewer: async () => {},
    appendLocal: () => {}, applyIncoming: () => {}, applyEdit: () => {},
    jumpTo: async () => {}, reloadNewest: async () => {}, applyDelete: () => {},
    ...overrides,
  }
}

const desc = (key: string): ChatInstanceDesc => ({ key, peerId: 1, type: 'chat' })

function Harness({ win }: { win: MessageWindow }) {
  const { scrollRef } = useChatScroll({
    numericChatId: 1, isRealChat: true, win, paddingTop: 0, unreadDividerSeq: null, unreadStickyTop: 0,
  })
  return <div ref={scrollRef} />
}

function mount(win: MessageWindow, markRead: (args: { peerId: PeerId, upToSeq: number }) => void, isActive: boolean) {
  const managers = { realtime: { markRead: async (args: { peerId: PeerId, upToSeq: number }) => { markRead(args) } } }
  return render(
    <ManagersProvider managers={managers as never}>
      <ChatInstanceProvider value={{ desc: desc('a'), isActive }}>
        <Harness win={win} />
      </ChatInstanceProvider>
    </ManagersProvider>,
  )
}

describe('useChatScroll: markRead-эффекты гейтированы активностью инстанса', () => {
  // Эффект 1 (Chat.tsx-независимый): rootScope.addEventListener(RT.newMessage, ...).
  describe('RT.newMessage → markRead', () => {
    it('фоновый (isActive: false) инстанс НЕ отмечает чат прочитанным', () => {
      const markRead = vi.fn()
      // reachedBottom: false отключает эффект 2 (mark read on open) на монтировании,
      // изолируя проверку именно от обработчика RT.newMessage.
      const win = makeWin([msg(1)], { reachedBottom: false })
      mount(win, markRead, false)

      act(() => { rootScope.dispatchEventSingle(RT.newMessage, { peer_id: 1, seq: 42 } as unknown as NewMessageEvt) })

      expect(markRead).not.toHaveBeenCalled()
    })

    it('активный (isActive: true) инстанс отмечает чат прочитанным', () => {
      const markRead = vi.fn()
      const win = makeWin([msg(1)], { reachedBottom: false })
      mount(win, markRead, true)

      act(() => { rootScope.dispatchEventSingle(RT.newMessage, { peer_id: 1, seq: 42 } as unknown as NewMessageEvt) })

      expect(markRead).toHaveBeenCalledWith({ peerId: 1, upToSeq: 42 })
    })
  })

  // Эффект 2: mark read on open / at the bottom — срабатывает на монтировании
  // (win.reachedBottom уже true), без единого события.
  describe('mark read on open / at the bottom', () => {
    it('фоновый (isActive: false) инстанс НЕ отмечает чат прочитанным при монтировании', () => {
      const markRead = vi.fn()
      const win = makeWin([msg(1), msg(2)], { reachedBottom: true })
      mount(win, markRead, false)

      expect(markRead).not.toHaveBeenCalled()
    })

    it('активный (isActive: true) инстанс отмечает чат прочитанным при монтировании', () => {
      const markRead = vi.fn()
      const win = makeWin([msg(1), msg(2)], { reachedBottom: true })
      mount(win, markRead, true)

      expect(markRead).toHaveBeenCalledWith({ peerId: 1, upToSeq: 2 })
    })
  })

  // Эффект 3: window.addEventListener('focus', ...) — глобальное событие,
  // слышат все смонтированные инстансы разом.
  describe('window focus → markRead', () => {
    it('фоновый (isActive: false) инстанс НЕ отмечает чат прочитанным по фокусу окна', () => {
      const markRead = vi.fn()
      const win = makeWin([msg(1)], { reachedBottom: false })
      mount(win, markRead, false)

      act(() => { window.dispatchEvent(new Event('focus')) })

      expect(markRead).not.toHaveBeenCalled()
    })

    it('активный (isActive: true) инстанс отмечает чат прочитанным по фокусу окна', () => {
      const markRead = vi.fn()
      const win = makeWin([msg(1)], { reachedBottom: false })
      mount(win, markRead, true)

      act(() => { window.dispatchEvent(new Event('focus')) })

      expect(markRead).toHaveBeenCalledWith({ peerId: 1, upToSeq: 1 })
    })
  })
})
