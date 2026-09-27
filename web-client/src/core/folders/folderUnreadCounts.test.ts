// Счётчик непрочитанного по папкам — порт правила tweb `stores/folders.ts:19-30`
// (`getNotificationCountForFilter`) поверх зеркала диалогов главного потока.
// Пины — на ответ функции: что показывает бейдж вкладки и серый ли он.
import { describe, expect, it } from 'vitest'
import { folderUnreadCounts } from './folderUnreadCounts'
import { makeDialog } from '../dialogs/testDialog'
import type { Folder } from '../managers/foldersManager'
import type { NotifySettings } from '../managers/notifyManager'
import type { Chat } from '../peers/peer'
import { ALL_FOLDER_ID } from '../folderIds'

const SETTINGS: NotifySettings = {
  private: { muted: false, preview: true },
  groups: { muted: false, preview: true },
  channels: { muted: false, preview: true },
}

const folder = (id: number, over: Partial<Folder> = {}): Folder => ({
  id, title: `F${id}`, pos: id,
  contacts: false, nonContacts: false, groups: false, broadcasts: false,
  bots: false, excludeMuted: false, excludeRead: false, includeChats: [], excludeChats: [],
  ...over,
})

const BROADCAST: Chat = { _: 'channel', id: 50, title: 'Канал', photo: { _: 'chatPhotoEmpty' }, date: 0, pFlags: { broadcast: true } }
const noChat = (): Chat | undefined => undefined
const NO_CONTACTS: ReadonlySet<number> = new Set()

describe('folderUnreadCounts — «Все чаты»', () => {
  it('считает непрочитанные НЕзамьюченные чаты, архив не входит', () => {
    const counts = folderUnreadCounts([
      makeDialog({ peerId: 1, unread: 3 }),
      makeDialog({ peerId: 2, unread: 1 }),
      makeDialog({ peerId: 3, unread: 5, muteUntil: true }),
      makeDialog({ peerId: 4, unread: 2, archived: true }),
      makeDialog({ peerId: 5 }),
    ], [], NO_CONTACTS, SETTINGS, noChat)

    // МУТАЦИЯ: считать «Все чаты» по ВСЕМ непрочитанным (unreadCount вместо
    // unreadUnmutedCount, `folders.ts:27`) — здесь станет 3.
    expect(counts[ALL_FOLDER_ID]).toEqual({ count: 2, muted: false })
  })

  it('чат глобально выключенного ТИПА считается замьюченным (правило isDialogMuted)', () => {
    const counts = folderUnreadCounts(
      [makeDialog({ peerId: -50, unread: 4 })],
      [], NO_CONTACTS,
      { ...SETTINGS, channels: { muted: true, preview: true } },
      (id) => (id === -50 ? BROADCAST : undefined),
    )
    expect(counts[ALL_FOLDER_ID]).toEqual({ count: 0, muted: true })
  })
})

describe('folderUnreadCounts — пользовательская папка', () => {
  it('считает ВСЕ непрочитанные чаты под правилом папки, включая замьюченные', () => {
    const work = folder(7, { nonContacts: true })
    const counts = folderUnreadCounts([
      makeDialog({ peerId: 1, unread: 3 }),
      makeDialog({ peerId: 2, unread: 1, muteUntil: true }),
      makeDialog({ peerId: 3, unread: 1 }), // контакт — не под правилом nonContacts
      makeDialog({ peerId: 4, unread: 9, archived: true }), // архив — как у списка папки
      makeDialog({ peerId: 5 }),
    ], [work], new Set([3]), SETTINGS, noChat)

    expect(counts[7]).toEqual({ count: 2, muted: false })
  })

  it('правило excludeMuted видит заглушённость по ТИПУ — тот же ответ, что у списка папки', () => {
    const channels = folder(8, { broadcasts: true, excludeMuted: true })
    const counts = folderUnreadCounts(
      [makeDialog({ peerId: -50, unread: 4 })],
      [channels], NO_CONTACTS,
      { ...SETTINGS, channels: { muted: true, preview: true } },
      (id) => (id === -50 ? BROADCAST : undefined),
    )
    expect(counts[8]).toEqual({ count: 0, muted: false })
  })

  it('у каждой папки — своя запись, пустая папка — ноль', () => {
    const counts = folderUnreadCounts(
      [makeDialog({ peerId: 1, unread: 1 })],
      [folder(7, { nonContacts: true }), folder(9, { groups: true })],
      NO_CONTACTS, SETTINGS, noChat,
    )
    expect(counts).toEqual({
      [ALL_FOLDER_ID]: { count: 1, muted: false },
      7: { count: 1, muted: false },
      9: { count: 0, muted: false },
    })
  })
})

describe('folderUnreadCounts — muted (`folders.ts:28`)', () => {
  const work = folder(7, { nonContacts: true })

  it('true ровно когда непрочитанное есть, но всё замьючено', () => {
    const counts = folderUnreadCounts([
      makeDialog({ peerId: 1, unread: 2, muteUntil: true }),
      makeDialog({ peerId: 2, unread: 1, muteUntil: true }),
    ], [work], NO_CONTACTS, SETTINGS, noChat)

    expect(counts[ALL_FOLDER_ID]).toEqual({ count: 0, muted: true })
    expect(counts[7]).toEqual({ count: 2, muted: true })
  })

  it('false, если хотя бы один непрочитанный чат не замьючен', () => {
    const counts = folderUnreadCounts([
      makeDialog({ peerId: 1, unread: 2, muteUntil: true }),
      makeDialog({ peerId: 2, unread: 1 }),
    ], [work], NO_CONTACTS, SETTINGS, noChat)

    expect(counts[7]).toEqual({ count: 2, muted: false })
  })

  it('false, когда непрочитанного нет вовсе (бейдж пуст, а не серый)', () => {
    const counts = folderUnreadCounts(
      [makeDialog({ peerId: 1, muteUntil: true })],
      [work], NO_CONTACTS, SETTINGS, noChat,
    )
    expect(counts[ALL_FOLDER_ID]).toEqual({ count: 0, muted: false })
    expect(counts[7]).toEqual({ count: 0, muted: false })
  })

  it('непрочитанное упоминание в замьюченном чате делает бейдж НЕ серым', () => {
    const counts = folderUnreadCounts([
      makeDialog({ peerId: 1, unread: 2, unreadMentions: 1, muteUntil: true }),
    ], [work], NO_CONTACTS, SETTINGS, noChat)

    expect(counts[7]).toEqual({ count: 1, muted: false })
  })
})
