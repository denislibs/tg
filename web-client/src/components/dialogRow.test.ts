// Пины СТРОКИ ЧАТЛИСТА (`components/dialogRow.ts`, порт `DialogElement` /
// `addDialogNew` / `createChatList` из tweb `src/lib/appDialogsManager.ts`).
//
// Эталон — живой дамп Telegram `docs/tweb/dom/dumps/15-right-14-group-members.json`
// (строка участника с полной глубиной) и `15-right-11-group-profile.json`
// (тот же `a.chatlist-chat` во вкладке «Участники» shared media: без `rp` —
// список создаётся с `rippleEnabled: false`, `appSearchSuper.ts:1548`).
// Порядок детей — как в оригинале: подпись, заголовок, аватар.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { getMiddleware } from '@helpers/middleware'
import { applyPeerOps, resetPeerMirror } from '@core/peerCache'
import { addDialogNew, createChatList, DIALOG_LIST_ELEMENT_TAG } from './dialogRow'

const ALICE: PeerId = 7

const managers = { peers: { fillMirror: async () => {} } }

beforeEach(() => {
  resetPeerMirror()
  applyPeerOps([{ op: 'upsert', peers: [{ _: 'user', id: ALICE, first_name: 'Алиса', pFlags: {} }] }])
})
afterEach(() => document.body.replaceChildren())

describe('dialogRow: разметка строки участника', () => {
  it('createChatList отдаёт ul.chatlist (дамп 15-right-14: `ul.chatlist`)', () => {
    const list = createChatList()
    expect(list.tagName).toBe('UL')
    expect(list.className).toBe('chatlist')
  })

  it('a.row … chatlist-chat-abitbigger с подписью, заголовком и аватаром в порядке дампа', () => {
    const middleware = getMiddleware().get()
    const dialogElement = addDialogNew({
      peerId: ALICE,
      container: false,
      avatarSize: 'abitbigger',
      autonomous: true,
      rippleEnabled: false,
      wrapOptions: { middleware },
      managers,
    })
    const li = dialogElement.container
    document.body.append(li)

    // `a` — `DIALOG_LIST_ELEMENT_TAG`, по нему клик находит строку (`findUpTag`).
    expect(li.tagName).toBe(DIALOG_LIST_ELEMENT_TAG)
    expect(li.dataset.peerId).toBe(String(ALICE))
    // дамп 15-right-11: `a.row.no-wrap.row-with-padding.row-clickable.hover-effect.chatlist-chat.chatlist-chat-abitbigger`
    for(const cls of ['row', 'no-wrap', 'row-with-padding', 'row-clickable', 'hover-effect', 'chatlist-chat', 'chatlist-chat-abitbigger']) {
      expect(li.classList.contains(cls), cls).toBe(true)
    }
    expect(li.classList.contains('no-subtitle')).toBe(false)
    // без ripple: ни `rp`, ни `.c-ripple` (15-right-11; в 15-right-14 они есть,
    // потому что тот список создан с ripple)
    expect(li.classList.contains('rp')).toBe(false)
    expect(li.querySelector('.c-ripple')).toBeNull()
    // автономная строка не получает `href`
    expect((li as HTMLAnchorElement).getAttribute('href')).toBeNull()

    const [subtitleRow, titleRow, avatar] = Array.from(li.children) as HTMLElement[]
    expect(li.children.length).toBe(3)

    // 15-right-14: `div.row-row.row-subtitle-row.dialog-subtitle.has-multiple-badges > div.row-subtitle.no-wrap`
    expect(subtitleRow.className).toBe('row-row row-subtitle-row dialog-subtitle has-multiple-badges')
    expect(subtitleRow.children.length).toBe(1)
    expect(subtitleRow.firstElementChild!.classList.contains('row-subtitle')).toBe(true)
    expect(subtitleRow.firstElementChild!.classList.contains('no-wrap')).toBe(true)
    expect(subtitleRow.querySelector('.row-subtitle-right')).toBeNull()

    // 15-right-14: `div.row-row.row-title-row.dialog-title` > `div.row-title.no-wrap.user-title > span.peer-title`
    //   + `div.row-title.row-title-right.row-title-right-secondary.dialog-title-details > span.message-status.sending-status, span.message-time`
    expect(titleRow.className).toBe('row-row row-title-row dialog-title')
    const [title, titleRight] = Array.from(titleRow.children) as HTMLElement[]
    for(const cls of ['row-title', 'no-wrap', 'user-title']) expect(title.classList.contains(cls), cls).toBe(true)
    const peerTitle = title.firstElementChild as HTMLElement
    expect(peerTitle.tagName).toBe('SPAN')
    expect(peerTitle.classList.contains('peer-title')).toBe(true)
    expect(peerTitle.dataset.peerId).toBe(String(ALICE))
    expect(peerTitle.textContent).toBe('Алиса')
    expect(titleRight.className).toBe('row-title row-title-right row-title-right-secondary dialog-title-details')
    expect(Array.from(titleRight.children).map((c) => c.className)).toEqual(['message-status sending-status', 'message-time'])

    // 15-right-14: `div.avatar.avatar-like.avatar-42.avatar-gradient.dialog-avatar.row-media.row-media-abitbigger[data-peer-id]`
    expect(avatar.classList.contains('avatar')).toBe(true)
    expect(avatar.classList.contains('avatar-42')).toBe(true)
    for(const cls of ['dialog-avatar', 'row-media', 'row-media-abitbigger']) expect(avatar.classList.contains(cls), cls).toBe(true)
    expect(avatar.dataset.peerId).toBe(String(ALICE))

    // dom-словарь оригинала указывает на те же узлы
    expect(dialogElement.dom.listEl).toBe(li)
    expect(dialogElement.dom.lastMessageSpan).toBe(subtitleRow.firstElementChild)
    expect(dialogElement.titleRight).toBe(titleRight)
  })

  it('с ripple строка получает `rp` и `.c-ripple` (дамп 15-right-14)', () => {
    const dialogElement = addDialogNew({
      peerId: ALICE,
      container: false,
      avatarSize: 'abitbigger',
      autonomous: true,
      wrapOptions: { middleware: getMiddleware().get() },
      managers,
    })
    expect(dialogElement.container.classList.contains('rp')).toBe(true)
    expect(dialogElement.container.querySelector('.c-ripple')).not.toBeNull()
  })

  it('container вставляет строку в список; remove() снимает её', () => {
    const list = createChatList()
    document.body.append(list)
    const dialogElement = addDialogNew({
      peerId: ALICE,
      container: list,
      avatarSize: 'abitbigger',
      wrapOptions: { middleware: getMiddleware().get() },
      managers,
    })
    expect(list.firstElementChild).toBe(dialogElement.container)
    dialogElement.remove()
    expect(list.childElementCount).toBe(0)
  })
})
