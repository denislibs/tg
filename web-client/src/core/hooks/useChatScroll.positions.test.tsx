// src/core/hooks/useChatScroll.positions.test.tsx
//
// Проводка useChatScroll → chatPositions (Task 7): возврат из треда должен
// отдать нижнему инстансу ровно ту позицию ленты, что была до ухода (порт
// tweb `appImManager.getChatSavedPosition`, appImManager.ts:2151). Сам модуль
// позиций (`core/chat/chatPositions.ts`) покрыт своим тестом, но он физически
// не заметит, если хук перестанет звать save/get — эти тесты бьют именно по
// подключению: мокаем модуль и проверяем, что хук реально вызывает его
// функции в нужных точках жизненного цикла.
//
// Ревью раунда 2 (Critical): сохранение ТОЛЬКО в cleanup писало `{top: 0}`
// поверх настоящей позиции — к моменту размонтирования узел стека обычно уже
// скрыт (`ChatsContainer` снимает класс `.active` таймером перехода РАНЬШЕ,
// чем таймер обрезки списка убирает узел из DOM), а у скрытого узла
// `clientHeight`/`scrollTop` читаются нулём (CSSOM View — «нет layout box»).
// Исправление: основной путь сохранения — переход `isActive` true→false
// (узел ещё виден в этот момент), cleanup — только страховка, гейтированная
// `clientHeight > 0`. Ниже эти два механизма покрыты раздельно, геометрией,
// управляемой тестом (happy-dom layout не считает — стаб на
// `HTMLElement.prototype`, по образцу `useChatScroll.test.tsx`).
import { beforeAll, afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const saveChatPosition = vi.fn()
const getChatPosition = vi.fn((..._a: unknown[]) => undefined as { top: number } | undefined)
vi.mock('../chat/chatPositions', () => ({
  saveChatPosition: (...a: unknown[]) => saveChatPosition(...a),
  getChatPosition: (...a: unknown[]) => getChatPosition(...a),
  clearChatPositions: () => {},
}))

import { createElement } from 'react'
import { render, act } from '@testing-library/react'
import { useChatScroll } from './useChatScroll'
import { ManagersProvider } from './useManagers'
import { ChatInstanceProvider } from '../chat/chatInstanceContext'
import type { ChatInstanceDesc } from '../../stores/chatStackStore'
import type { MessageWindow } from './useMessageWindow'

const win: MessageWindow = {
  msgs: [], reachedTop: false, reachedBottom: true, loadingOlder: false, loadingNewer: false,
  loading: false, loadedFromCache: false,
  loadOlder: async () => {}, loadNewer: async () => {},
  appendLocal: () => {}, applyIncoming: () => {}, applyEdit: () => {},
  jumpTo: async () => {}, reloadNewest: async () => {}, applyDelete: () => {},
}

const managers = {} as never
const fakeDesc: ChatInstanceDesc = { key: '5_0_chat', peerId: 5, type: 'chat' }

function Harness({ chatId, threadId }: { chatId: number; threadId?: number }) {
  const { scrollRef } = useChatScroll({
    numericChatId: chatId, threadId, isRealChat: true, win,
    paddingTop: 0, unreadDividerSeq: null, unreadStickyTop: 0,
  })
  return createElement('div', { ref: scrollRef, 'data-scroll-container': '1' })
}

// Геометрия контейнера, управляемая тестом. `clientHeight` — единственное
// поле, от которого зависит новый гейт «есть ли у узла layout box»
// (`scrollable.container.clientHeight`); 0 симулирует `display: none`
// (скрытый узел стека), положительное значение — видимый.
let containerClientHeight = 0
let restoreClientHeight: (() => void) | null = null

beforeAll(() => {
  const proto = HTMLElement.prototype as unknown as Record<string, unknown>
  const hadOwn = Object.prototype.hasOwnProperty.call(HTMLElement.prototype, 'clientHeight')
  const original = hadOwn ? Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientHeight') : undefined
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
    configurable: true,
    get(this: HTMLElement) { return this.dataset.scrollContainer != null ? containerClientHeight : 0 },
  })
  restoreClientHeight = () => {
    if (hadOwn && original) Object.defineProperty(HTMLElement.prototype, 'clientHeight', original)
    else delete proto.clientHeight
  }
})
afterAll(() => restoreClientHeight?.())

beforeEach(() => {
  saveChatPosition.mockClear()
  getChatPosition.mockClear()
  containerClientHeight = 500 // видимый по умолчанию — большинство тестов не про скрытость
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

  it('при размонтировании ВИДИМОГО узла (страховка без предшествующей деактивации) сохраняет текущую позицию', () => {
    const { unmount } = render(
      <ManagersProvider managers={managers}>
        <Harness chatId={5} />
      </ManagersProvider>,
    )

    act(() => { unmount() })

    expect(saveChatPosition).toHaveBeenCalledWith(5, undefined, { top: expect.any(Number) })
  })

  it('при размонтировании СКРЫТОГО узла (clientHeight===0) не пишет 0 поверх сохранённой позиции', () => {
    containerClientHeight = 0 // симулирует display:none — узел стека, уже уведённый с переднего плана
    const { unmount } = render(
      <ManagersProvider managers={managers}>
        <Harness chatId={5} />
      </ManagersProvider>,
    )

    act(() => { unmount() })

    // Без гейта это был бы вызов с {top: 0} — ровно баг из Critical-ревью.
    expect(saveChatPosition).not.toHaveBeenCalled()
  })

  it('переход isActive true→false сохраняет позицию, пока узел ЕЩЁ ВИДЕН (основной путь)', () => {
    const { rerender } = render(
      <ManagersProvider managers={managers}>
        <ChatInstanceProvider value={{ desc: fakeDesc, isActive: true }}>
          <Harness chatId={5} />
        </ChatInstanceProvider>
      </ManagersProvider>,
    )
    expect(saveChatPosition).not.toHaveBeenCalled() // пока активен — рано

    // Узел стека уходит с переднего плана (push сверху/переключение), но
    // класс .active (а с ним и геометрия) снимается лишь спустя ~350мс —
    // clientHeight здесь намеренно остаётся положительным (узел ещё виден).
    act(() => {
      rerender(
        <ManagersProvider managers={managers}>
          <ChatInstanceProvider value={{ desc: fakeDesc, isActive: false }}>
            <Harness chatId={5} />
          </ChatInstanceProvider>
        </ManagersProvider>,
      )
    })

    expect(saveChatPosition).toHaveBeenCalledWith(5, undefined, { top: expect.any(Number) })
  })

  it('после сохранения на деактивации последующее размонтирование СКРЫТОГО узла не перезаписывает позицию нулём', () => {
    const { rerender, unmount } = render(
      <ManagersProvider managers={managers}>
        <ChatInstanceProvider value={{ desc: fakeDesc, isActive: true }}>
          <Harness chatId={5} />
        </ChatInstanceProvider>
      </ManagersProvider>,
    )

    act(() => {
      rerender(
        <ManagersProvider managers={managers}>
          <ChatInstanceProvider value={{ desc: fakeDesc, isActive: false }}>
            <Harness chatId={5} />
          </ChatInstanceProvider>
        </ManagersProvider>,
      )
    })
    expect(saveChatPosition).toHaveBeenCalledTimes(1) // сохранено на деактивации, пока был виден

    // 350мс спустя класс .active снят реальным навигационным переходом —
    // узел скрыт; ТЕПЕРЬ он реально размонтируется (обрезка renderList).
    containerClientHeight = 0
    act(() => { unmount() })

    // Второго вызова быть не должно — иначе это и есть баг Critical-ревью
    // (перезапись настоящей позиции нулём при финальном размонтировании).
    expect(saveChatPosition).toHaveBeenCalledTimes(1)
  })
})
