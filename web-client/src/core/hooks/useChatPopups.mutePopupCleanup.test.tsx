// Регрессия (финальное ревью solid-wave-1, IMPORTANT-2): мьют-попап
// (`PopupMute`, задача 3 плана solid-wave-1) — vanilla-попап ВНЕ popupStore,
// открывается из `openMute` императивно (клик по пункту меню), а не из
// эффекта, привязанного к жизни `Chat`. Раньше `Chat.tsx` снимал ЛЮБОЙ
// попап колонки на своё размонтирование через
// `useEffect(() => () => clearPopups(), [])` — но `clearPopups()` знает
// только про React-реестр `popupStore`, а `PopupMute` в нём больше не
// участвует (см. докблок `useChatPopups.tsx::openMute`). Без своего cleanup
// мьют-попап пережил бы размонтирование `Chat` (колонка ремаунтится по
// `key` при смене чата) — тот же класс дефекта, что нашёлся у delete-
// конфирма (`ChatMsgActionPopups.test.tsx`).
//
// Правило шва (web-client/CLAUDE.md): владелец сам снимает то, что создал —
// образец `ConfirmDialog.tsx`.
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useChatPopups, type ChatPopupDeps } from './useChatPopups'
import { ManagersProvider } from './useManagers'
import type { Chat } from '../../data'

function wrapper(managers: unknown) {
  return ({ children }: { children: ReactNode }) => (
    <ManagersProvider managers={managers as never}>{children}</ManagersProvider>
  )
}

function mkManagers() {
  return { peers: { fillMirror: vi.fn(async() => {}) } }
}

const chat: Chat = { id: '1', name: 'Test', avatar: '', preview: '', type: 'private' }

function mkDeps(overrides: Partial<ChatPopupDeps> = {}): ChatPopupDeps {
  return {
    chat,
    numericChatId: 1,
    isRealChat: true,
    isChannel: false,
    muted: false,
    owned: false,
    canManageTopic: false,
    canAddMember: false,
    canCreateGiveaway: false,
    canUnpinAll: false,
    pins: [],
    deleteLabels: { title: '', text: '', action: '' },
    livestreamActive: false,
    setInfoOpen: vi.fn(),
    applyMute: vi.fn(),
    toggleMute: vi.fn(),
    startSelectMode: vi.fn(),
    doDeleteChat: vi.fn(),
    doClearHistory: vi.fn(),
    openPicker: vi.fn(),
    sendGeo: vi.fn(),
    sendContact: vi.fn(),
    getMessageSendingParams: vi.fn(),
    onMessageSent: vi.fn(),
    setPendingMedia: vi.fn(),
    slowmodeMarkSent: vi.fn(),
    jumpToSeq: vi.fn(),
    setScheduledCount: vi.fn(),
    ...overrides,
  } as ChatPopupDeps
}

afterEach(() => {
  document.body.replaceChildren()
  vi.useRealTimers()
})

describe('useChatPopups — мьют-попап снимается вслед за владельцем (IMPORTANT-2, финальное ревью solid-wave-1)', () => {
  it('попап открыт → хук (владелец, живёт ровно как Chat) размонтирован → попапа в DOM нет', () => {
    vi.useFakeTimers()
    const { result, unmount } = renderHook(() => useChatPopups(mkDeps()), { wrapper: wrapper(mkManagers()) })

    act(() => { result.current.openMute() })

    const root = document.querySelector('.popup-mute') as HTMLElement
    expect(root).not.toBeNull()
    expect(root.classList.contains('active')).toBe(true)

    unmount() // Chat размонтируется по key при смене чата — хук уходит вместе с ним

    expect(root.classList.contains('active')).toBe(false)
    expect(root.classList.contains('hiding')).toBe(true)
    vi.advanceTimersByTime(300) // таймер снятия узла из DOM (popupElement.ts)
    expect(document.body.contains(root)).toBe(false)
  })

  it('MUTE клик сам закрывает попап штатно — cleanup хука на уже уничтоженном попапе не падает (forceHide идемпотентен)', () => {
    vi.useFakeTimers()
    const onMute = vi.fn()
    const { result, unmount } = renderHook(
      () => useChatPopups(mkDeps({ applyMute: (next, seconds) => onMute(next, seconds) })),
      { wrapper: wrapper(mkManagers()) },
    )

    act(() => { result.current.openMute() })
    const button = document.querySelector<HTMLButtonElement>('.popup-mute .popup-button')!
    act(() => { button.click() })
    vi.advanceTimersByTime(300)

    expect(onMute).toHaveBeenCalledTimes(1)
    expect(() => unmount()).not.toThrow()
  })
})
