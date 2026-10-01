// Мост React-редактора чата на Solid-вкладку «Тип» (задача 0б-2 волны 7,
// ВРЕМЕННО до 0б-1). Строка «Тип канала» открывает `AppChatTypeTab` настоящим
// `appSidebarRight.createTab(…).open(…)` (как tweb `editChat.tsx`), а не React-экран.
//
// Шов, который здесь закреплён: React-оверлей `GroupEditFlow` лежит СОСЕДОМ вкладок
// в `.sidebar-slider` со своим `z-index: 60`, поэтому открытая из него вкладка
// слайдера оказалась бы ПОД ним. Пока вкладка открыта — оверлей спрятан (`hide`);
// Esc/Back закрывают только вкладку, оверлей возвращается и перечитывает карточку.
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
    members: [], admins: [], invites: [], revokedInvites: [], bans: [], restricted: [],
    canBan: false, canManageAdmins: true, isCreator: true,
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
/** Клик по строке и ожидание открытой вкладки: модуль вкладки грузится `import()`. */
const openTypeTab = async(overlay: HTMLElement) => {
  await act(async() => { click(typeRow(overlay)) })
  await vi.waitFor(() => {
    if(!column.slider.querySelector(':scope > .group-type-container.active')) throw new Error('вкладка ещё не открыта')
  }, { timeout: 5000 })
  await settle()
}

let column: ReturnType<typeof installSidebarRight>

beforeEach(() => {
  resetPeerMirror()
  applyPeerOps([{ op: 'upsert', peers: [CHANNEL] }])
  reload.mockReset()
  column = installSidebarRight({
    groups: {
      listInvites: vi.fn(async() => [{ token: 'primary', url: '/join/primary', uses: 0, requiresApproval: false, title: '', usageLimit: null, revoked: false }]),
      setType: vi.fn(async() => {}),
    },
  } as unknown as Managers)
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

const typeRow = (overlay: HTMLElement) =>
  [...overlay.querySelectorAll<HTMLElement>('.row')].find((row) => row.textContent?.includes(lang.ChannelType))!

describe('GroupEditFlow → AppChatTypeTab (мост 0б-2)', () => {
  it('строка «Тип канала» открывает Solid-вкладку в слайдере колонки и прячет оверлей', async() => {
    const overlay = renderFlow()
    expect(overlay.classList.contains('hide')).toBe(false)

    await openTypeTab(overlay)

    const tab = column.slider.querySelector<HTMLElement>(':scope > .group-type-container')
    expect(tab).not.toBeNull()
    expect(tab!.classList.contains('active')).toBe(true)
    expect(overlay.classList.contains('hide')).toBe(true)
    // React-экрана типа больше нет — внутри оверлея второй вкладки не появилось
    expect(overlay.querySelectorAll('.sidebar-slider-item')).toHaveLength(1)
  })

  it('Esc закрывает только вкладку: оверлей снова виден и перечитывает карточку', async() => {
    const overlay = renderFlow()
    await openTypeTab(overlay)

    await act(async() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
      await pause(400)
    })

    expect(column.slider.querySelector('.group-type-container')).toBeNull()
    expect(overlay.isConnected).toBe(true)
    expect(overlay.classList.contains('hide')).toBe(false)
    expect(reload).toHaveBeenCalledTimes(1)
  })
})
