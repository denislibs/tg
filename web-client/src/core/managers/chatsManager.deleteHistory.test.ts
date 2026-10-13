// `chats.clearHistory` / `chats.deleteHistory` — порт tweb `flushHistory` →
// `doFlushHistory` (`appMessagesManager.ts:6441-6595`, `:6640-6700`):
// `DELETE /chats/{peer}/history` отвечает `messages.affectedHistory`; ответ
// становится местным `updatePts` воронки (`:6453`), затем окна чата сбрасываются
// (`flushStoragesByPeerId`), и очистка объявляет `dialog_flush`, а удаление
// снимает диалог (`dropDialogOnDeletion`).
import 'fake-indexeddb/auto'
import { describe, expect, it, vi } from 'vitest'
import type { MessagesAffectedHistory } from '@layer'
import type { RestClient } from '../net/restClient'
import { makeDialog } from '../dialogs/testDialog'
import { newChatsManager } from './chatsManager'

const affected = (pts: number, pts_count: number, offset = 0): MessagesAffectedHistory =>
  ({ _: 'messages.affectedHistory', pts, pts_count, offset })

describe('chatsManager — очистка и удаление истории', () => {
  const setup = (answers: MessagesAffectedHistory[] = [affected(13, 3)]) => {
    const calls: string[] = []
    const queue = [...answers]
    const del = vi.fn(async (path: string) => { calls.push(`del ${path}`); return queue.shift() ?? answers[answers.length - 1] })
    const applyLocalPts = vi.fn((pts: number, count: number) => { calls.push(`pts ${pts}/${count}`) })
    const flushHistoryWindows = vi.fn((peerId: number) => { calls.push(`flush ${peerId}`) })
    const dialog = makeDialog({ peerId: 42 })
    const reloadConversation = vi.fn((peerId: number) => { calls.push(`reload ${peerId}`) })
    const applyRemoved = vi.fn((peerId: number) => { calls.push(`removed ${peerId}`) })
    const getDialogOnly = vi.fn(() => dialog)
    const broadcast = vi.fn((event: string, payload: unknown) => { calls.push(`broadcast ${event}`); void payload })
    const mgr = newChatsManager({
      rest: { del } as unknown as RestClient,
      getFunnel: () => ({ applyLocalPts }),
      messages: { flushHistoryWindows } as never,
      dialogs: { reloadConversation, applyRemoved, getDialogOnly },
      broadcast,
    })
    return { mgr, calls, del, applyLocalPts, broadcast, dialog }
  }

  it('очистка: just_clear=1, местный updatePts, сброс окон, перечитывание строки и dialog_flush', async () => {
    const { mgr, calls, broadcast, dialog } = setup()
    await mgr.clearHistory(42)
    expect(calls).toEqual([
      'del /chats/42/history?just_clear=1',
      'pts 13/3',
      'flush 42',
      'reload 42',
      'broadcast dialog_flush',
    ])
    expect(broadcast).toHaveBeenCalledWith('dialog_flush', { peerId: 42, dialog })
  })

  it('удаление у себя: без параметров, затем снятие диалога (dropDialogOnDeletion)', async () => {
    const { mgr, calls, broadcast } = setup()
    await mgr.deleteHistory(42, false)
    expect(calls).toEqual(['del /chats/42/history', 'pts 13/3', 'flush 42', 'removed 42'])
    expect(broadcast).not.toHaveBeenCalled()
  })

  it('удаление и у собеседника: revoke=1', async () => {
    const { mgr, calls } = setup()
    await mgr.deleteHistory(42, true)
    expect(calls[0]).toBe('del /chats/42/history?revoke=1')
    expect(calls).toContain('removed 42')
  })

  it('offset > 0 — запрос повторяется (tweb :6533), каждый ответ идёт в воронку', async () => {
    const { mgr, del, applyLocalPts } = setup([affected(11, 1, 5), affected(14, 3)])
    await mgr.deleteHistory(42, false)
    expect(del).toHaveBeenCalledTimes(2)
    expect(applyLocalPts.mock.calls).toEqual([[11, 1], [14, 3]])
  })

  it('отказ сервера: воронка, окна и диалог не тронуты', async () => {
    const { mgr, applyLocalPts, broadcast } = setup()
    const failing = newChatsManager({
      rest: { del: vi.fn(async () => { throw new Error('403') }) } as unknown as RestClient,
      getFunnel: () => ({ applyLocalPts }),
      broadcast,
    })
    await expect(failing.clearHistory(42)).rejects.toThrow('403')
    await expect(failing.deleteHistory(42, true)).rejects.toThrow('403')
    expect(applyLocalPts).not.toHaveBeenCalled()
    expect(broadcast).not.toHaveBeenCalled()
    void mgr
  })
})
