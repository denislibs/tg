import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { chatMatchesFolder, dialogMatchesFolder, folderCounts, matchesFolder, type FolderMatchable } from './folderFilter'
import type { Folder } from './managers/foldersManager'
import type { Dialog } from './models'
import type { Chat } from '../data'

const folder = (over: Partial<Folder>): Folder => ({
  id: 1, title: 'F', pos: 0,
  includeChats: [], excludeChats: [],
  contacts: false, nonContacts: false, groups: false, broadcasts: false,
  excludeRead: false, excludeMuted: false,
  ...over,
})

const chat = (over: Partial<Chat>): Chat => ({
  id: '5', name: 'c', avatar: '', date: '', preview: '', type: 'group',
  ...over,
})

// Один и тот же чат, описанный как Chat (main) и как Dialog (воркер), обязан
// давать один ответ — иначе список папки на экране и страница из воркера
// разъедутся.
describe('matchesFolder: один ответ для Chat и Dialog', () => {
  const cases: { name: string; item: FolderMatchable; f: Folder; want: boolean }[] = [
    { name: 'exclude бьёт include', item: { peerId: 5, type: 'group' }, f: folder({ excludeChats: [5], includeChats: [5], groups: true }), want: false },
    { name: 'include без флагов типов', item: { peerId: 5, type: 'group' }, f: folder({ includeChats: [5] }), want: true },
    { name: 'без флагов типов — не попадает', item: { peerId: 5, type: 'group' }, f: folder({}), want: false },
    { name: 'группы', item: { peerId: 5, type: 'group' }, f: folder({ groups: true }), want: true },
    { name: 'группа при flag groups=false (несмотря на contacts=true) — не попадает', item: { peerId: 5, type: 'group' }, f: folder({ groups: false, contacts: true }), want: false },
    { name: 'каналы', item: { peerId: 5, type: 'channel' }, f: folder({ broadcasts: true }), want: true },
    { name: 'канал при flag broadcasts=false (несмотря на contacts=true) — не попадает', item: { peerId: 5, type: 'channel' }, f: folder({ broadcasts: false, contacts: true }), want: false },
    { name: 'контакт', item: { peerId: 7, type: 'private' }, f: folder({ contacts: true }), want: true },
    { name: 'contacts=true, но ключ не в contactIds — не попадает', item: { peerId: 9, type: 'private' }, f: folder({ contacts: true }), want: false },
    { name: 'не-контакт', item: { peerId: 9, type: 'private' }, f: folder({ nonContacts: true }), want: true },
    { name: 'excludeRead отсекает прочитанные', item: { peerId: 5, type: 'group', unread: 0 }, f: folder({ groups: true, excludeRead: true }), want: false },
    { name: 'excludeMuted отсекает заглушённые', item: { peerId: 5, type: 'group', muted: true }, f: folder({ groups: true, excludeMuted: true }), want: false },
  ]
  const contacts = new Set([7])
  for (const c of cases) {
    it(c.name, () => {
      expect(matchesFolder(c.item, c.f, contacts)).toBe(c.want)
    })
  }
})

// Адаптер Chat → FolderMatchable (main-поток): draft-чаты (нечисловой id)
// в папки не попадают — эта проверка раньше была первой строкой matchesFolder,
// теперь она перенесена сюда.
describe('chatMatchesFolder: адаптер Chat, draft-чаты отсекаются', () => {
  const contacts = new Set<number>()

  it('draft-чат (нечисловой id) не попадает в папку, даже когда флаги типов совпадают', () => {
    const c = chat({ id: 'draft-1', type: 'group' })
    const f = folder({ groups: true })
    expect(chatMatchesFolder(c, f, contacts)).toBe(false)
  })

  it('обычный чат с числовым id проксируется в matchesFolder', () => {
    const c = chat({ id: '5', type: 'group' })
    const f = folder({ groups: true })
    expect(chatMatchesFolder(c, f, contacts)).toBe(true)
  })
})

// Адаптер Dialog → FolderMatchable (воркер): у `Dialog` нет плоского `peerId`
// (собеседник лежит в `peer.id`), а поле `FolderMatchable.peerId` опционально —
// прямой вызов `matchesFolder(dialog, …)` прошёл бы тайпчек МОЛЧА и всегда
// считал приватный чат НЕ контактом. Именно это и проверяем: тест краснеет,
// если адаптер перестанет маппить `peer?.id`.
describe('dialogMatchesFolder: адаптер Dialog, контактность из peer.id', () => {
  const dialog = (over: Partial<Dialog>): Dialog => ({
    peerId: 5, type: 'private', title: 't', unread: 0, unreadMentions: 0, unreadReactions: 0,
    lastReadSeq: 0, peerReadSeq: 0, muted: false, pinned: false, archived: false,
    ...over,
  } as Dialog)
  const contacts = new Set([7])

  // Ключ приватного диалога И ЕСТЬ id собеседника — второго поля рядом больше
  // нет, и прежняя ловушка «забыли передать peer.id, ветка контактности молча
  // выключилась» исчезла вместе с ним.
  it('приватный чат с ключом из контактов попадает в папку «Контакты»', () => {
    const d = dialog({ peerId: 7 })
    expect(dialogMatchesFolder(d, folder({ contacts: true }), contacts)).toBe(true)
  })

  it('он же НЕ попадает в папку «Не контакты»', () => {
    const d = dialog({ peerId: 7 })
    expect(dialogMatchesFolder(d, folder({ nonContacts: true }), contacts)).toBe(false)
  })

  it('чужой (ключ вне контактов) — наоборот', () => {
    const d = dialog({ peerId: 9 })
    expect(dialogMatchesFolder(d, folder({ nonContacts: true }), contacts)).toBe(true)
    expect(dialogMatchesFolder(d, folder({ contacts: true }), contacts)).toBe(false)
  })

  it('остальные поля (тип, unread, muted, include/exclude) проксируются как есть', () => {
    const g = dialog({ peerId: 5, type: 'group', unread: 0, muted: true })
    expect(dialogMatchesFolder(g, folder({ groups: true }), contacts)).toBe(true)
    expect(dialogMatchesFolder(g, folder({ groups: true, excludeMuted: true }), contacts)).toBe(false)
    expect(dialogMatchesFolder(g, folder({ groups: true, excludeRead: true }), contacts)).toBe(false)
    expect(dialogMatchesFolder(g, folder({ excludeChats: [5], groups: true }), contacts)).toBe(false)
    expect(dialogMatchesFolder(g, folder({ includeChats: [5] }), contacts)).toBe(true)
  })
})

// folderCounts (подзаголовок таба папки) — тонкая свёртка chatMatchesFolder,
// но сама свёртка (группировка по типу) больше нигде не проверяется.
describe('folderCounts', () => {
  it('считает чаты/каналы/группы, попавшие в папку, раздельно', () => {
    const f = folder({ groups: true, broadcasts: true, contacts: true })
    const contacts = new Set([7])
    const chats = [
      chat({ id: '1', type: 'group' }),
      chat({ id: '2', type: 'channel' }),
      chat({ id: '7', type: 'private' }),
      chat({ id: 'draft-x', type: 'group' }), // draft — не считается
    ]
    expect(folderCounts(chats, f, contacts)).toEqual({ chats: 1, channels: 1, groups: 1 })
  })
})

// Правила папок описаны РОВНО в одном файле — core/folderFilter.ts. Вторая
// реализация (даже частичная) — второй источник правды: чаты в разных
// папках на разных экранах (main vs воркер).
//
// Поля Folder (excludeRead/nonContacts/...) сами по себе не годятся как
// маркер: их легитимно читают/пишут за пределами folderFilter.ts — тип
// Folder (foldersManager.ts), маппинг REST-снимка, редактор папки
// (FolderEditor.tsx, ChatFoldersSettings.tsx, FoldersSidebar.tsx,
// FolderChatsPicker.tsx). Маркер — выражения, которые встречаются ТОЛЬКО в
// самой логике сопоставления (аналог `firstUnpinned`/`.sort(` в
// noManualOrder.test.ts:76-84): membership-проверки include/exclude-списков
// чатов папки. (`contactIds.has(` не годится маркером — тот же паттерн
// случайно совпадает с несвязанным `useChatAutoDownload.ts`.)
describe('folderFilter: правила папок описаны ровно в одном файле', () => {
  const SRC_ROOT = join(__dirname, '..')
  const RULE_FILE = 'core/folderFilter.ts'

  function walk(dir: string, acc: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
      if (name === 'node_modules') continue
      const p = join(dir, name)
      if (statSync(p).isDirectory()) walk(p, acc)
      else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) acc.push(p)
    }
    return acc
  }

  const stripComments = (src: string): string => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '')

  for (const marker of ['excludeChats.includes(', 'includeChats.includes(']) {
    it(`выражение "${marker}" (правило сопоставления) встречается только в ${RULE_FILE}`, () => {
      const users = walk(SRC_ROOT)
        .map((f) => f.slice(SRC_ROOT.length + 1).replace(/\\/g, '/'))
        .filter((rel) => rel !== RULE_FILE)
        .filter((rel) => stripComments(readFileSync(join(SRC_ROOT, rel), 'utf8')).includes(marker))

      expect(users).toEqual([])
    })
  }
})
