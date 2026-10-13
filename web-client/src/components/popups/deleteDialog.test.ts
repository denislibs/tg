// «Удалить» у «Избранного» — tweb `popups/deleteDialog.ts:163-172` (ветка `saved`):
// заголовок `DeleteChatUser`, текст `AreYouSureDeleteThisChatSavedMessages`, опасная
// кнопка, без чекбоксов; действие — `flushHistory({peerId, justClear: false})`.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CLICK_EVENT_NAME } from '@helpers/dom/clickEvent'
import rootScope from '@lib/rootScope'
import { resetPeerMirror } from '@core/peerCache'
import showDeleteDialogPopup, { type DeleteDialogManagers } from './deleteDialog'

const ME = 1

afterEach(() => {
  document.body.replaceChildren()
  resetPeerMirror()
  vi.restoreAllMocks()
})

function mkManagers() {
  const deleteHistory = vi.fn(async (_peerId: number, _revoke: boolean) => {})
  const applyRemoved = vi.fn()
  const managers = {
    peers: { fillMirror: vi.fn(async () => {}) },
    chats: { deleteHistory },
    groups: { deleteGroup: vi.fn(), removeMember: vi.fn() },
    dialogs: { applyRemoved },
  } as unknown as DeleteDialogManagers
  return { managers, deleteHistory, applyRemoved }
}

describe('showDeleteDialogPopup — «Избранное» (saved)', () => {
  it('заголовок, текст про Saved Messages, опасная кнопка, чекбоксов нет', () => {
    rootScope.myId = ME
    showDeleteDialogPopup(ME, mkManagers().managers, 'saved')

    const root = document.querySelector('.popup-delete-chat') as HTMLElement
    expect(root).not.toBeNull()
    expect(root.querySelector('.popup-title')?.textContent).toBe('Delete chat')
    expect(root.querySelector('.popup-description')?.textContent).toBe('Are you sure you want to delete Saved Messages?')
    expect(root.querySelector('.popup-button.danger')?.textContent).toBe('Delete chat')
    expect(root.querySelector('.checkbox-field, [role="checkbox"]')).toBeNull()
  })

  it('кнопка зовёт chats.deleteHistory(myId, false); снятие строки — дело воркера, не попапа', async () => {
    rootScope.myId = ME
    const { managers, deleteHistory, applyRemoved } = mkManagers()
    showDeleteDialogPopup(ME, managers, 'saved')

    const root = document.querySelector('.popup-delete-chat') as HTMLElement
    root.querySelector<HTMLButtonElement>('.popup-button.danger')!.dispatchEvent(new MouseEvent(CLICK_EVENT_NAME, { bubbles: true }))
    await Promise.resolve()
    await Promise.resolve()

    expect(deleteHistory).toHaveBeenCalledWith(ME, false)
    expect(applyRemoved).not.toHaveBeenCalled()
  })
})
