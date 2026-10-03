/** @jsxImportSource solid-js */
// Попап «Добавить папку» по ссылке (порт tweb `popups/sharedFolderInvite.tsx`):
// настоящий `AppSelectPeers` и оболочка попапа, стабы — менеджеры воркера.
// Предмет: все чаты приглашения выбраны сразу, счётчик в заголовке секции и бейдж
// кнопки, «снять/выбрать всё», вступление — ОДИН вызов с выбранными пирами и
// перечитывание папок; пустой выбор гасит кнопку.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Managers } from '@/client/bootstrap'
import type { Chat } from '@core/peers/peer'
import { resetPeerMirror } from '@core/peerCache'
import { useSettingsStore } from '@/settings'
import showSharedFolderInvitePopup from './sharedFolderInvite.solid'

const loadFolders = vi.hoisted(() => vi.fn(async() => {}))
vi.mock('@stores/foldersStore', () => ({ loadFolders }))

const PEERS = new Map<PeerId, Chat>([
  [-20, { _: 'channel', id: 20, title: 'Public Channel', username: 'pubch', participants_count: 9, date: 0, pFlags: { broadcast: true } } as unknown as Chat],
  [-30, { _: 'channel', id: 30, title: 'Public Group', username: 'pubgr', participants_count: 5, date: 0, pFlags: { megagroup: true } } as unknown as Chat],
])

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const settle = async() => {
  for(let i = 0; i < 12; ++i) await pause(0)
}

let managers: Managers
let joinInvite: ReturnType<typeof vi.fn>
let refresh: ReturnType<typeof vi.fn>

beforeEach(() => {
  resetPeerMirror()
  useSettingsStore.setState({ liteMode: { ...useSettingsStore.getState().liteMode, all: true } })
  joinInvite = vi.fn(async() => {})
  refresh = vi.fn(async() => null)
  managers = {
    folders: { joinInvite },
    dialogs: { refresh, getDialogs: vi.fn(async() => ({ dialogs: [], count: 0, isEnd: true })) },
    contacts: { getContactsPeerIds: vi.fn(async() => []), testSelfSearch: vi.fn(async() => false) },
    channels: { search: vi.fn() },
    peers: {
      getPeers: vi.fn(async(ids: PeerId[]) => ids.map((id) => PEERS.get(id)).filter(Boolean)),
      fillMirror: vi.fn(async() => {}),
    },
  } as unknown as Managers
})

afterEach(async() => {
  document.querySelectorAll('.popup').forEach((el) => el.remove())
  await pause(0)
})

const open = async() => {
  showSharedFolderInvitePopup({
    chatlistInvite: {
      title: 'Work',
      chats: [
        { peer_id: -20, title: 'Public Channel', type: 'channel', members: 9 },
        { peer_id: -30, title: 'Public Group', type: 'group', members: 5 },
      ],
    },
    slug: 'abc',
    managers,
  })
  await settle()
  return document.querySelector<HTMLElement>('.popup-chatlist-invite')!
}

const click = (el: Element) => el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))

describe('попап «Добавить папку»', () => {
  it('разметка tweb: ряд папок с активной, описание, все чаты выбраны, счётчик и бейдж', async() => {
    const popup = await open()
    expect(popup.classList.contains('popup-forward')).toBe(true)
    expect(popup.querySelector('.popup-title')!.textContent).toBe('Add Folder')
    expect(popup.querySelector('.menu-horizontal-div-item.active')!.textContent).toBe('Work')
    expect(popup.querySelector('.popup-chatlist-invite-description')!.textContent)
      .toBe('Do you want to add a new chat folder and join its groups and channels?')

    const rows = [...popup.querySelectorAll<HTMLElement>('ul.chatlist > a.row')]
    expect(rows.map((row) => row.dataset.peerId)).toEqual(['-20', '-30'])
    expect(rows.every((row) => row.querySelector<HTMLInputElement>('input')!.checked)).toBe(true)

    expect(popup.querySelector('.sidebar-left-section-name')!.textContent).toContain('2 chats in folder to join')
    expect(popup.querySelector('.sidebar-left-section-name-right')!.textContent).toBe('deselect all')
    const buttonText = popup.querySelector<HTMLElement>('.popup-chatlist-invite-button-text')!
    expect(buttonText.dataset.badge).toBe('2')
    expect(buttonText.classList.contains('has-badge')).toBe(true)
  })

  it('«снять всё» гасит кнопку, «выбрать всё» возвращает выбор', async() => {
    const popup = await open()
    const toggle = popup.querySelector<HTMLElement>('.sidebar-left-section-name-right')!
    click(toggle)
    await settle()
    expect(toggle.textContent).toBe('select all')
    expect(popup.querySelector<HTMLButtonElement>('.popup-footer-button')!.disabled).toBe(true)
    expect(popup.querySelector('.popup-chatlist-invite-button-text')!.classList.contains('has-badge')).toBe(false)

    click(toggle)
    await settle()
    expect(toggle.textContent).toBe('deselect all')
    expect(popup.querySelector<HTMLButtonElement>('.popup-footer-button')!.disabled).toBe(false)
  })

  it('кнопка вступает ОДНИМ вызовом с выбранными пирами и перечитывает папки', async() => {
    const popup = await open()
    click(popup.querySelector('ul.chatlist > a.row[data-peer-id="-30"]')!)
    await settle()
    click(popup.querySelector('.popup-footer-button')!)
    await settle()
    expect(joinInvite).toHaveBeenCalledTimes(1)
    expect(joinInvite).toHaveBeenCalledWith('abc', [-20])
    expect(refresh).toHaveBeenCalled()
    expect(loadFolders).toHaveBeenCalledWith(managers, { overwrite: true })
  })
})
