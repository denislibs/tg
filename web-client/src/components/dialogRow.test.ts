// Пины СТРОКИ ЧАТЛИСТА (`components/dialogRow.ts`, порт `DialogElement` /
// `addDialogNew` / `createChatList` из tweb `src/lib/appDialogsManager.ts`).
//
// Эталон — живой дамп Telegram `docs/tweb/dom/dumps/15-right-14-group-members.json`
// (строка участника с полной глубиной) и `15-right-11-group-profile.json`
// (тот же `a.chatlist-chat` во вкладке «Участники» shared media: без `rp` —
// список создаётся с `rippleEnabled: false`, `appSearchSuper.ts:1548`).
// Дампы сняты со СТАРОЙ базы tweb (императивный `row.ts`: подпись, заголовок,
// аватар). Строка HEAD 812502980 — Solid `Row` через `attachRowController`
// (`appDialogsManager.ts:321`), и порядок детей задаёт уже он
// (`rowTsx.tsx:247-257`): заголовок, подпись, аватар; `no-wrap` у `Row` ставится
// на обе части строки заголовка (`RowPart`). Классы и вложенность — как в дампах.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getMiddleware } from '@helpers/middleware'
import rootScope from '@lib/rootScope'
import { applyPeerOps, resetPeerMirror } from '@core/peerCache'
import { makeMessage } from '@core/messages/testMessage'
import { saveDocument, THUMB_TYPE_FULL, type MessageMedia } from '@core/media/messageMedia'
import { useNavigationStore } from '@stores/navigationStore'
import { useSearchStore } from '@stores/searchStore'
import { useChatsStore } from '@stores/chatsStore'
import { addDialogNew, createChatList, DIALOG_LIST_ELEMENT_TAG, setLastMessageN, setListClickListener } from './dialogRow'

// Превью медиа в подписи строит `wrapPhoto` (сеть/кэш медиа) — здесь важна
// РАЗМЕТКА вокруг него (tweb `appDialogsManager.ts:2104-2146`), а не загрузка.
vi.mock('@components/wrappers/photo', () => ({
  default: async ({ container }: { container: HTMLElement }) => {
    const img = document.createElement('img')
    img.className = 'media-photo'
    container.append(img)
    return { loadPromises: { thumb: Promise.resolve(), full: Promise.resolve() }, images: { thumb: null, full: img }, preloader: null, aspecter: container }
  },
}))

const ALICE: PeerId = 7
const ME: PeerId = 1
/** супергруппа: ключ пира ОТРИЦАТЕЛЬНЫЙ (`peerKey`), диалог ей не нужен для открытия */
const GROUP: PeerId = -100

const managers = { peers: { fillMirror: async () => {} }, presence: { get: async () => [] } }

beforeEach(() => {
  resetPeerMirror()
  applyPeerOps([{ op: 'upsert', peers: [
    { _: 'user', id: ALICE, first_name: 'Алиса', last_name: 'Иванова', pFlags: {} },
    { _: 'channel', id: 100, title: 'Группа', photo: { _: 'chatPhotoEmpty' }, date: 0, pFlags: { megagroup: true } },
  ] }])
  useChatsStore.setState({ meId: ME })
  useNavigationStore.setState({ selectedId: null, draftPeer: null })
  useSearchStore.setState({ pendingJump: null })
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

    // HEAD `rowTsx.tsx:247-257`: заголовок → подпись → медиа (см. шапку файла)
    const [titleRow, subtitleRow, avatar] = Array.from(li.children) as HTMLElement[]
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
    expect(peerTitle.textContent).toBe('Алиса Иванова')
    for(const cls of ['row-title', 'row-title-right', 'row-title-right-secondary', 'no-wrap', 'dialog-title-details']) {
      expect(titleRight.classList.contains(cls), cls).toBe(true)
    }
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
    // части строки — геттеры контроллера на ПРОТОТИПЕ (`rowTsxController.tsx:361-388`),
    // своих полей у экземпляра нет
    expect(Object.prototype.hasOwnProperty.call(dialogElement, 'container')).toBe(false)
    expect(dialogElement.title).toBe(title)
    expect(dialogElement.media).toBe(avatar)
  })

  it('строка — Solid `Row`: снятие middleware разбирает её корень (`rowTsxController.tsx:338-346`)', () => {
    const helper = getMiddleware()
    const dialogElement = addDialogNew({
      peerId: ALICE,
      container: false,
      avatarSize: 'abitbigger',
      autonomous: true,
      wrapOptions: { middleware: helper.get() },
      managers,
    })
    const media = document.createElement('div')
    dialogElement.applyMediaElement(media)
    expect(media.parentElement).toBe(dialogElement.container)

    // tweb: `this.middlewareHelper = wrapOptions.middleware.create()` — дочерняя
    // зона строки гаснет вместе с родительской, а с ней и Solid-корень
    helper.destroy()
    const late = document.createElement('div')
    dialogElement.applyMediaElement(late)
    expect(late.parentElement).toBeNull()
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

// tweb `appDialogsManager.ts:1751-1949` — клик по строке. Строка находится по
// тегу `a` (`findUpTag`), открытие — `appImManager.setPeer({peerId, lastMsgId})`,
// у нас `core/navigation/openPeer.ts` + `searchStore.setPendingJump` для
// строки-сообщения (`data-mid`).
describe('dialogRow: setListClickListener', () => {
  const makeRow = (list: HTMLElement, peerId: PeerId) => addDialogNew({
    peerId,
    container: list,
    avatarSize: 'abitbigger',
    wrapOptions: { middleware: getMiddleware().get() },
    managers,
  })

  const mousedown = (target: Element, init: MouseEventInit = {}) =>
    target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0, ...init }))

  it('mousedown по потомку строки открывает пира и зовёт onFound со строкой', () => {
    const list = createChatList()
    document.body.append(list)
    const row = makeRow(list, GROUP)
    const onFound = vi.fn()
    setListClickListener({ list, onFound, autonomous: true, managers })

    mousedown(row.dom.titleSpan)

    expect(onFound).toHaveBeenCalledWith(row.container)
    expect(useNavigationStore.getState().selectedId).toBe(String(GROUP))
    expect(list.dataset.autonomous).toBe('1')
  })

  it('строка-сообщение (`data-mid`) ставит прыжок к нему до открытия чата', () => {
    const list = createChatList()
    document.body.append(list)
    const row = makeRow(list, GROUP)
    row.container.dataset.mid = '42'
    setListClickListener({ list, managers })

    mousedown(row.container)

    expect(useSearchStore.getState().pendingJump).toEqual({ peerId: GROUP, seq: 42 })
    expect(useNavigationStore.getState().selectedId).toBe(String(GROUP))
  })

  it('onFound вернул false — открытия нет; правая кнопка — тоже', () => {
    const list = createChatList()
    document.body.append(list)
    const row = makeRow(list, GROUP)
    setListClickListener({ list, onFound: () => false, managers })

    mousedown(row.container)
    mousedown(row.container, { button: 2 })

    expect(useNavigationStore.getState().selectedId).toBeNull()
  })

  it('автономный список переносит `active` на последнюю нажатую строку', () => {
    const list = createChatList()
    document.body.append(list)
    const a = makeRow(list, GROUP)
    const b = makeRow(list, ALICE)
    setListClickListener({ list, autonomous: true, managers })

    mousedown(a.container)
    expect(a.container.classList.contains('active')).toBe(true)
    mousedown(b.container)
    expect(a.container.classList.contains('active')).toBe(false)
    expect(b.container.classList.contains('active')).toBe(true)
  })

  it('click по строке гасится (переход по ссылке-строке не нужен, tweb :1927-1937)', () => {
    const list = createChatList()
    document.body.append(list)
    const row = makeRow(list, GROUP)
    setListClickListener({ list, managers })

    const click = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 })
    row.container.dispatchEvent(click)
    expect(click.defaultPrevented).toBe(true)
  })
})

// tweb `appDialogsManager.ts:2020-2244` в объёме поиска (`setUnread` не
// передан → `isSearch`, диалога нет — только найденное сообщение).
describe('dialogRow: setLastMessageN — превью найденного сообщения', () => {
  const row = (peerId: PeerId) => {
    const d = addDialogNew({
      peerId,
      container: false,
      wrapOptions: { middleware: getMiddleware().get() },
      managers,
    })
    document.body.append(d.container)
    return d
  }

  it('подсветка запроса, время справа и `data-mid` для прыжка', async () => {
    const d = row(ALICE)
    const message = makeMessage({ id: 42, peerId: ALICE, fromId: ALICE, text: 'Привет, мир!', createdAt: '2026-01-05T12:00:00Z' })

    await setLastMessageN({ dialog: { peerId: ALICE }, lastMessage: message, dialogElement: d, highlightWord: 'мир' })

    const span = d.dom.lastMessageSpan
    // дамп 14-left-03b: `div.row-subtitle.no-wrap.dialog-subtitle-flex > span.dialog-subtitle-span…-last > i.text-highlight`
    expect(span.classList.contains('dialog-subtitle-flex')).toBe(true)
    const parts = Array.from(span.children) as HTMLElement[]
    expect(parts).toHaveLength(1)
    expect(parts[0].className).toBe('dialog-subtitle-span dialog-subtitle-span-overflow dialog-subtitle-span-last')
    expect(parts[0].dir).toBe('auto')
    expect(parts[0].querySelector('i.text-highlight')?.textContent).toBe('мир')
    expect(span.textContent).toBe('Привет, мир!')

    expect(d.dom.lastTimeSpan.textContent).not.toBe('')
    expect(d.dom.listEl.dataset.mid).toBe('42')
  })

  it('в группе чужое сообщение подписано именем автора, своё — «You»', async () => {
    const d = row(GROUP)
    await setLastMessageN({
      dialog: { peerId: GROUP },
      lastMessage: makeMessage({ id: 1, peerId: GROUP, fromId: ALICE, text: 'текст' }),
      dialogElement: d,
    })
    const [sender, text] = Array.from(d.dom.lastMessageSpan.children) as HTMLElement[]
    // `span.primary-text` с `onlyFirstName` (tweb :2159-2177)
    expect(sender.querySelector('.primary-text')?.textContent).toBe('Алиса: ')
    expect(text.textContent).toBe('текст')

    const mine = row(GROUP)
    await setLastMessageN({
      dialog: { peerId: GROUP },
      lastMessage: makeMessage({ id: 2, peerId: GROUP, fromId: ME, text: 'моё' }),
      dialogElement: mine,
    })
    expect(mine.dom.lastMessageSpan.querySelector('.primary-text')?.textContent).toBe('You: ')
  })

  it('пересланное — иконка forward_filled первой частью (tweb :2087-2099)', async () => {
    const d = row(ALICE)
    const message = { ...makeMessage({ id: 3, peerId: ALICE, fromId: ALICE, text: 'x' }), fwd_from: { _: 'messageFwdHeader' as const, date: 0 } }
    await setLastMessageN({ dialog: { peerId: ALICE }, lastMessage: message, dialogElement: d })
    const icon = d.dom.lastMessageSpan.firstElementChild!.firstElementChild as HTMLElement
    expect(icon.className).toBe('tgico dialog-subtitle-ico dialog-subtitle-ico-forward_filled')
  })

  it('видео с подписью: миниатюра с play-иконкой вместо лейбла «Video» (tweb :2101-2146, :2179)', async () => {
    const d = row(ALICE)
    const video: MessageMedia = {
      _: 'messageMediaDocument',
      document: saveDocument({
        _: 'document', id: 9, mime_type: 'video/mp4', size: 10,
        attributes: [{ _: 'documentAttributeVideo', duration: 5, w: 40, h: 30 }],
        thumbs: [{ _: 'photoSize', type: THUMB_TYPE_FULL, w: 40, h: 30, size: 1 }],
      }),
    }
    const message = makeMessage({ id: 4, peerId: ALICE, fromId: ALICE, text: 'подпись', media: video })
    await setLastMessageN({ dialog: { peerId: ALICE }, lastMessage: message, dialogElement: d })

    const media = d.dom.lastMessageSpan.querySelector('.dialog-subtitle-media')!
    expect(media).not.toBeNull()
    expect(media.querySelector('.tgico.dialog-subtitle-media-play')).not.toBeNull()
    expect(d.dom.lastMessageSpan.textContent).not.toContain('Video')
    expect(d.dom.lastMessageSpan.lastElementChild!.textContent).toBe('подпись')
  })
})

// `meAsSaved = true` по умолчанию (tweb appDialogsManager.ts:301): строка
// своего пира в выдаче поиска/Recent — «Избранное» с иконкой закладки, а не
// имя и фото зрителя. Список участников передаёт `false` (sortedUserList.ts:80).
describe('dialogRow: свой пир', () => {
  const row = (meAsSaved?: boolean) => {
    rootScope.myId = ME
    applyPeerOps([{ op: 'upsert', peers: [{ _: 'user', id: ME, first_name: 'Я', pFlags: { self: true } }] }])
    const dialogElement = addDialogNew({
      peerId: ME, container: false, autonomous: true,
      wrapOptions: { middleware: getMiddleware().get() }, managers,
      ...(meAsSaved === undefined ? {} : { meAsSaved }),
    })
    document.body.append(dialogElement.container)
    return dialogElement.container
  }

  it('по умолчанию — «Saved Messages» с иконкой saved_filled', () => {
    const li = row()
    expect(li.querySelector('.peer-title')!.textContent).toBe('Saved Messages')
    expect(li.querySelector('.avatar .avatar-icon-saved_filled')).not.toBeNull()
  })

  it('meAsSaved: false — сам зритель', () => {
    const li = row(false)
    expect(li.querySelector('.peer-title')!.textContent).toBe('Я')
    expect(li.querySelector('.avatar-icon-saved_filled')).toBeNull()
  })
})
