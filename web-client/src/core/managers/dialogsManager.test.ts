// Task 1 (перенос владения списком диалогов в воркер): тест владельца порядка —
// dialogsManager считает индекс через ту же чистую dialogIndex(), что и прежний
// applyDialogs на главном потоке (см. core/dialogs/dialogIndex.ts), и отдаёт
// снимок отсортированным (свежие/закреплённые выше). Зеркало (chatsStore) пока
// НЕ переведено на эти операции (Task 2) — тест проверяет только владельца.
import { describe, expect, it, vi } from 'vitest'
import { newDialogsManager } from './dialogsManager'
import type { Dialog } from '../models'

const dialog = (chatId: number, at: string, pinned = false): Dialog => ({
  chatId, type: 'private', title: 't' + chatId, unread: 0, unreadMentions: 0, unreadReactions: 0,
  lastReadSeq: 0, peerReadSeq: 0, muted: false, pinned, archived: false,
  lastMessage: { seq: 1, text: 'x', senderId: 1, at },
} as Dialog)

const restStub = (chats: unknown[]) => ({ get: vi.fn(async () => ({ chats })) })

describe('dialogsManager: владелец порядка', () => {
  it('fillMirror отдаёт reset, отсортированный по индексу (свежие выше)', async () => {
    const ops: unknown[] = []
    const mgr = newDialogsManager({
      rest: restStub([]) as never,
      onDialogOps: (o) => ops.push(...o),
      loadCache: async () => [dialog(1, '2026-08-01T00:00:00Z'), dialog(2, '2026-08-02T00:00:00Z')],
      loadState: async () => ({ pinnedOrders: {}, drafts: [] }),
    })

    const op = await mgr.fillMirror()

    expect(op.op).toBe('reset')
    expect((op as { items: { dialog: Dialog }[] }).items.map((i) => i.dialog.chatId)).toEqual([2, 1])
    // Пробел зеркала объявлен → владелец обязан ответить и веером тоже.
    expect(ops).toHaveLength(1)
  })

  it('закреплённый всегда выше незакреплённого, как бы стар он ни был', async () => {
    const mgr = newDialogsManager({
      rest: restStub([]) as never,
      onDialogOps: () => {},
      loadCache: async () => [dialog(1, '2020-01-01T00:00:00Z', true), dialog(2, '2026-08-02T00:00:00Z')],
      loadState: async () => ({ pinnedOrders: {}, drafts: [] }),
    })

    const op = await mgr.fillMirror()
    expect((op as { items: { dialog: Dialog }[] }).items.map((i) => i.dialog.chatId)).toEqual([1, 2])
  })

  // Ревью (Important #1): `hydrated = true` ставился СИНХРОННО, до await
  // loadState()/loadCache(). Конкурентный вызов (две вкладки на общем
  // SharedWorker стартуют одновременно, или fillMirror()/refresh() идут
  // параллельно) видел hydrated===true и немедленно возвращался с ПУСТЫМ items —
  // до того, как первый вызов вообще успел их загрузить. Кэшируем сам промис
  // гидратации, а не булев флаг: конкурентные вызовы ждут ОДИН И ТОТ ЖЕ промис.
  it('конкурентный fillMirror не рассылает пустой reset (гонка гидратации)', async () => {
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
    const mgr = newDialogsManager({
      rest: restStub([]) as never,
      onDialogOps: () => {},
      loadCache: async () => { await sleep(5); return [dialog(1, '2026-08-01T00:00:00Z')] },
      loadState: async () => { await sleep(5); return { pinnedOrders: {}, drafts: [] } },
    })

    const [op1, op2] = await Promise.all([mgr.fillMirror(), mgr.fillMirror()])

    expect((op1 as { items: unknown[] }).items).toHaveLength(1)
    expect((op2 as { items: unknown[] }).items).toHaveLength(1)
  })

  // Симметричный случай: гидратация упала (сеть/IDB недоступны) — следующий
  // вызов обязан попробовать снова, а не залипнуть на вечно pending промисе.
  it('упавшая гидратация не залипает — следующий fillMirror пробует снова', async () => {
    let attempt = 0
    const mgr = newDialogsManager({
      rest: restStub([]) as never,
      onDialogOps: () => {},
      loadCache: async () => [dialog(1, '2026-08-01T00:00:00Z')],
      loadState: async () => {
        attempt++
        if (attempt === 1) throw new Error('IDB недоступен')
        return { pinnedOrders: {}, drafts: [] }
      },
    })

    await expect(mgr.fillMirror()).rejects.toThrow('IDB недоступен')
    const op = await mgr.fillMirror()
    expect((op as { items: { dialog: Dialog }[] }).items.map((i) => i.dialog.chatId)).toEqual([1])
  })
})
