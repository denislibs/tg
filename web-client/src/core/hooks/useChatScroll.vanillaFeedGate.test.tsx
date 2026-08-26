// src/core/hooks/useChatScroll.vanillaFeedGate.test.tsx
//
// Под флагом `VITE_VANILLA_FEED=1` отметкой прочтения владеет САМА императивная
// лента (`components/chat/bubbles.ts`, наблюдатель за непрочитанными баблами —
// порт tweb bubbles.ts:2941-3012). Этот хук в том же режиме остаётся
// смонтированным (`Chat.tsx:512` зовёт его БЕЗУСЛОВНО), но своего узла не
// получает вовсе — «прижат ли к низу» у него тривиально истинно, и без гейта он
// отмечал бы прочитанным ВСЁ ЗАГРУЖЕННОЕ окно, забивая точный рубеж ленты.
//
// Файл пинит ровно гейт `OWNS_READ_MARKER`: все четыре пути отметки молчат.
// Что они работают при выключенном флаге — пинит
// `useChatScroll.instanceGate.test.tsx` (там `AppConfig` настоящий, флаг по
// умолчанию выключен, `config/app.ts:38`).
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render } from '@testing-library/react'

// Мок ставится ДО импорта хука: `OWNS_READ_MARKER` считается на загрузке модуля,
// как и сам `AppConfig` (build-time флаг).
vi.mock('@config/app', () => ({ AppConfig: { vanillaFeed: true, dnp: { enabled: false, serverStaticPublicKeys: [] }, tlWire: false } }))

const { useChatScroll } = await import('./useChatScroll')
const { ManagersProvider } = await import('./useManagers')
const { ChatInstanceProvider } = await import('../chat/chatInstanceContext')
const rootScope = (await import('@lib/rootScope')).default
const { RT } = await import('../realtime/events')
const { makeMessage, makeRawMessage } = await import('../messages/testMessage')
const { generateMessageId } = await import('../history/messageId')

import type { ChatInstanceDesc } from '../../stores/chatStackStore'
import type { MessageWindow } from './useMessageWindow'
import type { MyMessage } from '../models'
import type { NewMessageEvt } from '../realtime/events'

afterEach(cleanup)

const cid = generateMessageId
const msg = (id: number): MyMessage => makeMessage({ id: cid(id), peerId: 1, fromId: 1, text: `m${id}` })
const newMessageEvt = (id: number): NewMessageEvt =>
  ({ _: 'updateNewMessage', message: makeRawMessage({ id, peerId: 1, fromId: 1, text: `m${id}` }) })

function makeWin(msgs: MyMessage[], overrides: Partial<MessageWindow> = {}): MessageWindow {
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

/** Инстанс АКТИВНЫЙ: гейт активности здесь отключён специально — молчать всё
 *  обязано из-за флага ленты, а не из-за того, что вкладка фоновая. */
function mount(win: MessageWindow, markRead: () => void) {
  const managers = { realtime: { markRead: async () => { markRead() } } }
  return render(
    <ManagersProvider managers={managers as never}>
      <ChatInstanceProvider value={{ desc: desc('a'), isActive: true }}>
        <Harness win={win} />
      </ChatInstanceProvider>
    </ManagersProvider>,
  )
}

describe('useChatScroll: под VITE_VANILLA_FEED отметку ведёт лента, а не хук', () => {
  it('открытие чата у низа истории (эффект «mark read on open» + onAdditionalScroll) молчит', () => {
    const markRead = vi.fn()
    mount(makeWin([msg(1), msg(2)]), markRead)
    expect(markRead).not.toHaveBeenCalled()
  })

  it('живое входящее (RT.newMessage) молчит', () => {
    const markRead = vi.fn()
    mount(makeWin([msg(1)], { reachedBottom: false }), markRead)

    act(() => { rootScope.dispatchEventSingle(RT.newMessage, newMessageEvt(42)) })

    expect(markRead).not.toHaveBeenCalled()
  })

  it('возврат фокуса в окно молчит', () => {
    const markRead = vi.fn()
    mount(makeWin([msg(1)], { reachedBottom: false }), markRead)

    act(() => { window.dispatchEvent(new Event('focus')) })

    expect(markRead).not.toHaveBeenCalled()
  })
})
