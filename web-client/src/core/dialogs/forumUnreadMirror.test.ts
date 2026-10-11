// Зеркало непрочитанного форумов на главном потоке — то, чем счётчики папок
// заменяют tweb `getForumUnreadCount` (dialogs.ts:2229-2258): значение владельца
// приезжает операцией `forumUnread`, неизвестный форум спрашивается один раз.
import { afterEach, describe, expect, it, vi } from 'vitest'
import rootScope from '@lib/rootScope'
import { RT } from '../realtime/events'
import { applyPeerOps, resetPeerMirror } from '../peerCache'
import { getForumUnread, isDialogUnreadUnmuted, registerForumUnreadMirror, resetForumUnreadMirror, subscribeForumUnread } from './forumUnreadMirror'

const FORUM = -60
const unread = (count: number) => ({ count, unreadNotifySettings: [] })
const fetcher = vi.fn(async (_peerId: number) => unread(3))
registerForumUnreadMirror((peerId) => fetcher(peerId))

afterEach(() => { resetForumUnreadMirror(); resetPeerMirror(); fetcher.mockClear() })

describe('forumUnreadMirror', () => {
  it('операция `forumUnread` со значением кладёт его и будит подписчиков, без значения — снимает', () => {
    const listener = vi.fn()
    const off = subscribeForumUnread(listener)
    rootScope.dispatchEventSingle(RT.forumTopicOp, { ops: [{ op: 'forumUnread', peerId: FORUM, unread: unread(2) }] })
    expect(getForumUnread(FORUM)).toEqual(unread(2))
    expect(listener).toHaveBeenCalledTimes(1)
    rootScope.dispatchEventSingle(RT.forumTopicOp, { ops: [{ op: 'forumUnread', peerId: FORUM }] })
    expect(getForumUnread(FORUM)).toBeUndefined()
    // снятое значение (форум выключили) — следующий вопрос снова к владельцу
    expect(fetcher).toHaveBeenCalledTimes(1)
    off()
  })

  it('неизвестный форум спрашивается у владельца один раз (tweb: вызов запускает загрузку тем)', async () => {
    expect(getForumUnread(FORUM)).toBeUndefined()
    expect(getForumUnread(FORUM)).toBeUndefined()
    expect(fetcher).toHaveBeenCalledTimes(1)
    await vi.waitFor(() => expect(getForumUnread(FORUM)).toEqual(unread(3)))
  })

  it('isDialogUnreadUnmuted: форум — непрочитанные темы и их мьют, остальные — `unread_count` и мьют диалога', () => {
    applyPeerOps([{ op: 'upsert', peers: [{ _: 'channel', id: 60, title: 'Ф', photo: { _: 'chatPhotoEmpty' }, date: 0, pFlags: { megagroup: true, forum: true } } as never] }])
    rootScope.dispatchEventSingle(RT.forumTopicOp, { ops: [{ op: 'forumUnread', peerId: FORUM, unread: { count: 1, unreadNotifySettings: [{ _: 'peerNotifySettings' }] } }] })
    expect(isDialogUnreadUnmuted({ peerId: FORUM, unread_count: 0 }, () => false)).toBe(true)
    // тема без своей настройки наследует мьют форума
    expect(isDialogUnreadUnmuted({ peerId: FORUM, unread_count: 0 }, () => true)).toBe(false)
    expect(isDialogUnreadUnmuted({ peerId: 5, unread_count: 4 }, () => false)).toBe(true)
    expect(isDialogUnreadUnmuted({ peerId: 5, unread_count: 4 }, () => true)).toBe(false)
  })

  it('выход из сессии сбрасывает зеркало', () => {
    rootScope.dispatchEventSingle(RT.forumTopicOp, { ops: [{ op: 'forumUnread', peerId: FORUM, unread: unread(2) }] })
    rootScope.dispatchEventSingle(RT.loggingOut, { migrateTo: undefined } as never)
    expect(fetcher).not.toHaveBeenCalled()
    expect(getForumUnread(FORUM)).toBeUndefined()
  })
})
