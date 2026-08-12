// src/stores/chatsStore.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { useChatsStore, loadChats } from './chatsStore'

function fakeManagers(over: Partial<{ me: unknown }> = {}) {
  return {
    auth: { me: async () => over.me ?? { id: 7, phone: '+1', display_name: 'Me' } },
  }
}

// Task 3 (перенос владения диалогами): applyNewMessage/applyRead/bumpUnreadReactions
// отсюда убраны — их тела переехали в core/managers/dialogsManager.ts, тесты на них —
// в dialogsManager.test.ts (describe «realtime-кадры применяет владелец»).
// Task 4 (действия без оптимистики): setDialogMuted (и setDialogPinned/
// setDialogTheme/setDialogArchived) отсюда тоже убраны — тела переехали во
// владельца (dialogsManager.applyMute/applyPinned/applyTheme/applyArchived),
// тесты на них — dialogsManager.test.ts (describe «действия без оптимистики»).
// Task 6: диалоговая половина `loadChats` тоже ушла владельцу — здесь остаётся
// только `me`, тесты на диалоги — dialogsManager.test.ts.
describe('chatsStore', () => {
  beforeEach(() => useChatsStore.setState({ me: null, meId: null }))

  it('loadChats populates me/meId', async () => {
    await loadChats(fakeManagers() as never)
    const s = useChatsStore.getState()
    expect(s.meId).toBe(7)
    expect(s.me).toEqual({ id: 7, phone: '+1', display_name: 'Me' })
  })
})
