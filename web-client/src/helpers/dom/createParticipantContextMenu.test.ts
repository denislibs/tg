// Пины контекстного меню участника (`helpers/dom/createParticipantContextMenu.ts`,
// порт tweb `src/helpers/dom/createParticipantContextMenu.ts:40-138`).
//
// Главный пин: пункт, на который нет прав, СКРЫТ (его нет в DOM меню), а не
// задизейблен — так делает `createContextMenu` через `verify` каждого пункта.
// Эталон — дамп `docs/tweb/dom/dumps/15-right-15-member-context-menu.json`:
// `div.btn-menu.contextmenu` с `div.btn-menu-item.rp-overflow` внутри.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import contextMenuController from '@helpers/contextMenuController'
import { getMiddleware } from '@helpers/middleware'
import { applyPeerOps, resetPeerMirror } from '@core/peerCache'
import type { ChannelParticipantWire } from '@core/managers/groupsManager'
import createParticipantContextMenu from './createParticipantContextMenu'

const CHAT_ID = 100
const CHAT_PEER: PeerId = -CHAT_ID
const MEMBER: PeerId = 7
const ADMIN: PeerId = 8
const CREATOR: PeerId = 9
const BANNED: PeerId = 10

const settle = async () => {
  for(let i = 0; i < 4; ++i) {
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
}

function seedChat(viewer: 'creator' | 'member') {
  applyPeerOps([{ op: 'upsert', peers: [
    {
      _: 'channel', id: CHAT_ID, title: 'Группа', date: 0, photo: { _: 'chatPhotoEmpty' },
      pFlags: viewer === 'creator' ? { megagroup: true, creator: true } : { megagroup: true },
    },
    { _: 'user', id: MEMBER, first_name: 'Участник', pFlags: {} },
    { _: 'user', id: ADMIN, first_name: 'Админ', pFlags: {} },
    { _: 'user', id: CREATOR, first_name: 'Создатель', pFlags: {} },
    { _: 'user', id: BANNED, first_name: 'Выгнанный', pFlags: {} },
  ] }])
}

const participants = new Map<PeerId, ChannelParticipantWire>([
  [MEMBER, { _: 'channelParticipant', user_id: MEMBER, date: 1 }],
  [ADMIN, { _: 'channelParticipantAdmin', user_id: ADMIN, date: 1, admin_rights: { _: 'chatAdminRights' } }],
  [CREATOR, { _: 'channelParticipantCreator', user_id: CREATOR, admin_rights: { _: 'chatAdminRights' } }],
  [BANNED, {
    _: 'channelParticipantBanned', pFlags: { left: true }, peer: { _: 'peerUser', user_id: BANNED },
    kicked_by: CREATOR, date: 1, banned_rights: { until_date: 0 },
  }],
])

function build() {
  const list = document.createElement('ul')
  list.className = 'chatlist'
  for(const peerId of participants.keys()) {
    const row = document.createElement('a')
    row.className = 'row chatlist-chat'
    row.dataset.peerId = String(peerId)
    list.append(row)
  }
  document.body.append(list)

  const groups = {
    addMember: vi.fn(async () => {}),
    removeMember: vi.fn(async () => {}),
    unban: vi.fn(async () => {}),
  }
  const openPeer = vi.fn()
  const openUserPermissions = vi.fn()
  const middlewareHelper = getMiddleware()
  createParticipantContextMenu({
    chatId: CHAT_ID,
    listenTo: list,
    participants,
    middleware: middlewareHelper.get(),
    managers: { groups },
    openPeer,
    openUserPermissions,
  })

  const rowOf = (peerId: PeerId) => list.querySelector<HTMLElement>(`[data-peer-id="${peerId}"]`)!
  const open = async (peerId: PeerId) => {
    rowOf(peerId).dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))
    await settle()
    // закрытое меню живёт в документе ещё 300 мс (`createContextMenu`), поэтому
    // открытое — то, что с `active`
    return document.querySelector<HTMLElement>('.btn-menu.contextmenu.active')
  }
  // подпись пункта — `span.btn-menu-item-text` (дамп 15-right-15), глиф иконки
  // в `textContent` пункта не считаем
  const itemTexts = (menu: HTMLElement | null) =>
    Array.from(menu?.querySelectorAll('.btn-menu-item .btn-menu-item-text') ?? []).map((el) => el.textContent)
  const click = (menu: HTMLElement, text: string) => {
    const item = Array.from(menu.querySelectorAll<HTMLElement>('.btn-menu-item'))
      .find((el) => el.querySelector('.btn-menu-item-text')!.textContent === text)!
    item.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  }

  return { list, groups, openPeer, openUserPermissions, middlewareHelper, rowOf, open, itemTexts, click }
}

beforeEach(() => resetPeerMirror())
afterEach(() => {
  contextMenuController.close()
  document.body.replaceChildren()
})

describe('createParticipantContextMenu: пункты по правам', () => {
  it('создатель на обычном участнике: отправить, назначить админом, ограничить, удалить', async () => {
    seedChat('creator')
    const h = build()
    const menu = await h.open(MEMBER)
    expect(menu).not.toBeNull()
    expect(menu!.querySelectorAll('.btn-menu-item.rp-overflow').length).toBe(4)
    expect(h.itemTexts(menu)).toEqual(['Send Message', 'Promote to admin', 'Restrict user', 'Remove from group'])
    // скрыто, а не задизейблено: ни одного отключённого пункта
    expect(menu!.querySelectorAll('.btn-menu-item.is-disabled, .btn-menu-item[disabled]').length).toBe(0)
    // строка отмечена открытым меню (tweb :137)
    expect(h.rowOf(MEMBER).classList.contains('menu-open')).toBe(true)
  })

  // «Ограничить» показывается только обычному участнику (`verify` :79-83 —
  // конструктор `channelParticipant`), админу — нет.
  it('на админе — «изменить права» вместо «назначить», без «ограничить»; на создателе удалить нельзя', async () => {
    seedChat('creator')
    const h = build()
    expect(h.itemTexts(await h.open(ADMIN))).toEqual(['Send Message', 'Edit admin rights', 'Remove from group'])
    contextMenuController.close()
    await settle()
    expect(h.itemTexts(await h.open(CREATOR))).toEqual(['Send Message', 'Edit admin rights'])
  })

  // Выгнанный — не админ, поэтому «назначить» у него остаётся (`:69`);
  // «удалить из группы» на нём скрыто (`:117` — он уже не в группе).
  it('на выгнанном — «добавить в группу», «назначить» и «удалить» (снять бан)', async () => {
    seedChat('creator')
    const h = build()
    const menu = await h.open(BANNED)
    expect(h.itemTexts(menu)).toEqual(['Send Message', 'Add to Group', 'Promote to admin', 'Delete'])
    h.click(menu!, 'Add to Group')
    expect(h.groups.addMember).toHaveBeenCalledWith(CHAT_PEER, BANNED)
  })

  it('без прав остаётся только «отправить сообщение»', async () => {
    seedChat('member')
    const h = build()
    expect(h.itemTexts(await h.open(MEMBER))).toEqual(['Send Message'])
    contextMenuController.close()
    await settle()
    expect(h.itemTexts(await h.open(ADMIN))).toEqual(['Send Message'])
  })
})

describe('createParticipantContextMenu: действия', () => {
  it('«Send Message» открывает пира; «Promote» и «Restrict» — экран прав с нужным флагом', async () => {
    seedChat('creator')
    const h = build()
    let menu = await h.open(MEMBER)
    h.click(menu!, 'Send Message')
    expect(h.openPeer).toHaveBeenCalledWith(MEMBER)
    await settle()

    menu = await h.open(MEMBER)
    h.click(menu!, 'Promote to admin')
    expect(h.openUserPermissions).toHaveBeenLastCalledWith(participants.get(MEMBER), true)
    await settle()

    menu = await h.open(MEMBER)
    h.click(menu!, 'Restrict user')
    expect(h.openUserPermissions).toHaveBeenLastCalledWith(participants.get(MEMBER), false)
  })

  it('«Remove from group» выгоняет участника; «Delete» на выгнанном снимает бан', async () => {
    seedChat('creator')
    const h = build()
    h.click((await h.open(MEMBER))!, 'Remove from group')
    expect(h.groups.removeMember).toHaveBeenCalledWith(CHAT_PEER, MEMBER)
    await settle()
    h.click((await h.open(BANNED))!, 'Delete')
    expect(h.groups.unban).toHaveBeenCalledWith(CHAT_PEER, BANNED)
  })

  it('закрытие снимает `menu-open`; destroy по middleware убирает меню', async () => {
    seedChat('creator')
    const h = build()
    const menu = await h.open(MEMBER)
    expect(menu).not.toBeNull()
    contextMenuController.close()
    expect(h.rowOf(MEMBER).classList.contains('menu-open')).toBe(false)
    h.middlewareHelper.destroy()
    await settle()
    expect(await h.open(MEMBER)).toBeNull()
  })
})
