// src/core/hooks/useChatScroll.hiddenAtBottomGate.test.tsx
//
// Финальное ревью этапа 1 (стек инстансов чата) нашло блокер: onAdditionalScroll
// (useChatScroll.ts) вычисляет `atBottomRef.current = !userScrolledUpRef.current
// || atRealBottom`, где `atRealBottom` считается из геометрии скролл-контейнера.
// У СКРЫТОГО узла стека (display:none — неактивная копия, useChatScroll.instanceGate
// уже гейтит markRead-эффекты этим же признаком) scrollHeight/clientHeight/scrollTop
// равны нулю, поэтому `dist = scrollHeight - scrollTop - clientHeight` тривиально 0
// и «прижат к низу» тривиально истинно — НЕЗАВИСИМО от того, был ли пользователь
// реально прокручен вверх до того, как инстанс скрылся.
//
// Эффект `useEffect(() => { onAdditionalScroll() }, [win.msgs, win.reachedBottom, ...])`
// не гейтирован активностью (в отличие от markRead-эффектов) — он зовётся у ЛЮБОГО
// смонтированного инстанса на любое изменение окна сообщений (пришло/отредактировано/
// удалено сообщение). Без фикса это переписывает atBottomRef фонового инстанса в
// true на КАЖДОЕ такое изменение; на возврате активности ResizeObserver (correctScroll)
// видит atBottomRef===true и пином к низу уничтожает сохранённую chatPositions-позицию.
//
// Фикс — тот же признак «есть ли у контейнера layout box» (clientHeight > 0), что
// уже используется в этом файле для гейта сохранения позиции (см. cleanup мемонтирования
// и эффект isActive true→false): запись atBottomRef/userScrolledUpRef (не чтение
// геометрии — showScrollDown/markRead остаются как есть) блокируется, пока
// clientHeight === 0.
//
// Пара тестов ниже бьёт по НАСТОЯЩЕМУ хуку через настоящий React-эффект-цикл, как
// useChatScroll.instanceGate.test.tsx — не копирует гейт, а рендерит компонент и
// читает возвращённый atBottomRef (тот же useRef-объект переживает rerender того же
// инстанса хука). Геометрия управляется тестом через прототипные аксессоры (приём
// ChatsContainer.positions.test.tsx) — единственный способ смоделировать «скрытый»
// (нулевая) и «видимый» (реальная) геометрию для ОДНОГО и того же сценария.
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { act, cleanup, render } from '@testing-library/react'
import { useChatScroll } from './useChatScroll'
import { ManagersProvider } from './useManagers'
import { ChatInstanceProvider } from '../chat/chatInstanceContext'
import type { ChatInstanceDesc } from '../../stores/chatStackStore'
import type { MessageWindow } from './useMessageWindow'
import type { Message } from '../models'

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
const fakeManagers = { realtime: { markRead: async () => {} } }

// Геометрия одного скролл-контейнера (по тесту всегда ровно один), выставляемая
// явно — не WeakMap с несколькими узлами: каждый test-кейс монтирует свой Harness.
let geom = { clientHeight: 0, scrollHeight: 0, scrollTop: 0 }

function patchAccessor(target: object, name: string, descriptor: PropertyDescriptor): () => void {
  const hadOwn = Object.prototype.hasOwnProperty.call(target, name)
  const original = hadOwn ? Object.getOwnPropertyDescriptor(target, name) : undefined
  Object.defineProperty(target, name, { configurable: true, ...descriptor })
  return () => {
    if (hadOwn && original) Object.defineProperty(target, name, original)
    else delete (target as Record<string, unknown>)[name]
  }
}

let restoreAll: (() => void)[] = []

beforeAll(() => {
  restoreAll = [
    patchAccessor(HTMLElement.prototype, 'clientHeight', {
      get(this: HTMLElement) { return this.dataset.scrollContainer != null ? geom.clientHeight : 0 },
    }),
    patchAccessor(Element.prototype, 'scrollHeight', {
      get(this: HTMLElement) { return this.dataset.scrollContainer != null ? geom.scrollHeight : 0 },
    }),
    patchAccessor(Element.prototype, 'scrollTop', {
      get(this: HTMLElement) { return this.dataset.scrollContainer != null ? geom.scrollTop : 0 },
      set(this: HTMLElement, v: number) { if (this.dataset.scrollContainer != null) geom.scrollTop = v },
    }),
  ]
})
afterAll(() => { for (const undo of restoreAll) undo() })
afterEach(cleanup)

function Inner({ win, apiRef }: {
  win: MessageWindow
  apiRef: { current: ReturnType<typeof useChatScroll> | null }
}) {
  const api = useChatScroll({
    numericChatId: 1, isRealChat: true, win, paddingTop: 0, unreadDividerSeq: null, unreadStickyTop: 0,
  })
  apiRef.current = api
  return <div ref={api.scrollRef} data-scroll-container="1" />
}

function Harness({ win, isActive, apiRef }: {
  win: MessageWindow
  isActive: boolean
  apiRef: { current: ReturnType<typeof useChatScroll> | null }
}) {
  return (
    <ManagersProvider managers={fakeManagers as never}>
      <ChatInstanceProvider value={{ desc: desc('a'), isActive }}>
        <Inner win={win} apiRef={apiRef} />
      </ChatInstanceProvider>
    </ManagersProvider>
  )
}

describe('useChatScroll: onAdditionalScroll не переписывает намерение скролла у скрытого узла', () => {
  it('скрытый (isActive:false, нулевая геометрия) инстанс: новое сообщение НЕ флипает atBottomRef в true', () => {
    geom = { clientHeight: 0, scrollHeight: 0, scrollTop: 0 }
    const apiRef: { current: ReturnType<typeof useChatScroll> | null } = { current: null }
    const win1 = makeWin([msg(1)], { reachedBottom: true })
    const { rerender } = render(<Harness win={win1} isActive={false} apiRef={apiRef} />)

    // Пользователь реально прокрутил вверх и ушёл в тред (инстанс стал фоновым) —
    // намерение «не прижат к низу» уже установлено ДО следующего изменения окна.
    apiRef.current!.atBottomRef.current = false
    apiRef.current!.userScrolledUpRef.current = true

    // Пришло новое сообщение в фоновый чат — win.msgs меняется, эффект
    // [win.msgs, win.reachedBottom, onAdditionalScroll] перезовёт onAdditionalScroll
    // программно (не через настоящий scroll-event, которого у скрытого узла и не бывает).
    const win2 = makeWin([msg(1), msg(2)], { reachedBottom: true })
    act(() => { rerender(<Harness win={win2} isActive={false} apiRef={apiRef} />) })

    expect(apiRef.current!.atBottomRef.current).toBe(false)
  })

  it('активный (isActive:true, реальная геометрия) инстанс: то же изменение окна пересчитывает atBottomRef как раньше', () => {
    // Реальная геометрия: контейнер прижат к низу (dist < 240) → эффект обязан
    // ПЕРЕЗАПИСАТЬ atBottomRef в true, даже если до этого пользователь скроллил
    // вверх где-то ещё в истории этого же инстанса — гейт не должен блокировать
    // настоящий пересчёт активного узла.
    geom = { clientHeight: 500, scrollHeight: 2000, scrollTop: 1400 } // dist = 100 < 240
    const apiRef: { current: ReturnType<typeof useChatScroll> | null } = { current: null }
    const win1 = makeWin([msg(1)], { reachedBottom: true })
    const { rerender } = render(<Harness win={win1} isActive={true} apiRef={apiRef} />)

    apiRef.current!.atBottomRef.current = false
    apiRef.current!.userScrolledUpRef.current = true

    const win2 = makeWin([msg(1), msg(2)], { reachedBottom: true })
    act(() => { rerender(<Harness win={win2} isActive={true} apiRef={apiRef} />) })

    expect(apiRef.current!.atBottomRef.current).toBe(true)
  })
})
