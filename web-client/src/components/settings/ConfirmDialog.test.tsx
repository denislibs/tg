// ConfirmDialog — мост к портированному `confirmationPopup` (задача 3 плана
// solid-wave-1, см. докблок ConfirmDialog.tsx). Проверяем ИМЕННО мост:
// монтирование открывает vanilla-попап с переданными title/text/action/zIndex,
// а исход промиса транслируется в пропы onConfirm/onClose — контракт, на
// который завязаны 9 непортированных вызывающих (SearchView,
// DataStorageSettings, PrivacySecuritySettings, InviteLinkScreens,
// DiscussionScreen, PinnedMessagesScreen, useChatPopups, MediaEditor).
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, waitFor } from '@testing-library/react'
import { CLICK_EVENT_NAME } from '@helpers/dom/clickEvent'
import ConfirmDialog from './ConfirmDialog'

afterEach(() => {
  cleanup()
  // confirmationPopup вешает узел прямо на document.body (popupElement.ts
  // show()), а не в дерево React — cleanup() его не снимает.
  document.body.replaceChildren()
})

describe('ConfirmDialog — мост к confirmationPopup', () => {
  it('монтирование открывает vanilla-попап с title/text/zIndex', () => {
    render(
      <ConfirmDialog title="ChatList.Context.DeleteChat" text="Chat.Delete.Private.Text" action="Delete" zIndex={4300} onConfirm={() => {}} onClose={() => {}} />,
    )
    const root = document.querySelector('.popup-confirmation') as HTMLElement
    expect(root).not.toBeNull()
    expect(root.querySelector('.popup-title')?.textContent).toBe('Delete Chat')
    expect(root.querySelector('.popup-description')?.textContent).toBe('This chat will be deleted from your chat list.')
    expect(root.style.zIndex).toBe('4300') // popupElement.ts PopupOptions.zIndex (наше расширение)
  })

  // Кнопка подтверждения печатается ГОТОВОЙ строкой (`popupElement.ts:253`), поэтому
  // `action` обязан переводиться в самом `ConfirmDialog`. Ключ взят такой, чей текст с
  // именем НЕ совпадает: на `action="Delete"` ошибка неотличима от правды.
  it('кнопка действия переведена, а не показывает имя ключа', () => {
    render(<ConfirmDialog title="ChatList.Context.DeleteChat" text="Chat.Delete.Private.Text" action="UnpinMessage" onConfirm={() => {}} onClose={() => {}} />)
    const button = document.querySelector('.popup-confirmation .popup-button') as HTMLElement
    expect(button?.textContent).toBe('Unpin')
  })

  it('клик по кнопке действия резолвит confirmationPopup — onConfirm, потом onClose', async() => {
    const onConfirm = vi.fn()
    const onClose = vi.fn()
    render(<ConfirmDialog title="ChatList.Context.DeleteChat" text="Chat.Delete.Private.Text" action="Delete" danger onConfirm={onConfirm} onClose={onClose} />)

    const button = document.querySelector<HTMLButtonElement>('.popup-confirmation .popup-button.danger')!
    button.dispatchEvent(new MouseEvent(CLICK_EVENT_NAME, { bubbles: true }))

    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
  })

  it('Cancel реджектит confirmationPopup — onConfirm НЕ звучит, но onClose звучит', async() => {
    const onConfirm = vi.fn()
    const onClose = vi.fn()
    render(<ConfirmDialog title="ChatList.Context.DeleteChat" text="Chat.Delete.Private.Text" action="Delete" onConfirm={onConfirm} onClose={onClose} />)

    // без danger обе кнопки несут класс primary (setButtons, popupElement.ts) —
    // Cancel всегда ПОСЛЕДНИЙ в DOM (addCancelButton дописывает его последним).
    const buttons = document.querySelectorAll<HTMLButtonElement>('.popup-confirmation .popup-button')
    buttons[buttons.length - 1].dispatchEvent(new MouseEvent(CLICK_EVENT_NAME, { bubbles: true }))

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('размонтирование ДО исхода снимает СВОЙ vanilla-попап (правило шва) и не зовёт onConfirm/onClose повторно', () => {
    vi.useFakeTimers()
    const onConfirm = vi.fn()
    const onClose = vi.fn()
    const { unmount } = render(
      <ConfirmDialog title="ChatList.Context.DeleteChat" text="Chat.Delete.Private.Text" action="Delete" onConfirm={onConfirm} onClose={onClose} />,
    )
    const root = document.querySelector('.popup-confirmation') as HTMLElement
    expect(root).not.toBeNull()

    unmount()
    // Владелец САМ снял компонент (например, экран закрылся раньше исхода) —
    // повторный вызов onClose из уже неактуального промиса был бы двойным
    // закрытием чужого состояния (правило шва, web-client/CLAUDE.md).
    // `forceHide()` уже запустил destroy() синхронно (класс hiding вместо
    // active), узел снимается таймером базы (popupElement.ts, 250мс) — тот
    // же контракт, что и у остальных путей закрытия.
    expect(root.classList.contains('active')).toBe(false)
    expect(root.classList.contains('hiding')).toBe(true)
    vi.advanceTimersByTime(300)
    expect(document.body.contains(root)).toBe(false) // осиротевшего узла на document.body не осталось
    expect(onConfirm).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
    vi.useRealTimers()
  })
})
