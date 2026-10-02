// Врезка вкладки «Изменить контакт» (задача 0б-10 волны 7). Оба входа оригинала
// открывают ОДНУ вкладку правой колонки `AppEditContactTab`:
//   • пункт ⋮ «AddContact» — `ChatTopbar.addContact` (tweb `topbar.ts:902-908`),
//     у нас до Э6-2 — `useChatPopups::openAddContact`: вкладка + показ колонки,
//     повторный вызов при открытой вкладке ничего не делает (`isTabExists`);
//   • карандаш профиля — tweb `sharedMedia.tsx:675-686` (`tab.slider.createTab`),
//     у нас до 3-1 — проп `onEditContact` панели в `Chat.tsx` (пин — скан ниже:
//     сам `Chat.tsx` тестами не монтируется, `web-client/CLAUDE.md`, «Тесты»).
// Колонка — настоящий синглтон `AppSidebarRight` (`test/sidebarRight.ts`).
import type { ReactNode } from 'react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useChatPopups, type ChatPopupDeps } from './useChatPopups'
import { ManagersProvider } from './useManagers'
import type { Chat } from '../../data'
import type { Managers } from '../../client/bootstrap'
import { installSidebarRight } from '../../test/sidebarRight'
import { RIGHT_COLUMN_ACTIVE_CLASSNAME } from '../../components/sidebarRight'
import { AppEditContactTab } from '../../components/solidJsTabs/tabs'
import { applyPeerOps, resetPeerMirror } from '../peerCache'

const PEER = 2
const user = { _: 'user' as const, id: PEER, first_name: 'Two', pFlags: {} }

function mkManagers() {
  return {
    contacts: { isContact: vi.fn(async() => false), list: vi.fn(async() => []) },
    privacy: {
      rule: vi.fn(async() => ({ key: 'phone_number', value: 'everybody', allowUserIds: [], denyUserIds: [] })),
      profile: vi.fn(async() => ({ user, fullUser: { _: 'userFull', id: PEER }, canMessage: true })),
    },
    peers: { getUsers: vi.fn(async() => [user]), fillMirror: vi.fn(async() => {}) },
  }
}

const chat: Chat = { id: '' + PEER, name: 'Two', avatar: '', preview: '', type: 'private' }

function mkDeps(): ChatPopupDeps {
  return { chat, numericChatId: PEER, isRealChat: true, isChannel: false } as ChatPopupDeps
}

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

let right: ReturnType<typeof installSidebarRight>
let managers: ReturnType<typeof mkManagers>

beforeEach(() => {
  resetPeerMirror()
  applyPeerOps([{ op: 'upsert', peers: [user] }])
  managers = mkManagers()
  right = installSidebarRight(managers as unknown as Managers)
})

afterEach(async() => {
  right.dispose()
  await pause(400)
  document.body.replaceChildren()
  document.body.classList.remove(RIGHT_COLUMN_ACTIVE_CLASSNAME)
})

describe('врезка 0б-10: «AddContact» из меню чата', () => {
  it('открывает вкладку «Изменить контакт» с пиром чата и показывает колонку; повтор — no-op', async() => {
    const { result } = renderHook(() => useChatPopups(mkDeps()), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <ManagersProvider managers={managers as never}>{children}</ManagersProvider>
      ),
    })

    act(() => { result.current.openAddContact() })
    await vi.waitFor(() => expect(right.sidebar.isTabExists(AppEditContactTab)).toBe(true))
    await pause(50)

    const tabs = right.sidebar.getHistory().filter((tab) => tab instanceof AppEditContactTab)
    expect(tabs).toHaveLength(1)
    const tab = tabs[0] as InstanceType<typeof AppEditContactTab>
    expect(tab.payload).toBe(PEER)
    expect(tab.title.textContent).toBe('Add Contact')
    expect(right.column.contains(tab.container)).toBe(true)
    expect(document.body.classList.contains(RIGHT_COLUMN_ACTIVE_CLASSNAME)).toBe(true)

    act(() => { result.current.openAddContact() })
    await pause(50)
    expect(right.sidebar.getHistory().filter((t) => t instanceof AppEditContactTab)).toHaveLength(1)
    expect(managers.contacts.isContact).toHaveBeenCalledTimes(1)
  })
})

describe('врезка 0б-10: карандаш профиля (`Chat.tsx`)', () => {
  const src = readFileSync(resolve(process.cwd(), 'src/components/Chat.tsx'), 'utf8')

  it('onEditContact открывает AppEditContactTab в слайдере правой колонки по пиру чата', () => {
    const line = src.split('\n').find((l) => l.includes('onEditContact='))!
    expect(line).toContain('appSidebarRight.createTab(AppEditContactTab).open(Number(chat.id))')
    // колонку не закрывает: вкладка въезжает поверх профиля, как у tweb
    expect(line).not.toContain('toggleSidebar(false)')
  })

  it('прежнего React-экрана нет нигде', () => {
    expect(src).not.toMatch(/EditContactView|openEditContact/)
  })
})
