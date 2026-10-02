// Мост React-редактора чата на Solid-вкладку «Пригласительные ссылки» (задача
// 0б-3 волны 7, ВРЕМЕННО до 0б-1). Строка «Invite Links» открывает
// `AppChatInviteLinksTab` настоящим `appSidebarRight.createTab(…).open(…)` с
// предзагрузкой `getInitArgs` (как tweb `editChat.tsx:689-692`), а не React-экран.
//
// Шов тот же, что у вкладки типа (0б-2): оверлей `GroupEditFlow` — сосед вкладок
// в `.sidebar-slider` со своим `z-index: 60`; пока вкладка открыта, он спрятан,
// Esc закрывает только вкладку, оверлей возвращается и перечитывает карточку.
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

const CHANNEL: Channel = { _: 'channel', id: 20, title: 'Channel', photo: { _: 'chatPhotoEmpty' }, date: 0, pFlags: { broadcast: true, creator: true } } as Channel
const FULL: ChannelFull = { _: 'channelFull', id: 20, about: '', read_inbox_max_id: 0, read_outbox_max_id: 0, unread_count: 0, chat_photo: null }

const reload = vi.hoisted(() => vi.fn())
vi.mock('@core/hooks/useGroupEdit', async(importOriginal) => ({
  ...(await importOriginal<typeof import('@core/hooks/useGroupEdit')>()),
  useGroupEdit: (): Partial<GroupEdit> => ({
    card: { peerId: -20, chat: CHANNEL, fullChat: FULL },
    members: [], admins: [], invites: [], bans: [], restricted: [],
    canBan: false, canManageAdmins: true, isCreator: true,
    reload,
  }),
}))
const managers = vi.hoisted(() => ({ value: {} as unknown }))
vi.mock('@core/hooks/useManagers', () => ({ useManagers: () => managers.value }))
vi.mock('@core/hooks/useMediaUrl', () => ({ useMediaUrl: () => '' }))

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const settle = async() => {
  for(let i = 0; i < 12; ++i) await act(() => pause(0))
}
const click = (el: Element) => el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))

let column: ReturnType<typeof installSidebarRight>
let getExportedChatInvites: ReturnType<typeof vi.fn>

beforeEach(() => {
  resetPeerMirror()
  applyPeerOps([{ op: 'upsert', peers: [CHANNEL] }])
  reload.mockReset()
  getExportedChatInvites = vi.fn(async() => ({
    _: 'messages.exportedChatInvites', count: 1,
    invites: [{ _: 'chatInviteExported', link: 'https://t.me.local/+primary', admin_id: 1, date: 0 }],
  }))
  managers.value = { groups: { getExportedChatInvites, exportChatInvite: vi.fn() } }
  column = installSidebarRight(managers.value as Managers)
})

afterEach(async() => {
  cleanup()
  column.dispose()
  await pause(400)
  document.body.replaceChildren()
})

const renderFlow = () => {
  const chat = { id: '-20', type: 'channel', name: 'Channel', avatarText: 'C' } as unknown as Chat
  render(createPortal(<GroupEditFlow chatId={-20} chat={chat} onClose={() => {}} />, column.slider))
  // корень экрана — `.tabs-container` кита, сосед вкладок в `.sidebar-slider`
  return column.slider.querySelector<HTMLElement>(':scope > .tabs-container')!
}

const linksRow = (overlay: HTMLElement) =>
  [...overlay.querySelectorAll<HTMLElement>('.row')].find((row) => row.textContent?.includes(lang.InviteLinks))!

const openLinksTab = async(overlay: HTMLElement) => {
  await act(async() => { click(linksRow(overlay)) })
  await vi.waitFor(() => {
    if(!column.slider.querySelector(':scope > .chat-folders-container.active')) throw new Error('вкладка ещё не открыта')
  }, { timeout: 5000 })
  await settle()
}

describe('GroupEditFlow → AppChatInviteLinksTab (мост 0б-3)', () => {
  it('строка «Invite Links» открывает Solid-вкладку с предзагрузкой и прячет оверлей', async() => {
    const overlay = renderFlow()
    expect(overlay.classList.contains('hide')).toBe(false)

    await openLinksTab(overlay)

    const tab = column.slider.querySelector<HTMLElement>(':scope > .chat-folders-container.chat-discussion-container')
    expect(tab!.classList.contains('active')).toBe(true)
    expect(overlay.classList.contains('hide')).toBe(true)
    // `getInitArgs` — активные и отозванные (tweb `chatInviteLinkShared.ts:148-149`)
    // и «постоянная» (порт `getChatInviteLink`, О-120)
    expect(getExportedChatInvites).toHaveBeenCalledWith({ chatId: 20 })
    expect(getExportedChatInvites).toHaveBeenCalledWith({ chatId: 20, revoked: true })
    // React-экрана ссылок больше нет — внутри оверлея второй вкладки не появилось
    expect(overlay.querySelectorAll('.sidebar-slider-item')).toHaveLength(1)
  })

  it('Esc закрывает только вкладку: оверлей снова виден и перечитывает карточку', async() => {
    const overlay = renderFlow()
    await openLinksTab(overlay)

    await act(async() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
      await pause(400)
    })

    expect(column.slider.querySelector('.chat-folders-container')).toBeNull()
    expect(overlay.isConnected).toBe(true)
    expect(overlay.classList.contains('hide')).toBe(false)
    expect(reload).toHaveBeenCalledTimes(1)
  })
})
