// Мост React-редактора группы на Solid-вкладку «Разрешения» (задача 0б-6 волны 7,
// ВРЕМЕННО до 0б-1). Строка «Разрешения» открывает `AppGroupPermissionsTab`
// настоящим `appSidebarRight.createTab(…).open(…)` (как tweb `editChat.tsx:342`), а
// не React-экран, — тот же шов, что у вкладки типа (`GroupEditFlow.chatTypeTab.test.tsx`):
// оверлей `GroupEditFlow` — сосед вкладок в `.sidebar-slider` со своим `z-index: 60`,
// поэтому, пока вкладка открыта, он спрятан; Esc/Back закрывают только вкладку.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render } from '@testing-library/react'
import { createPortal } from 'react-dom'
import type { Managers } from '@/client/bootstrap'
import type { Channel, ChannelFull } from '@core/peers/peer'
import type { GroupEdit } from '@core/hooks/useGroupEdit'
import type { Chat } from '@/data'
import lang from '@/lang'
import { applyPeerOps, resetPeerMirror } from '@core/peerCache'
import { installSidebarRight } from '@/test/sidebarRight'
import GroupEditFlow from './GroupEditFlow'

const GROUP: Channel = { _: 'channel', id: 30, title: 'Group', photo: { _: 'chatPhotoEmpty' }, date: 0, pFlags: { megagroup: true, creator: true } } as Channel
const FULL: ChannelFull = { _: 'channelFull', id: 30, about: '', read_inbox_max_id: 0, read_outbox_max_id: 0, unread_count: 0, chat_photo: null }

const reload = vi.hoisted(() => vi.fn())
vi.mock('@core/hooks/useGroupEdit', async(importOriginal) => ({
  ...(await importOriginal<typeof import('@core/hooks/useGroupEdit')>()),
  useGroupEdit: (): Partial<GroupEdit> => ({
    card: { peerId: -30, chat: GROUP, fullChat: FULL },
    members: [], admins: [], invites: [], bans: [], restricted: [],
    canBan: true, canManageAdmins: true, isCreator: true,
    reload,
  }),
}))
vi.mock('@core/hooks/useManagers', () => ({ useManagers: () => ({}) }))
vi.mock('@core/hooks/useMediaUrl', () => ({ useMediaUrl: () => '' }))

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const settle = async() => {
  for(let i = 0; i < 12; ++i) await act(() => pause(0))
}
const click = (el: Element) => el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))

let column: ReturnType<typeof installSidebarRight>
let groups: Record<string, ReturnType<typeof vi.fn>>

beforeEach(() => {
  resetPeerMirror()
  applyPeerOps([{ op: 'upsert', peers: [GROUP] }])
  reload.mockReset()
  groups = {
    card: vi.fn(async() => ({ peerId: -30, chat: GROUP, fullChat: FULL })),
    channelParticipantsBanned: vi.fn(async() => ({ _: 'channels.channelParticipants', count: 0, participants: [], chats: [], users: [] })),
    editChatDefaultBannedRights: vi.fn(async() => {}),
    setChargeStars: vi.fn(async() => {}),
  }
  column = installSidebarRight({ groups, peers: { fillMirror: vi.fn(async() => {}) } } as unknown as Managers)
})

afterEach(async() => {
  cleanup()
  column.dispose()
  await pause(400)
  document.body.replaceChildren()
})

const renderFlow = () => {
  const chat = { id: '-30', type: 'group', name: 'Group', avatarText: 'G' } as unknown as Chat
  render(createPortal(<GroupEditFlow chatId={-30} chat={chat} onClose={() => {}} />, column.slider))
  // корень экрана — `.tabs-container` кита, сосед вкладок в `.sidebar-slider`
  return column.slider.querySelector<HTMLElement>(':scope > .tabs-container')!
}

const permissionsRow = (overlay: HTMLElement) =>
  [...overlay.querySelectorAll<HTMLElement>('.row')].find((row) => row.textContent?.includes(lang.ChannelPermissions))!

const openPermissionsTab = async(overlay: HTMLElement) => {
  await act(async() => { click(permissionsRow(overlay)) })
  await vi.waitFor(() => {
    if(!column.slider.querySelector(':scope > .group-permissions-container.active')) throw new Error('вкладка ещё не открыта')
  }, { timeout: 5000 })
  await settle()
}

describe('GroupEditFlow → AppGroupPermissionsTab (мост 0б-6)', () => {
  it('строка «Разрешения» открывает Solid-вкладку в слайдере колонки и прячет оверлей', async() => {
    const overlay = renderFlow()
    expect(overlay.classList.contains('hide')).toBe(false)

    await openPermissionsTab(overlay)

    const tab = column.slider.querySelector<HTMLElement>(':scope > .group-permissions-container')!
    expect(tab.classList.contains('active')).toBe(true)
    expect(overlay.classList.contains('hide')).toBe(true)
    // React-экрана прав больше нет — внутри оверлея второй вкладки не появилось
    expect(overlay.querySelectorAll('.sidebar-slider-item')).toHaveLength(1)
    expect(groups.editChatDefaultBannedRights).not.toHaveBeenCalled()
  })

  it('Esc закрывает только вкладку: оверлей снова виден и перечитывает карточку', async() => {
    const overlay = renderFlow()
    await openPermissionsTab(overlay)

    await act(async() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
      await pause(400)
    })

    expect(column.slider.querySelector('.group-permissions-container')).toBeNull()
    expect(overlay.isConnected).toBe(true)
    expect(overlay.classList.contains('hide')).toBe(false)
    expect(reload).toHaveBeenCalledTimes(1)
  })
})
