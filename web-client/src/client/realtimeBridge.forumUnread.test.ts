// Проводка зеркала непрочитанного форумов в startRealtime(): без строки
// `registerForumUnreadMirror(...)` счётчики папок не узнают число непрочитанных
// тем (tweb getDialogUnreadCount :14233-14250) — ни операцией, ни вопросом владельцу.
import { describe, expect, it, vi } from 'vitest'

const { getForumUnreadCount } = vi.hoisted(() => ({ getForumUnreadCount: vi.fn(async () => ({ count: 2, unreadNotifySettings: [] })) }))
vi.mock('./bootstrap', () => ({
  startClient: () => ({
    smp: { on: vi.fn(), emit: vi.fn() },
    managers: { media: { tokenInfo: vi.fn(async () => ({ token: 't', expiresAt: Date.now() + 900_000 })) }, realtime: { start: vi.fn(async () => {}) }, forumTopics: { getForumUnreadCount } },
  }),
}))

describe('realtimeBridge.startRealtime — зеркало непрочитанного форумов', () => {
  it('неизвестный форум спрашивается у хранилища тем воркера, операция `forumUnread` доходит до зеркала', async () => {
    vi.resetModules()
    const mirror = await import('../core/dialogs/forumUnreadMirror')
    const { default: rootScope } = await import('@lib/rootScope')
    const { RT } = await import('../core/realtime/events')
    const { startRealtime } = await import('./realtimeBridge')
    startRealtime()

    mirror.getForumUnread(-60)
    expect(getForumUnreadCount).toHaveBeenCalledWith(-60)
    rootScope.dispatchEventSingle(RT.forumTopicOp, { ops: [{ op: 'forumUnread', peerId: -61, unread: { count: 1, unreadNotifySettings: [] } }] })
    expect(mirror.getForumUnread(-61)?.count).toBe(1)
  }, 30_000) // холодный импорт всего насоса — несколько секунд под нагрузкой
})
