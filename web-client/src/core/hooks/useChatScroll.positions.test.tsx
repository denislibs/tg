// src/core/hooks/useChatScroll.positions.test.tsx
//
// Проводка useChatScroll → chatPositions (Task 7): возврат из треда должен
// отдать нижнему инстансу ровно ту позицию ленты, что была до ухода (порт
// tweb `appImManager.getChatSavedPosition`, appImManager.ts:2151). Сам модуль
// позиций (`core/chat/chatPositions.ts`) покрыт своим тестом, но он физически
// не заметит, если хук перестанет звать save/get — эти два теста бьют именно
// по подключению: мокаем модуль и проверяем, что хук реально вызывает его
// функции в нужных точках жизненного цикла (монтирование / размонтирование).
import { beforeEach, describe, expect, it, vi } from 'vitest'

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
