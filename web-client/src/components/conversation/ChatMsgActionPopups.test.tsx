// Регрессия (финальное ревью solid-wave-1, IMPORTANT-2): delete-конфирм
// (`openDeleteMessageDialog`, vanilla PopupPeer) открывается из эффекта этого
// компонента, но у эффекта не было cleanup. `Chat` размонтируется по `key`
// при смене чата (`components/Chat.tsx`), а сам попап живёт ВНЕ popupStore —
// `clearPopups()` (useEffect(() => () => clearPopups(), []) в Chat.tsx) его
// не видит. Итог: удалить → кликнуть другой диалог → старый попап (аватар и
// заголовок СТАРОГО чата) продолжает висеть поверх нового и всё ещё удаляет
// из НЕГО.
//
// Правило шва (web-client/CLAUDE.md): владелец сам снимает то, что создал —
// образец `ConfirmDialog.tsx` (`popup?.forceHide()` в cleanup эффекта).
import { afterEach, describe, expect, it, vi } from 'vitest'
import { render } from '@testing-library/react'
import { ManagersProvider } from '../../core/hooks/useManagers'
import ChatMsgActionPopups from './ChatMsgActionPopups'
import type { useMessageActions } from '../../core/hooks/useMessageActions'

type MsgActions = ReturnType<typeof useMessageActions>

function mkManagers() {
  return { peers: { fillMirror: vi.fn(async() => {}) } }
}

function mkMsgActions(overrides: Partial<MsgActions> = {}): MsgActions {
  return {
    delIds: null,
    doDelete: vi.fn(),
    closeDelete: vi.fn(),
    postStats: null,
    closePostStats: vi.fn(),
    factCheckEdit: null,
    closeFactCheckEditor: vi.fn(),
    submitFactCheck: vi.fn(),
    reacted: null,
    closeReacted: vi.fn(),
    forwardIds: null,
    doForward: vi.fn(),
    closeForward: vi.fn(),
    ...overrides,
  } as unknown as MsgActions
}

afterEach(() => {
  document.body.replaceChildren()
  vi.useRealTimers()
})

describe('ChatMsgActionPopups — delete-конфирм снимается вслед за владельцем (IMPORTANT-2, финальное ревью solid-wave-1)', () => {
  it('попап открыт → владелец (Chat, здесь — сам ChatMsgActionPopups) размонтирован → попапа в DOM нет', () => {
    vi.useFakeTimers()
    const msgActions = mkMsgActions({ delIds: { peerId: 1, ids: [5], canRevoke: true } })
    const { unmount } = render(
      <ManagersProvider managers={mkManagers() as never}>
        <ChatMsgActionPopups msgActions={msgActions} numericChatId={1} />
      </ManagersProvider>,
    )

    const root = document.querySelector('.popup-delete-chat') as HTMLElement
    expect(root).not.toBeNull()
    expect(root.classList.contains('active')).toBe(true)

    // Смена чата: колонка `Chat` ремаунтится по `key`, этот компонент уходит
    // вместе с ней — ровно тот путь, которым раньше правил
    // `useEffect(() => () => clearPopups(), [])` в Chat.tsx (мьют и delete-
    // конфирм шли через `openPopup`; теперь оба vanilla и вне реестра).
    unmount()

    expect(root.classList.contains('active')).toBe(false)
    expect(root.classList.contains('hiding')).toBe(true)
    vi.advanceTimersByTime(300) // таймер снятия узла из DOM (popupElement.ts)
    expect(document.body.contains(root)).toBe(false)
  })

  it('обычное закрытие (Cancel) само снимает попап — cleanup эффекта не мешает штатному пути и не зовёт onClose дважды', () => {
    vi.useFakeTimers()
    const onClose = vi.fn()
    const msgActions = mkMsgActions({ delIds: { peerId: 1, ids: [5], canRevoke: true }, closeDelete: onClose })
    const { rerender } = render(
      <ManagersProvider managers={mkManagers() as never}>
        <ChatMsgActionPopups msgActions={msgActions} numericChatId={1} />
      </ManagersProvider>,
    )

    const buttons = document.querySelectorAll<HTMLButtonElement>('.popup-buttons > button')
    buttons[buttons.length - 1].click() // Cancel — последняя кнопка (addCancelButton)
    vi.advanceTimersByTime(300)

    expect(onClose).toHaveBeenCalledTimes(1)

    // Родитель реагирует на onClose сбросом delIds (как реальный useMessageActions.closeDelete) —
    // эффект должен смолчать (forceHide на уже уничтоженном попапе — no-op).
    rerender(
      <ManagersProvider managers={mkManagers() as never}>
        <ChatMsgActionPopups msgActions={mkMsgActions({ delIds: null })} numericChatId={1} />
      </ManagersProvider>,
    )
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
