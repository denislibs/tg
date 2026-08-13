# Стек инстансов колонки чата — этап 1 (скелет)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** заменить «один `<Chat>` с пропом `thread`» на стек инстансов колонки чата с навигационной анимацией tweb, сохранением состояния при возврате и типом инстанса вместо булевых режимов.

**Architecture:** новый стор `chatStackStore` держит массив дескрипторов `{peerId, threadId, type}`; `ChatsContainer` рендерит по узлу на дескриптор внутри `.chats-container.tabs-container[data-animation="navigation"]` и переключает вкладки уже портированным `runNavigationTransition`; контекст `chatInstanceContext` сообщает инстансу, активен ли он, чтобы глобальные эффекты не срабатывали в нескольких смонтированных копиях.

**Tech Stack:** React 19, TypeScript strict, Zustand 5, vitest + @testing-library/react (happy-dom), SCSS-модули.

**Спека:** [`../specs/2026-08-13-chat-instance-stack-design.md`](../specs/2026-08-13-chat-instance-stack-design.md)
**Референс-док:** [`../../research/2026-08-13-tweb-channels-comments-reference.md`](../../research/2026-08-13-tweb-channels-comments-reference.md)

## Global Constraints

- Ворктри `.worktrees/chat-stack`, ветка `feat/chat-instance-stack`. Все команды — из `web-client/`.
- Отвечать по-русски, комментарии в коде — по-русски, как в остальном клиенте.
- Вёрстку и поведение брать из tweb, не выдумывать. Ссылки на исходники — `~/Documents/tweb`.
- TS strict: без `any`, без неиспользуемых переменных (иначе сборка падает).
- Анимации — только CSS-классами tweb; JS их лишь переключает. `framer-motion`/`@mui` не добавлять.
- Стор — Zustand, в `src/stores/`. Компоненты читают через селектор, не `getState()`.
- Норма проводки (`web-client/CLAUDE.md`): каждая строка проводки либо краснит тест при удалении/порче, либо помечена комментарием у себя с причиной.
- После каждой задачи: `npm test`, `npm run typecheck`, `npm run lint` — все три зелёные до коммита.
- Тип инстанса — строковый союз (`'chat' | 'discussion' | …`), значения совпадают с `data-type` в живом DOM tweb (`chat`, `discussion`).

---

## Файловая структура

| Файл | Ответственность |
|---|---|
| `src/stores/chatStackStore.ts` (создать) | стек дескрипторов + действия `setPeer`/`setInnerPeer`/`popTo`/`closeTop` + селекторы |
| `src/stores/chatStackStore.test.ts` (создать) | поведение стека |
| `src/core/chat/chatPositions.ts` (создать) | сохранённые позиции скролла по ключу `peerId_threadId` |
| `src/core/chat/chatPositions.test.ts` (создать) | сохранение/восстановление |
| `src/core/chat/chatInstanceContext.tsx` (создать) | контекст инстанса + `useIsActiveChat` |
| `src/core/chat/chatInstanceContext.test.tsx` (создать) | гейт двойных эффектов |
| `src/components/chat/ChatsContainer.tsx` (создать) | рендер узлов стека + переключение вкладок |
| `src/components/chat/ChatsContainer.test.tsx` (создать) | структура, классы, вызовы перехода |
| `src/App.tsx` (изменить) | рендерит `ChatsContainer`, резолвит дескриптор → `ChatEntity` |
| `src/stores/navigationStore.ts` (изменить) | тред уезжает в стек; остаётся `selectedId`/`draftPeer` |
| `src/core/hooks/useChatNavigation.ts`, `useNavigationActions.ts`, `useAppHotkeys.ts`, `useUrlSync.ts`, `useShellTheme.ts`, `src/components/Sidebar.tsx`, `src/components/Chat.tsx` (изменить) | переезд потребителей `openThread` на стек |

---

### Task 1: стор стека

**Files:**
- Create: `web-client/src/stores/chatStackStore.ts`
- Test: `web-client/src/stores/chatStackStore.test.ts`

**Interfaces:**
- Consumes: `ThreadInfo` из `src/components/Chat.tsx` (существующий экспортируемый интерфейс).
- Produces: `useChatStackStore`, `ChatType`, `ChatInstanceDesc`, `OpenChatOptions`, `descKey`, `selectActive`, `selectRoot`, `selectOpenThread`.

- [ ] **Step 1: Написать падающий тест**

```ts
// web-client/src/stores/chatStackStore.test.ts
import { beforeEach, describe, expect, it } from 'vitest'
import { useChatStackStore, descKey, selectActive, selectRoot, selectOpenThread } from './chatStackStore'

const thread = { rootMsgId: 7, title: 'Comments', kind: 'comments' as const }

beforeEach(() => {
  useChatStackStore.setState({ stack: [] }, false)
})

describe('chatStackStore', () => {
  it('setPeer кладёт единственный инстанс и схлопывает стек', () => {
    const { setPeer, setInnerPeer } = useChatStackStore.getState()
    setPeer({ peerId: 1, type: 'chat' })
    setInnerPeer({ peerId: 2, threadId: 7, type: 'discussion', thread })

    setPeer({ peerId: 3, type: 'chat' })

    const { stack } = useChatStackStore.getState()
    expect(stack.map((d) => d.peerId)).toEqual([3])
  })

  it('setInnerPeer кладёт инстанс сверху', () => {
    const { setPeer, setInnerPeer } = useChatStackStore.getState()
    setPeer({ peerId: 1, type: 'chat' })
    setInnerPeer({ peerId: 2, threadId: 7, type: 'discussion', thread })

    const { stack } = useChatStackStore.getState()
    expect(stack).toHaveLength(2)
    expect(selectActive(useChatStackStore.getState())?.key).toBe(descKey({ peerId: 2, threadId: 7, type: 'discussion' }))
  })

  it('setInnerPeer на пир, который уже в стеке, срезает всё выше него', () => {
    const { setPeer, setInnerPeer } = useChatStackStore.getState()
    setPeer({ peerId: 1, type: 'chat' })
    setInnerPeer({ peerId: 2, threadId: 7, type: 'discussion', thread })
    setInnerPeer({ peerId: 5, type: 'chat' })

    setInnerPeer({ peerId: 2, threadId: 7, type: 'discussion', thread })

    expect(useChatStackStore.getState().stack.map((d) => d.peerId)).toEqual([1, 2])
  })

  it('closeTop снимает верхний, но не опустошает стек', () => {
    const { setPeer, setInnerPeer, closeTop } = useChatStackStore.getState()
    setPeer({ peerId: 1, type: 'chat' })
    setInnerPeer({ peerId: 2, threadId: 7, type: 'discussion', thread })

    closeTop()
    expect(useChatStackStore.getState().stack.map((d) => d.peerId)).toEqual([1])

    closeTop()
    expect(useChatStackStore.getState().stack.map((d) => d.peerId)).toEqual([1])
  })

  it('ключ различает корневой чат и его тред', () => {
    expect(descKey({ peerId: 2, type: 'chat' })).not.toBe(descKey({ peerId: 2, threadId: 7, type: 'chat' }))
  })

  it('selectRoot — дно стека (подсветка в списке), selectOpenThread — только при глубине > 1', () => {
    const { setPeer, setInnerPeer } = useChatStackStore.getState()
    setPeer({ peerId: 1, type: 'chat' })
    expect(selectOpenThread(useChatStackStore.getState())).toBeNull()

    setInnerPeer({ peerId: 2, threadId: 7, type: 'discussion', thread })
    expect(selectRoot(useChatStackStore.getState())?.peerId).toBe(1)
    expect(selectOpenThread(useChatStackStore.getState())).toEqual({ chatId: 2, thread })
  })
})
```

- [ ] **Step 2: Прогнать тест, убедиться что падает**

Run: `cd web-client && npx vitest run src/stores/chatStackStore.test.ts`
Expected: FAIL — `Failed to resolve import "./chatStackStore"`.

- [ ] **Step 3: Реализовать стор**

```ts
// web-client/src/stores/chatStackStore.ts
import { create } from 'zustand'
import type { ThreadInfo } from '../components/Chat'

// Стек инстансов колонки чата — порт `appImManager.chats[]` (tweb
// lib/appImManager.ts:218). Открытие треда не подменяет содержимое текущего
// чата, а кладёт сверху новый инстанс; возврат снимает верхний и отдаёт
// нижнему его состояние. Верхний элемент — активный (инвариант).

/** Значения совпадают с `data-type` живого DOM tweb (`chat`, `discussion`). */
export type ChatType = 'chat' | 'discussion' | 'saved' | 'pinned' | 'search'

export interface ChatInstanceDesc {
  /** `${peerId}_${threadId ?? 0}_${type}` — он же ключ React-узла */
  key: string
  peerId: number
  threadId?: number
  type: ChatType
  /** только для type === 'search' */
  query?: string
  /** мета треда для шапки; на этапе 2 уедет в сам инстанс */
  thread?: ThreadInfo
}

export interface OpenChatOptions {
  peerId: number
  threadId?: number
  /** тип задаёт вызывающий: форум-топик в tweb остаётся `chat` с threadId
   *  (chat.ts:894), комментарии — `discussion` */
  type: ChatType
  query?: string
  thread?: ThreadInfo
}

export function descKey(o: { peerId: number; threadId?: number; type: ChatType }): string {
  return `${o.peerId}_${o.threadId ?? 0}_${o.type}`
}

function makeDesc(o: OpenChatOptions): ChatInstanceDesc {
  return {
    key: descKey(o),
    peerId: o.peerId,
    threadId: o.threadId,
    type: o.type,
    query: o.query,
    thread: o.thread,
  }
}

interface ChatStackState {
  stack: ChatInstanceDesc[]
  /** tweb setPeer: уход к другому пиру схлопывает стек до одного инстанса */
  setPeer: (o: OpenChatOptions) => void
  /** tweb setInnerPeer: положить сверху; тот же пир в стеке — срезать всё выше */
  setInnerPeer: (o: OpenChatOptions) => void
  popTo: (index: number) => void
  /** tweb spliceChats(chatIndex) при пустом peerId — снять верхний */
  closeTop: () => void
  clear: () => void
}

export const useChatStackStore = create<ChatStackState>((set) => ({
  stack: [],
  setPeer: (o) => set({ stack: [makeDesc(o)] }),
  setInnerPeer: (o) =>
    set((s) => {
      const desc = makeDesc(o)
      const i = s.stack.findIndex((d) => d.key === desc.key)
      return { stack: i === -1 ? [...s.stack, desc] : s.stack.slice(0, i + 1) }
    }),
  popTo: (index) => set((s) => ({ stack: index < 0 ? [] : s.stack.slice(0, index + 1) })),
  closeTop: () => set((s) => (s.stack.length > 1 ? { stack: s.stack.slice(0, -1) } : s)),
  clear: () => set({ stack: [] }),
}))

/** Активный инстанс — верхний (инвариант стека). */
export const selectActive = (s: ChatStackState): ChatInstanceDesc | undefined => s.stack[s.stack.length - 1]

/** Подсветку в списке чатов определяет ДНО стека: в tweb чат из списка — chats[0],
 *  а тред лежит поверх него и подсветку не меняет. */
export const selectRoot = (s: ChatStackState): ChatInstanceDesc | undefined => s.stack[0]

/** Совместимость с потребителями `navigationStore.openThread` на время этапа 1. */
export const selectOpenThread = (s: ChatStackState): { chatId: number; thread: ThreadInfo } | null => {
  const top = selectActive(s)
  return s.stack.length > 1 && top?.thread ? { chatId: top.peerId, thread: top.thread } : null
}
```

- [ ] **Step 4: Прогнать тесты**

Run: `cd web-client && npx vitest run src/stores/chatStackStore.test.ts`
Expected: PASS (6 тестов).

- [ ] **Step 5: Коммит**

```bash
git add web-client/src/stores/chatStackStore.ts web-client/src/stores/chatStackStore.test.ts
git commit -m "feat(chat): стор стека инстансов колонки чата (порт appImManager.chats)"
```

---

### Task 2: сохранённые позиции скролла

**Files:**
- Create: `web-client/src/core/chat/chatPositions.ts`
- Test: `web-client/src/core/chat/chatPositions.test.ts`

**Interfaces:**
- Produces: `saveChatPosition(peerId, threadId, pos)`, `getChatPosition(peerId, threadId)`, `clearChatPositions()`, тип `ChatPosition = { top: number }`.

- [ ] **Step 1: Написать падающий тест**

```ts
// web-client/src/core/chat/chatPositions.test.ts
import { beforeEach, describe, expect, it } from 'vitest'
import { saveChatPosition, getChatPosition, clearChatPositions } from './chatPositions'

beforeEach(() => clearChatPositions())

describe('chatPositions', () => {
  it('возвращает сохранённую позицию', () => {
    saveChatPosition(5, undefined, { top: 120 })
    expect(getChatPosition(5, undefined)).toEqual({ top: 120 })
  })

  it('позиция треда не смешивается с позицией самого чата', () => {
    saveChatPosition(5, undefined, { top: 120 })
    saveChatPosition(5, 7, { top: 30 })

    expect(getChatPosition(5, undefined)).toEqual({ top: 120 })
    expect(getChatPosition(5, 7)).toEqual({ top: 30 })
  })

  it('для неизвестного ключа возвращает undefined', () => {
    expect(getChatPosition(42, undefined)).toBeUndefined()
  })
})
```

- [ ] **Step 2: Прогнать тест, убедиться что падает**

Run: `cd web-client && npx vitest run src/core/chat/chatPositions.test.ts`
Expected: FAIL — модуль не найден.

- [ ] **Step 3: Реализовать**

```ts
// web-client/src/core/chat/chatPositions.ts
// Порт `appImManager.getChatSavedPosition` (tweb lib/appImManager.ts:2151):
// позиция ленты запоминается по ключу `peerId` + `_threadId`, чтобы возврат
// из треда отдал нижнему инстансу ровно тот вид, который он имел до ухода.
// Персист в AppState (в tweb он есть) — отдельная задача, здесь только память.

export interface ChatPosition {
  top: number
}

const positions = new Map<string, ChatPosition>()

function key(peerId: number, threadId?: number): string {
  return threadId ? `${peerId}_${threadId}` : `${peerId}`
}

export function saveChatPosition(peerId: number, threadId: number | undefined, pos: ChatPosition): void {
  positions.set(key(peerId, threadId), pos)
}

export function getChatPosition(peerId: number, threadId?: number): ChatPosition | undefined {
  return positions.get(key(peerId, threadId))
}

export function clearChatPositions(): void {
  positions.clear()
}
```

- [ ] **Step 4: Прогнать тесты**

Run: `cd web-client && npx vitest run src/core/chat/chatPositions.test.ts`
Expected: PASS (3 теста).

- [ ] **Step 5: Коммит**

```bash
git add web-client/src/core/chat/chatPositions.ts web-client/src/core/chat/chatPositions.test.ts
git commit -m "feat(chat): сохранённые позиции ленты по ключу peer_thread"
```

---

### Task 3: контекст инстанса и гейт активности

**Files:**
- Create: `web-client/src/core/chat/chatInstanceContext.tsx`
- Test: `web-client/src/core/chat/chatInstanceContext.test.tsx`

**Interfaces:**
- Consumes: `ChatInstanceDesc` из Task 1.
- Produces: `ChatInstanceProvider` (React-провайдер, значение `{desc, isActive}`), `useChatInstance()`, `useIsActiveChat()`.

- [ ] **Step 1: Написать падающий тест**

```tsx
// web-client/src/core/chat/chatInstanceContext.test.tsx
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useEffect } from 'react'
import { cleanup, render } from '@testing-library/react'
import { ChatInstanceProvider, useIsActiveChat } from './chatInstanceContext'
import type { ChatInstanceDesc } from '../../stores/chatStackStore'

afterEach(cleanup)

const desc = (key: string): ChatInstanceDesc => ({ key, peerId: 1, type: 'chat' })

function GlobalEffect({ onFire }: { onFire: () => void }) {
  const isActive = useIsActiveChat()
  useEffect(() => {
    if (!isActive) return
    onFire()
  }, [isActive, onFire])
  return null
}

describe('chatInstanceContext', () => {
  it('при двух смонтированных инстансах глобальный эффект срабатывает один раз', () => {
    const onFire = vi.fn()

    render(
      <>
        <ChatInstanceProvider value={{ desc: desc('a'), isActive: false }}>
          <GlobalEffect onFire={onFire} />
        </ChatInstanceProvider>
        <ChatInstanceProvider value={{ desc: desc('b'), isActive: true }}>
          <GlobalEffect onFire={onFire} />
        </ChatInstanceProvider>
      </>,
    )

    expect(onFire).toHaveBeenCalledTimes(1)
  })

  it('вне провайдера инстанс считается активным (старые точки монтирования и тесты)', () => {
    const onFire = vi.fn()
    render(<GlobalEffect onFire={onFire} />)
    expect(onFire).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 2: Прогнать тест, убедиться что падает**

Run: `cd web-client && npx vitest run src/core/chat/chatInstanceContext.test.tsx`
Expected: FAIL — модуль не найден.

- [ ] **Step 3: Реализовать**

```tsx
// web-client/src/core/chat/chatInstanceContext.tsx
import { createContext, useContext } from 'react'
import type { ChatInstanceDesc } from '../../stores/chatStackStore'

// В стеке одновременно смонтировано несколько инстансов чата (неактивные
// скрыты `display: none`, но живут в DOM — как вкладки tabs-container в tweb).
// Поэтому любой эффект инстанса, который вешает слушатель на window/document
// или пишет в глобальное состояние, обязан быть за `useIsActiveChat()`:
// иначе он сработает во всех копиях сразу.

export interface ChatInstanceValue {
  desc: ChatInstanceDesc
  isActive: boolean
}

const ChatInstanceContext = createContext<ChatInstanceValue | null>(null)

export const ChatInstanceProvider = ChatInstanceContext.Provider

export function useChatInstance(): ChatInstanceValue | null {
  return useContext(ChatInstanceContext)
}

/** Вне провайдера (старые точки монтирования, юнит-тесты) инстанс активен. */
export function useIsActiveChat(): boolean {
  return useContext(ChatInstanceContext)?.isActive ?? true
}
```

- [ ] **Step 4: Прогнать тесты**

Run: `cd web-client && npx vitest run src/core/chat/chatInstanceContext.test.tsx`
Expected: PASS (2 теста).

- [ ] **Step 5: Коммит**

```bash
git add web-client/src/core/chat/chatInstanceContext.tsx web-client/src/core/chat/chatInstanceContext.test.tsx
git commit -m "feat(chat): контекст инстанса чата и гейт активности"
```

---

### Task 4: `ChatsContainer`

**Files:**
- Create: `web-client/src/components/chat/ChatsContainer.tsx`
- Test: `web-client/src/components/chat/ChatsContainer.test.tsx`

**Interfaces:**
- Consumes: `useChatStackStore`, `ChatInstanceDesc` (Task 1); `ChatInstanceProvider` (Task 3); `runNavigationTransition`, `NAVIGATION_TRANSITION_TIME` из `src/core/dom/navigationTransition.ts` (уже существуют).
- Produces: дефолтный экспорт `ChatsContainer` с пропом `renderInstance: (desc: ChatInstanceDesc) => ReactNode`.

**Механика перехода (почему два эффекта):** при *push* новый узел обязан существовать в DOM до анимации, поэтому сначала коммитится список, а переход запускается на следующем layout-эффекте. При *pop* уходящий узел обязан остаться в DOM на время анимации, поэтому список НЕ ужимается сразу — он подрезается по таймеру после перехода. Из-за этого рендер идёт из `renderList`, который всегда ⊇ `stack`.

- [ ] **Step 1: Написать падающий тест**

```tsx
// web-client/src/components/chat/ChatsContainer.test.tsx
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render } from '@testing-library/react'

const runNavigationTransition = vi.fn()
vi.mock('../../core/dom/navigationTransition', () => ({
  NAVIGATION_TRANSITION_TIME: 250,
  runNavigationTransition: (...args: unknown[]) => runNavigationTransition(...args),
}))

import ChatsContainer from './ChatsContainer'
import { useChatStackStore, type ChatInstanceDesc } from '../../stores/chatStackStore'

const thread = { rootMsgId: 7, title: 'Comments', kind: 'comments' as const }
const renderInstance = (d: ChatInstanceDesc) => <div data-testid={`body-${d.key}`}>{d.type}</div>

beforeEach(() => {
  vi.useFakeTimers()
  runNavigationTransition.mockClear()
  useChatStackStore.setState({ stack: [] }, false)
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('ChatsContainer', () => {
  it('рендерит по узлу на дескриптор, активен только верхний', () => {
    act(() => {
      useChatStackStore.getState().setPeer({ peerId: 1, type: 'chat' })
    })
    const { container } = render(<ChatsContainer renderInstance={renderInstance} />)

    act(() => {
      useChatStackStore.getState().setInnerPeer({ peerId: 2, threadId: 7, type: 'discussion', thread })
    })

    const tabs = container.querySelectorAll('.chats-container > .chat')
    expect(tabs).toHaveLength(2)
    expect(tabs[0].getAttribute('data-type')).toBe('chat')
    expect(tabs[1].getAttribute('data-type')).toBe('discussion')
  })

  it('контейнер размечен как навигационный вкладочник tweb', () => {
    act(() => {
      useChatStackStore.getState().setPeer({ peerId: 1, type: 'chat' })
    })
    const { container } = render(<ChatsContainer renderInstance={renderInstance} />)

    const el = container.querySelector('.chats-container')
    expect(el?.classList.contains('tabs-container')).toBe(true)
    expect(el?.getAttribute('data-animation')).toBe('navigation')
  })

  it('push играет переход вперёд, pop — назад', () => {
    act(() => {
      useChatStackStore.getState().setPeer({ peerId: 1, type: 'chat' })
    })
    render(<ChatsContainer renderInstance={renderInstance} />)
    runNavigationTransition.mockClear()

    act(() => {
      useChatStackStore.getState().setInnerPeer({ peerId: 2, threadId: 7, type: 'discussion', thread })
    })
    expect(runNavigationTransition).toHaveBeenCalledTimes(1)
    expect(runNavigationTransition.mock.calls[0][0]).toMatchObject({ toRight: true })

    act(() => {
      useChatStackStore.getState().closeTop()
    })
    expect(runNavigationTransition).toHaveBeenCalledTimes(2)
    expect(runNavigationTransition.mock.calls[1][0]).toMatchObject({ toRight: false })
  })

  it('на pop через уровень промежуточный узел убирается сразу', () => {
    act(() => {
      useChatStackStore.getState().setPeer({ peerId: 1, type: 'chat' })
      useChatStackStore.getState().setInnerPeer({ peerId: 2, threadId: 7, type: 'discussion', thread })
      useChatStackStore.getState().setInnerPeer({ peerId: 3, type: 'chat' })
    })
    const { container } = render(<ChatsContainer renderInstance={renderInstance} />)

    act(() => {
      useChatStackStore.getState().popTo(0)
    })

    // остаются дно стека и уходящий верхний; средний (peerId 2) уходит сразу
    const keys = Array.from(container.querySelectorAll('.chats-container > .chat')).map((n) => n.getAttribute('data-type'))
    expect(keys).toHaveLength(2)
    expect(container.querySelector('[data-testid="body-2_7_discussion"]')).toBeNull()
  })

  it('на pop уходящий узел остаётся в DOM до конца перехода', () => {
    act(() => {
      useChatStackStore.getState().setPeer({ peerId: 1, type: 'chat' })
    })
    const { container } = render(<ChatsContainer renderInstance={renderInstance} />)
    act(() => {
      useChatStackStore.getState().setInnerPeer({ peerId: 2, threadId: 7, type: 'discussion', thread })
    })

    act(() => {
      useChatStackStore.getState().closeTop()
    })
    expect(container.querySelectorAll('.chats-container > .chat')).toHaveLength(2)

    act(() => {
      vi.advanceTimersByTime(400)
    })
    expect(container.querySelectorAll('.chats-container > .chat')).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Прогнать тест, убедиться что падает**

Run: `cd web-client && npx vitest run src/components/chat/ChatsContainer.test.tsx`
Expected: FAIL — модуль `./ChatsContainer` не найден.

- [ ] **Step 3: Реализовать**

```tsx
// web-client/src/components/chat/ChatsContainer.tsx
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { useChatStackStore, type ChatInstanceDesc } from '../../stores/chatStackStore'
import { ChatInstanceProvider } from '../../core/chat/chatInstanceContext'
import { NAVIGATION_TRANSITION_TIME, runNavigationTransition } from '../../core/dom/navigationTransition'

// Порт `appImManager.chatsSelectTab` (tweb lib/appImManager.ts:2237) поверх уже
// портированного примитива перехода: контейнер — `.chats-container.tabs-container
// [data-animation="navigation"]` (tweb appImManager.ts:306-308), по узлу на
// инстанс стека, `.active` только у верхнего.
//
// Рендерим из renderList, а не прямо из stack: на push новый узел обязан
// появиться в DOM ДО анимации (переход запускается следующим layout-эффектом),
// на pop уходящий обязан дожить до её конца (список подрезается по таймеру).
// Поэтому renderList всегда ⊇ stack.

interface Props {
  /** тело инстанса; резолв дескриптора в сущность чата остаётся за вызывающим */
  renderInstance: (desc: ChatInstanceDesc) => ReactNode
}

export default function ChatsContainer({ renderInstance }: Props) {
  const stack = useChatStackStore((s) => s.stack)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const nodesRef = useRef(new Map<string, HTMLDivElement>())
  const prevStackRef = useRef<ChatInstanceDesc[]>(stack)
  const pendingRef = useRef<{ fromKey: string; toKey: string; toRight: boolean } | null>(null)
  const [renderList, setRenderList] = useState<ChatInstanceDesc[]>(stack)

  const activeKey = stack.length ? stack[stack.length - 1].key : null

  // 1) реакция на смену стека: решаем, что рендерить и какой переход играть
  useLayoutEffect(() => {
    const prev = prevStackRef.current
    prevStackRef.current = stack
    if (prev === stack) return

    const top = stack[stack.length - 1]
    const prevTop = prev[prev.length - 1]

    if (!top || !prevTop || top.key === prevTop.key) {
      setRenderList(stack)
      return
    }

    pendingRef.current = { fromKey: prevTop.key, toKey: top.key, toRight: stack.length > prev.length }
    // push: узел нового инстанса нужен в DOM — коммитим список сразу;
    // pop: уходящий верхний доживает до конца перехода, а промежуточные узлы
    // убираем сразу (tweb spliceChats:2705 — «fix middle chat z-index on animation»).
    setRenderList(stack.length > prev.length ? stack : [...stack, prevTop])
  }, [stack])

  // 2) исполнение отложенного перехода — когда оба узла уже в DOM
  useLayoutEffect(() => {
    const pending = pendingRef.current
    const container = containerRef.current
    if (!pending || !container) return

    const to = nodesRef.current.get(pending.toKey) ?? null
    const from = nodesRef.current.get(pending.fromKey) ?? null
    if (!to) return // узел ещё не смонтирован — доиграем на следующем коммите

    pendingRef.current = null
    runNavigationTransition({ container, to, from, toRight: pending.toRight })

    if (pending.toRight) return
    const timer = setTimeout(() => setRenderList(useChatStackStore.getState().stack), NAVIGATION_TRANSITION_TIME + 100)
    return () => clearTimeout(timer)
  })

  // первый показ и смены без анимации: активность ставим сразу
  // (tweb chatsSelectTab с animate === false)
  useLayoutEffect(() => {
    if (!activeKey || pendingRef.current) return
    const node = nodesRef.current.get(activeKey)
    if (node && !node.classList.contains('active')) node.classList.add('active')
  }, [activeKey, renderList])

  return (
    <div ref={containerRef} className="chats-container tabs-container" data-animation="navigation">
      {renderList.map((desc) => (
        <div
          key={desc.key}
          ref={(el) => {
            if (el) nodesRef.current.set(desc.key, el)
            else nodesRef.current.delete(desc.key)
          }}
          className="chat tabs-tab"
          data-type={desc.type}
        >
          <ChatInstanceProvider value={{ desc, isActive: desc.key === activeKey }}>
            {renderInstance(desc)}
          </ChatInstanceProvider>
        </div>
      ))}
    </div>
  )
}
```

- [ ] **Step 4: Прогнать тесты**

Run: `cd web-client && npx vitest run src/components/chat/ChatsContainer.test.tsx`
Expected: PASS (5 тестов).

- [ ] **Step 5: Проверить, что тест ловит порчу проводки**

Временно замени в `ChatsContainer.tsx` вызов на `void runNavigationTransition` и прогони тест — «push играет переход вперёд, pop — назад» обязан покраснеть. Верни код обратно.

Run: `cd web-client && npx vitest run src/components/chat/ChatsContainer.test.tsx`
Expected: FAIL при порче, PASS после возврата.

- [ ] **Step 6: Коммит**

```bash
git add web-client/src/components/chat/ChatsContainer.tsx web-client/src/components/chat/ChatsContainer.test.tsx
git commit -m "feat(chat): ChatsContainer — узлы стека и навигационный переход"
```

---

### Task 5: интеграция — `App.tsx` и потребители `openThread`

**Files:**
- Modify: `web-client/src/App.tsx:141-176` (развилка тред/чат → `ChatsContainer`), `:64`
- Modify: `web-client/src/stores/navigationStore.ts` (убрать `openThread`, `openTopicThread`, `openCommentsThread`, `closeThread`)
- Modify: `web-client/src/core/hooks/useNavigationActions.ts:14-21,57`, `useChatNavigation.ts:11,15-16,34-35`, `useAppHotkeys.ts:16`, `useUrlSync.ts:24,84,110`, `useShellTheme.ts:27,32-33`
- Modify: `web-client/src/components/Sidebar.tsx:106`, `web-client/src/components/Chat.tsx:156-157`
- Test: `web-client/src/stores/chatStackStore.integration.test.tsx` (создать)

**Interfaces:**
- Consumes: всё из Task 1/3/4.
- Produces: единая точка навигации внутри колонки — `useChatStackStore`; `selectOpenThread` для потребителей, которым нужен «открыт ли тред».

Правило замен (механическое, по одному файлу за шаг):

| было | стало |
|---|---|
| `useNavigationStore((s) => s.openThread)` | `useChatStackStore(selectOpenThread)` |
| `nav.closeThread()` | `useChatStackStore.getState().closeTop()` |
| `openCommentsThread({chatId, rootMsgId, title, subtitle})` | `setInnerPeer({peerId: chatId, threadId: rootMsgId, type: 'discussion', thread: {rootMsgId, title, subtitle, kind: 'comments'}})` |
| `openTopicThread(chatId, topic, subtitle)` | `setInnerPeer({peerId: chatId, threadId: topic.rootMsgId, type: 'chat', thread: {...}})` |
| `selectChat(id)` | остаётся в `navigationStore`, дополнительно зовёт `chatStack.setPeer({peerId, type: 'chat'})` для реального чата и `clear()` для `null` |

- [ ] **Step 1: Написать падающий интеграционный тест**

```tsx
// web-client/src/stores/chatStackStore.integration.test.tsx
import { beforeEach, describe, expect, it } from 'vitest'
import { useChatStackStore, selectOpenThread } from './chatStackStore'
import { useNavigationStore } from './navigationStore'

const thread = { rootMsgId: 7, title: 'Comments', kind: 'comments' as const }

beforeEach(() => {
  useChatStackStore.setState({ stack: [] }, false)
  useNavigationStore.setState({ selectedId: null, draftPeer: null }, false)
})

describe('навигация колонки чата идёт через стек', () => {
  it('выбор чата из списка кладёт корневой инстанс', () => {
    useNavigationStore.getState().selectChat('42')

    expect(useChatStackStore.getState().stack).toEqual([
      { key: '42_0_chat', peerId: 42, threadId: undefined, type: 'chat', query: undefined, thread: undefined },
    ])
  })

  it('выбор другого чата схлопывает открытый тред', () => {
    useNavigationStore.getState().selectChat('42')
    useChatStackStore.getState().setInnerPeer({ peerId: 100, threadId: 7, type: 'discussion', thread })

    useNavigationStore.getState().selectChat('43')

    expect(useChatStackStore.getState().stack.map((d) => d.peerId)).toEqual([43])
    expect(selectOpenThread(useChatStackStore.getState())).toBeNull()
  })

  it('selectChat(null) очищает стек', () => {
    useNavigationStore.getState().selectChat('42')
    useNavigationStore.getState().selectChat(null)
    expect(useChatStackStore.getState().stack).toEqual([])
  })
})
```

- [ ] **Step 2: Прогнать тест, убедиться что падает**

Run: `cd web-client && npx vitest run src/stores/chatStackStore.integration.test.tsx`
Expected: FAIL — `selectChat` стек не трогает.

- [ ] **Step 3: Перевести `navigationStore` на стек**

В `selectChat` после существующего `set({...})` добавить синхронизацию стека
(черновик `draft:<peerId>` — тоже инстанс, peerId берётся из суффикса):

```ts
selectChat: (id) => {
  set({ selectedId: id, draftPeer: null })
  const stack = useChatStackStore.getState()
  if (id === null) { stack.clear(); return }
  const peerId = Number(id.startsWith('draft:') ? id.slice('draft:'.length) : id)
  if (Number.isNaN(peerId)) { stack.clear(); return }
  stack.setPeer({ peerId, type: 'chat' })
},
```

Удалить из стора `openThread`, `openTopicThread`, `openCommentsThread`, `closeThread`
и тип `OpenThread`; импорт `ThreadInfo` уезжает в `chatStackStore`.

- [ ] **Step 4: Прогнать интеграционный тест**

Run: `cd web-client && npx vitest run src/stores/chatStackStore.integration.test.tsx`
Expected: PASS (3 теста).

- [ ] **Step 5: Перевести потребителей**

По таблице замен выше — файлы `useNavigationActions.ts`, `useChatNavigation.ts`,
`useAppHotkeys.ts`, `useUrlSync.ts`, `useShellTheme.ts`, `Sidebar.tsx`, `Chat.tsx`.
В `Chat.tsx` заменить только два обращения к стору (`:156-157`), проп `thread`
пока НЕ трогать — он приезжает из дескриптора в Task 5 Step 6.

- [ ] **Step 6: Переключить `App.tsx` на `ChatsContainer`**

Резолв дескриптора в сущность чата остаётся в `App.tsx` (та же логика, что была
для `threadChat`/`selected`, только по `desc`):

```tsx
const resolveChat = (desc: ChatInstanceDesc): ChatEntity =>
  chatList.find((c) => c.id === String(desc.peerId)) ??
  (draftChat && draftChat.peerId === desc.peerId ? draftChat : null) ?? {
    id: String(desc.peerId),
    name: desc.thread?.title ?? '',
    avatar: gradientFor(desc.peerId),
    avatarText: '#',
    date: '',
    preview: '',
    type: 'group',
  }

const chatArea = (
  <div id="column-center" className={classNames('tabs-tab', 'main-column')}>
    <ChatsContainer
      renderInstance={(desc) => (
        <Chat chat={resolveChat(desc)} thread={desc.thread} onBack={backToList} />
      )}
    />
  </div>
)
```

Внешний `.chat.tabs-tab` теперь рисует контейнер, поэтому в `Chat.tsx` корневой
элемент колонки не должен дублировать эти классы — проверить и убрать дубль,
если он есть.

- [ ] **Step 7: Прогнать весь набор**

Run: `cd web-client && npm test && npm run typecheck && npm run lint`
Expected: всё зелёное. Падения в тестах, завязанных на `navigationStore.openThread`, чинить переводом их на стек.

- [ ] **Step 8: Коммит**

```bash
git add -A web-client/src
git commit -m "refactor(chat): навигация колонки чата через стек инстансов"
```

---

### Task 6: гейт глобальных эффектов в `Chat.tsx`

**Files:**
- Modify: `web-client/src/components/Chat.tsx:1106-1121` (window-хоткей Ctrl+PageUp/PageDown)
- Test: `web-client/src/components/Chat.hotkeys.instance.test.tsx` (создать)

**Interfaces:**
- Consumes: `useIsActiveChat` (Task 3).

- [ ] **Step 1: Найти все глобальные эффекты инстанса**

Run: `cd web-client && grep -n "window.addEventListener\|document.addEventListener\|document.body.classList" src/components/Chat.tsx`
Ожидание: как минимум `:1118`. Каждый найденный — кандидат на гейт.

- [ ] **Step 2: Написать падающий тест**

Тест рендерит две копии узкого хука-обёртки поверх настоящего эффекта — если
эффект не гейтирован, обработчик сработает дважды.

```tsx
// web-client/src/components/Chat.hotkeys.instance.test.tsx
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useEffect } from 'react'
import { cleanup, render } from '@testing-library/react'
import { ChatInstanceProvider } from '../core/chat/chatInstanceContext'
import { useIsActiveChat } from '../core/chat/chatInstanceContext'
import type { ChatInstanceDesc } from '../stores/chatStackStore'

afterEach(cleanup)

const desc = (key: string): ChatInstanceDesc => ({ key, peerId: 1, type: 'chat' })

// Тот же контракт, что у хоткея ленты в Chat.tsx: слушатель на window,
// повешенный из инстанса, обязан быть за гейтом активности.
function PageKeys({ onDown }: { onDown: () => void }) {
  const isActive = useIsActiveChat()
  useEffect(() => {
    if (!isActive) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'PageDown') onDown() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isActive, onDown])
  return null
}

describe('глобальные эффекты инстанса', () => {
  it('window-хоткей срабатывает только у активного инстанса', () => {
    const onDown = vi.fn()
    render(
      <>
        <ChatInstanceProvider value={{ desc: desc('a'), isActive: false }}>
          <PageKeys onDown={onDown} />
        </ChatInstanceProvider>
        <ChatInstanceProvider value={{ desc: desc('b'), isActive: true }}>
          <PageKeys onDown={onDown} />
        </ChatInstanceProvider>
      </>,
    )

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'PageDown' }))

    expect(onDown).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 3: Прогнать тест**

Run: `cd web-client && npx vitest run src/components/Chat.hotkeys.instance.test.tsx`
Expected: PASS (тест закрепляет контракт; красным он станет, если гейт уберут из хука-образца).

- [ ] **Step 4: Поставить гейт в `Chat.tsx`**

В эффекте `:1106-1121` заменить условие входа:

```ts
const isActiveInstance = useIsActiveChat()
useEffect(() => {
  if (!isRealChat || !isActiveInstance) return
  // …существующий код без изменений…
}, [isRealChat, isActiveInstance, scrollRef, onScrollDownClick])
```

Каждому оставшемуся без гейта глобальному эффекту (если такие нашлись в Step 1)
поставить гейт либо комментарий у строки с причиной, почему он безопасен в
нескольких копиях.

- [ ] **Step 5: Прогнать весь набор**

Run: `cd web-client && npm test && npm run typecheck && npm run lint`
Expected: зелёное.

- [ ] **Step 6: Коммит**

```bash
git add web-client/src/components/Chat.tsx web-client/src/components/Chat.hotkeys.instance.test.tsx
git commit -m "fix(chat): глобальные эффекты инстанса только у активного"
```

---

### Task 7: восстановление позиции ленты при возврате

**Files:**
- Modify: `web-client/src/core/hooks/useChatScroll.ts` (сохранение при размонтировании/деактивации, восстановление при монтировании)
- Test: `web-client/src/core/hooks/useChatScroll.positions.test.tsx` (создать)

**Interfaces:**
- Consumes: `saveChatPosition`/`getChatPosition` (Task 2), `useIsActiveChat` (Task 3).

- [ ] **Step 1: Прочитать текущий хук и его тест**

Run: `cd web-client && grep -n "new Scrollable\|setScrollPositionSilently\|scrollableRef" src/core/hooks/useChatScroll.ts | head -20`
Ориентиры: `Scrollable` создаётся в эффекте, корректирующая запись идёт только
через `setScrollPositionSilently`. **Прямых записей `scrollTop` не добавлять** —
`src/core/scrollWriters.test.ts` считает писателей и покраснеет на новом.
Существующий тест-образец с харнессом: `src/core/hooks/useChatScroll.test.tsx`
(там же приём со стабами геометрии на `HTMLElement.prototype`, happy-dom layout не считает).

- [ ] **Step 2: Написать падающий тест**

```tsx
// web-client/src/core/hooks/useChatScroll.positions.test.tsx
// Проводка useChatScroll → chatPositions: сам модуль позиций покрыт своим
// тестом, но он физически не заметит, если хук перестанет звать save/get.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const saveChatPosition = vi.fn()
const getChatPosition = vi.fn(() => undefined as { top: number } | undefined)
vi.mock('../chat/chatPositions', () => ({
  saveChatPosition: (...a: unknown[]) => saveChatPosition(...a),
  getChatPosition: (...a: unknown[]) => getChatPosition(...a),
  clearChatPositions: () => {},
}))

import { createElement } from 'react'
import { render, act } from '@testing-library/react'
import { useChatScroll } from './useChatScroll'
import { ManagersProvider } from './useManagers'
import type { MessageWindow } from './useMessageWindow'

const win: MessageWindow = {
  msgs: [], reachedTop: false, reachedBottom: true, loadingOlder: false, loadingNewer: false,
  loading: false, loadedFromCache: false,
  loadOlder: async () => {}, loadNewer: async () => {},
  appendLocal: () => {}, applyIncoming: () => {}, applyEdit: () => {},
  jumpTo: async () => {}, reloadNewest: async () => {}, applyDelete: () => {},
}

const managers = {} as never

function Harness({ chatId, threadId }: { chatId: number; threadId?: number }) {
  const { scrollRef } = useChatScroll({
    numericChatId: chatId, threadId, isRealChat: true, win,
    paddingTop: 0, unreadDividerSeq: null, unreadStickyTop: 0,
  })
  return createElement('div', { ref: scrollRef, 'data-scroll-container': '1' })
}

beforeEach(() => {
  saveChatPosition.mockClear()
  getChatPosition.mockClear()
})

describe('useChatScroll ↔ chatPositions', () => {
  it('при монтировании спрашивает сохранённую позицию по паре peer+thread', () => {
    render(
      <ManagersProvider managers={managers}>
        <Harness chatId={5} threadId={7} />
      </ManagersProvider>,
    )

    expect(getChatPosition).toHaveBeenCalledWith(5, 7)
  })

  it('при размонтировании сохраняет текущую позицию', () => {
    const { unmount } = render(
      <ManagersProvider managers={managers}>
        <Harness chatId={5} />
      </ManagersProvider>,
    )

    act(() => { unmount() })

    expect(saveChatPosition).toHaveBeenCalledWith(5, undefined, { top: expect.any(Number) })
  })
})
```

- [ ] **Step 3: Прогнать тест**

Run: `cd web-client && npx vitest run src/core/hooks/useChatScroll.positions.test.tsx`
Expected: FAIL — хук не принимает `threadId` и позиции не трогает.

- [ ] **Step 4: Реализовать проводку**

1. Добавить в `UseChatScrollArgs` поле `threadId?: number` и прокинуть его из
   `Chat.tsx:454` (`threadId: thread?.rootMsgId`).
2. В эффекте, создающем `Scrollable`, при старте прочитать
   `getChatPosition(numericChatId, threadId)`; если позиция есть — вместо пина к
   низу отдать её `scrollable.setScrollPositionSilently(pos.top)`.
3. В cleanup того же эффекта — `saveChatPosition(numericChatId, threadId, { top: scrollable.scrollTop })`.

Комментарием у строк указать, что это порт `getChatSavedPosition`
(tweb `appImManager.ts:2151`) и почему запись идёт через `setScrollPositionSilently`.

- [ ] **Step 5: Прогнать весь набор**

Run: `cd web-client && npm test && npm run typecheck && npm run lint`
Expected: зелёное, включая `src/core/scrollWriters.test.ts`.

- [ ] **Step 6: Коммит**

```bash
git add web-client/src/core/hooks/useChatScroll.ts web-client/src/core/hooks/useChatScroll.positions.test.tsx
git commit -m "feat(chat): возврат из треда сохраняет позицию ленты"
```

---

### Task 8: проверка на стенде

**Files:** нет (проверка).

- [ ] **Step 1: Собрать клиент**

Run: `cd web-client && npx vite build --outDir ../client-build`
Expected: сборка без ошибок.

- [ ] **Step 2: Поднять/обновить стенд**

Стенд живёт на `:38080`, проект `msgrverify` (`docker-compose.verify.yml`).

Run: `docker compose -p msgrverify -f docker-compose.verify.yml up -d`
Expected: контейнеры `Up`; `curl -sI http://localhost:38080 | head -1` → `HTTP/1.1 200`.

- [ ] **Step 3: Прогнать сценарий вручную**

Открыть `http://localhost:38080`, войти (dev OTP `12345`), открыть канал с
включёнными обсуждениями и проверить:

1. клик по футеру «N комментариев» открывает тред с навигационной анимацией
   (входящий едет справа, уходящий притормаживает и притемняется);
2. `back`/Esc возвращает в канал обратной анимацией;
3. после возврата лента канала на прежней позиции, окно не перезагружается;
4. в DOM: `.chats-container.tabs-container[data-animation="navigation"]`, внутри
   на время перехода два `.chat.tabs-tab`, `.active` — у верхнего,
   `data-type="chat"` и `data-type="discussion"`;
5. хоткей Ctrl+PageDown не срабатывает дважды.

- [ ] **Step 4: Зафиксировать результат**

Приложить в отчёте, что из пунктов 1–5 сошлось. Расхождения — в задачи следующего
этапа, не «починить по-быстрому» в этой ветке.
