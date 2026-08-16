// src/components/chat/ChatsContainer.positions.test.tsx
//
// Ревью Task 7 (Important): изолированный `useChatScroll.positions.test.tsx`
// мокает `chatPositions` и бьёт по подключению НАПРЯМУЮ — он доказывает, что
// хук зовёт save/get в нужных точках, но не задействует буквальный сценарий
// брифа целиком: реальный `ChatsContainer`/`runNavigationTransition` (не
// мокнутые здесь, в отличие от `ChatsContainer.test.tsx`), настоящий модуль
// `chatPositions` (не мок — используется его собственный `clearChatPositions`),
// реальные таймеры navigation-перехода.
//
// Именно это разложение и вскрыло Critical-баг: при одиночном pop нижний
// инстанс НЕ размонтируется (ChatsContainer держит его в renderList) — хук
// «зря» пересоздаёт Scrollable только когда узел реально уходит из DOM
// (переоткрытие того же чата/треда через коллапс стека, `setPeer`). Здесь
// это воспроизведено буквально: чат 1 → тред поверх → коллапс стека на
// ДРУГОЙ чат (единственный надёжный способ реально снять чат 1 и тред из
// DOM, не просто спрятать классом) → возврат в чат 1. Без фикса (сохранение
// только в cleanup, без гейта на видимость) это восстанавливало 0 — см.
// «Проверка на порче» в task-7-report.md.
//
// Geometry управляется тестом (happy-dom layout не считает, как и в
// useChatScroll.test.tsx), но, в отличие от него, здесь clientHeight/
// scrollHeight/scrollTop зависят от РЕАЛЬНОГО состояния DOM — несёт ли
// ближайший `.tabs-tab` (узел, которым владеет ChatsContainer) класс
// `.active` — а не от значения, которое тест выставляет руками. Класс
// `.active`/его снятие управляются настоящим `runNavigationTransition`, не
// тестом: это и есть то самое условие гонки таймеров из Critical-ревью.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { act, cleanup, render } from '@testing-library/react'
import ChatsContainer from './ChatsContainer'
import { useChatStackStore, type ChatInstanceDesc } from '../../stores/chatStackStore'
import { clearChatPositions } from '../../core/chat/chatPositions'
import { useChatScroll } from '../../core/hooks/useChatScroll'
import { ManagersProvider } from '../../core/hooks/useManagers'
import type { MessageWindow } from '../../core/hooks/useMessageWindow'

const win: MessageWindow = {
  msgs: [], reachedTop: false, reachedBottom: true, loadingOlder: false, loadingNewer: false,
  loading: false, loadedFromCache: false,
  loadOlder: async () => {}, loadNewer: async () => {},
  appendLocal: () => {}, applyIncoming: () => {}, applyEdit: () => {},
  jumpTo: async () => {}, reloadNewest: async () => {}, applyDelete: () => {},
}
const fakeManagers = { realtime: { markRead: async () => {} } }

// Минимальный «инстанс» вместо настоящего Chat.tsx (тот огромный и его не
// импортирует ни один тест — см. web-client/CLAUDE.md, «Известное
// исключение»): ровно то, что нужно этому тесту — реальный scrollRef внутри
// узла, которым владеет ChatsContainer (`.tabs-tab`).
function Instance({ desc }: { desc: ChatInstanceDesc }) {
  const { scrollRef } = useChatScroll({
    numericChatId: desc.peerId, threadId: desc.threadId, isRealChat: true, win,
    paddingTop: 0, unreadDividerSeq: null, unreadStickyTop: 0,
  })
  return <div ref={scrollRef} data-scroll-container="1" data-testid={`scroll-${desc.key}`} />
}
const renderInstance = (desc: ChatInstanceDesc) => <Instance desc={desc} />

/** Видимость узла — то же условие, что и в проде: у ближайшего `.tabs-tab` есть класс `.active`. */
function isVisible(el: HTMLElement): boolean {
  const tab = el.closest('.tabs-tab')
  return !!tab && tab.classList.contains('active')
}

function patchAccessor(target: object, name: string, descriptor: PropertyDescriptor): () => void {
  const hadOwn = Object.prototype.hasOwnProperty.call(target, name)
  const original = hadOwn ? Object.getOwnPropertyDescriptor(target, name) : undefined
  Object.defineProperty(target, name, { configurable: true, ...descriptor })
  return () => {
    if (hadOwn && original) Object.defineProperty(target, name, original)
    else delete (target as Record<string, unknown>)[name]
  }
}

// scrollTop живёт как «настоящее» число (то, что было бы отрендерено, будь у
// узла layout box) в WeakMap, а не в самом DOM-свойстве — геттер прячет его
// за нулём, когда узел скрыт (CSSOM View: элемент без layout box → 0), сеттер
// пишет безусловно (в реальном браузере запись в скрытый узел тоже не
// теряется молча — теряется её ВИДИМЫЙ эффект, что здесь и моделируется).
const scrollBacking = new WeakMap<HTMLElement, number>()
let restoreAll: (() => void)[] = []

beforeAll(() => {
  restoreAll = [
    // clientHeight — собственное свойство HTMLElement.prototype (см. коммент в useChatScroll.test.tsx).
    patchAccessor(HTMLElement.prototype, 'clientHeight', {
      get(this: HTMLElement) {
        if (this.dataset.scrollContainer == null) return 0
        return isVisible(this) ? 500 : 0
      },
    }),
    // scrollHeight/scrollTop — собственные свойства Element.prototype.
    patchAccessor(Element.prototype, 'scrollHeight', {
      get(this: HTMLElement) {
        if (this.dataset.scrollContainer == null) return 0
        return isVisible(this) ? 2000 : 0
      },
    }),
    patchAccessor(Element.prototype, 'scrollTop', {
      get(this: HTMLElement) {
        if (this.dataset.scrollContainer == null) return scrollBacking.get(this) ?? 0
        return isVisible(this) ? scrollBacking.get(this) ?? 0 : 0
      },
      set(this: HTMLElement, v: number) { scrollBacking.set(this, v) },
    }),
  ]
})
afterAll(() => { for (const undo of restoreAll) undo() })

beforeEach(() => {
  useChatStackStore.setState({ stack: [] }, false)
  clearChatPositions()
})
afterEach(() => cleanup())

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// Таймеры настоящие (navigationTransition не мокнут) — ждём реальным
// временем с запасом (400мс > NAVIGATION_TRANSITION_TIME(250) + 100).
const TRANSITION_SETTLE_MS = 400

describe('ChatsContainer ↔ useChatScroll ↔ chatPositions: реальный стек, реальный navigation-переход', () => {
  it('возврат в чат после реального размонтирования восстанавливает сохранённую позицию, а не 0', async () => {
    act(() => {
      useChatStackStore.getState().setPeer({ peerId: 1, type: 'chat' })
    })
    const { container } = render(
      <ManagersProvider managers={fakeManagers as never}>
        <ChatsContainer renderInstance={renderInstance} />
      </ManagersProvider>,
    )

    // Пользователь прокрутил ленту чата 1.
    const scrollEl1 = container.querySelector('[data-testid="scroll-1_0_chat"]') as HTMLDivElement
    act(() => { scrollEl1.scrollTop = 777 })
    expect(scrollEl1.scrollTop).toBe(777) // видим — стаб честно отдаёт записанное

    // Открыт тред поверх (push): чат 1 уходит с переднего плана (isActive
    // false), но остаётся в DOM — ChatsContainer коммитит push сразу.
    act(() => {
      useChatStackStore.getState().setInnerPeer({ peerId: 1, threadId: 9, type: 'discussion' })
    })
    await act(async () => { await wait(TRANSITION_SETTLE_MS) })

    // Инвариант `.active` (ChatsContainer.test.tsx намеренно его не проверяет —
    // там runNavigationTransition замокан; здесь переход настоящий): после
    // оседания push единственный `.active` узел — новый верхний (тред), не
    // прежний корень. Именно эта разметка и делает возможной саму проверку
    // геометрии выше/ниже (isVisible читает ровно этот класс).
    const tabsAfterPush = Array.from(container.querySelectorAll('.chats-container > .chat.tabs-tab'))
    expect(tabsAfterPush.filter((t) => t.classList.contains('active'))).toHaveLength(1)
    expect(container.querySelector('[data-testid="scroll-1_9_discussion"]')?.closest('.tabs-tab')?.classList.contains('active')).toBe(true)
    expect(container.querySelector('[data-testid="scroll-1_0_chat"]')?.closest('.tabs-tab')?.classList.contains('active')).toBe(false)

    // Коллапс стека на ДРУГОЙ чат — единственный надёжный способ реально
    // снять чат 1 (и тред) из DOM без переиспользования ключа (одиночный pop
    // держит нижний инстанс смонтированным всегда — не тот сценарий).
    act(() => {
      useChatStackStore.getState().setPeer({ peerId: 2, type: 'chat' })
    })
    await act(async () => { await wait(TRANSITION_SETTLE_MS) })
    expect(container.querySelector('[data-testid="scroll-1_0_chat"]')).toBeNull() // реально размонтирован

    // Возврат в чат 1 — новый маунт с нуля (тот же ключ, что и раньше, но
    // старого узла с этим ключом уже нет ни в дереве, ни в DOM).
    act(() => {
      useChatStackStore.getState().setPeer({ peerId: 1, type: 'chat' })
    })

    const scrollEl1Again = container.querySelector('[data-testid="scroll-1_0_chat"]') as HTMLDivElement
    expect(scrollEl1Again).not.toBeNull()
    expect(scrollEl1Again.scrollTop).toBe(777)
  })
})
