// Пины СТРОКИ ЧАТЛИСТА (`lib/appDialogsManager.ts`, раздел «СТРОКА ДИАЛОГА»:
// порт `DialogElement` / `addDialogNew` / `createChatList` / `setLastMessage` /
// `setUnreadMessages` из tweb `src/lib/appDialogsManager.ts`, 812502980).
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
import appImManager from '@lib/appImManager'
import { useChatsStore } from '@stores/chatsStore'
import { makeDialog } from '@core/dialogs/testDialog'
import { ALL_FOLDER_ID, ARCHIVE_FOLDER_ID } from '@core/folderIds'
import type { Dialog } from '@core/models'
import { useNotifyStore } from '@stores/notifyStore'
import appDialogsManager, {
  addDialogNew,
  createChatList,
  DIALOG_LIST_ELEMENT_TAG,
  getDialog,
  initDialog,
  setLastMessageN,
  type DialogListContext,
} from './appDialogsManager'

// Превью медиа в подписи строит `wrapPhoto` (сеть/кэш медиа) — здесь важна
// РАЗМЕТКА вокруг него (tweb `appDialogsManager.ts:2584-2632`), а не загрузка.
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
let setPeer: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  resetPeerMirror()
  applyPeerOps([{ op: 'upsert', peers: [
    { _: 'user', id: ALICE, first_name: 'Алиса', last_name: 'Иванова', pFlags: {} },
    { _: 'channel', id: 100, title: 'Группа', photo: { _: 'chatPhotoEmpty' }, date: 0, pFlags: { megagroup: true } },
  ] }])
  useChatsStore.setState({ meId: ME })
  // зеркало `meId` (`chatsStore.setMe` пишет оба) — его читает подзаголовок («Вы»)
  rootScope.myId = ME
  setPeer = vi.spyOn(appImManager, 'setPeer').mockResolvedValue(undefined)
})
afterEach(() => {
  document.body.replaceChildren()
  vi.restoreAllMocks()
})

describe('DialogElement: разметка строки участника', () => {
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

// tweb `appDialogsManager.ts:2072-2346` — клик по строке. Строка находится по
// тегу `a` (`findUpTag`), открытие — `appImManager.setInnerPeer({peerId, lastMsgId})`
// (прыжок к `lastMsgId` ставит инстанс чата).
describe('setListClickListener', () => {
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
    appDialogsManager.setListClickListener({ list, onFound, autonomous: true })

    mousedown(row.dom.titleSpan)

    expect(onFound).toHaveBeenCalledWith(row.container)
    expect(setPeer).toHaveBeenCalledWith({ peerId: GROUP, lastMsgId: undefined })
    expect(list.dataset.autonomous).toBe('1')
  })

  it('строка-сообщение (`data-mid`) открывает чат на этом сообщении', () => {
    const list = createChatList()
    document.body.append(list)
    const row = makeRow(list, GROUP)
    row.container.dataset.mid = '42'
    appDialogsManager.setListClickListener({ list })

    mousedown(row.container)

    expect(setPeer).toHaveBeenCalledWith({ peerId: GROUP, lastMsgId: 42 })
  })

  it('onFound вернул false — открытия нет; правая кнопка — тоже', () => {
    const list = createChatList()
    document.body.append(list)
    const row = makeRow(list, GROUP)
    appDialogsManager.setListClickListener({ list, onFound: () => false })

    mousedown(row.container)
    mousedown(row.container, { button: 2 })

    expect(setPeer).not.toHaveBeenCalled()
  })

  it('автономный список переносит `active` на последнюю нажатую строку', () => {
    const list = createChatList()
    document.body.append(list)
    const a = makeRow(list, GROUP)
    const b = makeRow(list, ALICE)
    appDialogsManager.setListClickListener({ list, autonomous: true })

    mousedown(a.container)
    expect(a.container.classList.contains('active')).toBe(true)
    mousedown(b.container)
    expect(a.container.classList.contains('active')).toBe(false)
    expect(b.container.classList.contains('active')).toBe(true)
  })

  // tweb `:2307-2311`: Ctrl/⌘ — чат в новой вкладке браузера (`openDialogInNewTab`,
  // маршрут `#/im?p=`), текущая вкладка пира не меняет
  it.each(['ctrlKey', 'metaKey'] as const)('%s-клик открывает новую вкладку и не трогает текущую', (key) => {
    const list = createChatList()
    document.body.append(list)
    const row = makeRow(list, GROUP)
    row.container.dataset.mid = '' + (0xFFFFFFFF + 42)
    const open = vi.spyOn(window, 'open').mockImplementation(() => null)
    appDialogsManager.setListClickListener({ list, autonomous: true })

    const e = new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0, [key]: true })
    row.container.dispatchEvent(e)

    expect(open).toHaveBeenCalledWith(`#/im?p=${GROUP}&message=42`, '_blank')
    expect(setPeer).not.toHaveBeenCalled()
    expect(e.defaultPrevented).toBe(true)
    // и подсветка текущей вкладки не переезжает
    expect(row.container.classList.contains('active')).toBe(false)
    open.mockRestore()
  })

  // tweb `:2299-2303`: строка форума (`.is-forum` на аватаре) чат не открывает —
  // её открывает форум-таб (задача 1-6)
  it('строка форума чат не открывает', () => {
    const list = createChatList()
    document.body.append(list)
    const row = makeRow(list, GROUP)
    row.dom.avatarEl!.node.classList.add('is-forum')
    appDialogsManager.setListClickListener({ list })

    mousedown(row.container)

    expect(setPeer).not.toHaveBeenCalled()
  })

  it('click по строке гасится (переход по ссылке-строке не нужен, tweb :2307-2325)', () => {
    const list = createChatList()
    document.body.append(list)
    const row = makeRow(list, GROUP)
    appDialogsManager.setListClickListener({ list })

    const click = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 })
    row.container.dispatchEvent(click)
    expect(click.defaultPrevented).toBe(true)
  })
})

// tweb `appDialogsManager.ts:2485-2676` в объёме поиска (`setUnread` не
// передан → `isSearch`, диалога нет — только найденное сообщение).
describe('setLastMessageN — превью найденного сообщения', () => {
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
    // tweb HEAD (3f974c341): `div.row-subtitle.no-wrap.dialog-subtitle-parts > span.dialog-subtitle-span.dialog-subtitle-span-last[dir=auto]`
    // (дамп 14-left-03b снят до него — там `-flex`/`-overflow`)
    expect(span.classList.contains('dialog-subtitle-parts')).toBe(true)
    const parts = Array.from(span.children) as HTMLElement[]
    expect(parts).toHaveLength(1)
    expect(parts[0].className).toBe('dialog-subtitle-span dialog-subtitle-span-last')
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
    // `span.primary-text` с `onlyFirstName` (tweb `dialogSubtitle.ts:84-116`)
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

  it('пересланное — иконка forward_filled первой частью (tweb `dialogSubtitle.ts:47-61`)', async () => {
    const d = row(ALICE)
    const message = { ...makeMessage({ id: 3, peerId: ALICE, fromId: ALICE, text: 'x' }), fwd_from: { _: 'messageFwdHeader' as const, date: 0 } }
    await setLastMessageN({ dialog: { peerId: ALICE }, lastMessage: message, dialogElement: d })
    const icon = d.dom.lastMessageSpan.firstElementChild!.firstElementChild as HTMLElement
    expect(icon.className).toBe('tgico dialog-subtitle-ico dialog-subtitle-ico-forward_filled')
  })

  it('видео с подписью: миниатюра с play-иконкой вместо лейбла «Video» (tweb :2584-2632, :2634)', async () => {
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
describe('DialogElement: свой пир', () => {
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

// ── Строка списка: бейджи, мьют, закреп (tweb `:586-718`, `:2682-2823`) ─────
// Порядок `setLastMessage` → `setUnreadMessages` — оригинала: бейджи ставятся
// после того, как отрисован подзаголовок (`await setLastMessagePromise`).
describe('setLastMessage + setUnreadMessages — строка списка', () => {
  const listRow = (peerId: PeerId) => {
    const d = addDialogNew({
      peerId,
      container: false,
      isMainList: true,
      wrapOptions: { middleware: getMiddleware().get() },
      managers,
    })
    document.body.append(d.container)
    return d
  }
  /** `setUnreadMessages` доходит до бейджей после `await` подзаголовка */
  const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0))
  const message = (f: Partial<Parameters<typeof makeMessage>[0]> = {}) =>
    makeMessage({ id: 10, peerId: ALICE, fromId: ALICE, text: 'привет', date: 1_700_000_000, ...f })
  const fill = async(d: ReturnType<typeof listRow>, dialog: Dialog, list?: DialogListContext) => {
    await setLastMessageN({ dialog, dialogElement: d, setUnread: true, isBatch: true, list })
    await settle()
  }
  const badges = (d: ReturnType<typeof listRow>) =>
    (Array.from(d.dom.subtitleEl.children) as HTMLElement[]).filter((el) => el.classList.contains('dialog-subtitle-badge'))

  afterEach(() => useNotifyStore.setState({ settings: useNotifyStore.getInitialState().settings }))

  it('(а) непрочитанное — `.dialog-subtitle-badge-unread` с числом, видимый (`is-visible`)', async () => {
    const d = listRow(ALICE)
    await fill(d, makeDialog({ peerId: ALICE, unread: 5, lastMessage: message() }))

    const unread = d.dom.subtitleEl.querySelector<HTMLElement>('.dialog-subtitle-badge-unread')!
    expect(unread).not.toBeNull()
    expect(unread.textContent).toBe('5')
    for(const cls of ['dialog-subtitle-badge', 'badge', 'badge-22', 'unread', 'is-visible']) {
      expect(unread.classList.contains(cls), cls).toBe(true)
    }
    expect(unread.classList.contains('mention')).toBe(false)
    expect(d.dom.lastMessageSpan.textContent).toBe('привет')
  })

  it('(а) mute — `is-muted` на строке и иконка у имени; снятие мьюта убирает обе', async () => {
    const d = listRow(ALICE)
    await fill(d, makeDialog({ peerId: ALICE, unread: 2, muteUntil: true, lastMessage: message() }))
    expect(d.dom.listEl.classList.contains('is-muted')).toBe(true)
    expect(d.dom.titleSpanContainer.querySelector('.dialog-muted-icon')).not.toBeNull()

    await fill(d, makeDialog({ peerId: ALICE, unread: 2, lastMessage: message() }))
    expect(d.dom.listEl.classList.contains('is-muted')).toBe(false)
    expect(d.dom.titleSpanContainer.querySelector('.dialog-muted-icon')).toBeNull()
  })

  it('(а) mute по ТИПУ чатов (`isDialogMuted` — правило одно на приложение)', async () => {
    useNotifyStore.setState({ settings: { ...useNotifyStore.getState().settings, private: { ...useNotifyStore.getState().settings.private, muted: true } } })
    const d = listRow(ALICE)
    await fill(d, makeDialog({ peerId: ALICE, lastMessage: message() }))
    expect(d.dom.listEl.classList.contains('is-muted')).toBe(true)
  })

  it('(б) закреп — `.dialog-subtitle-badge-pinned`, `is-pinned`, ручка; один закреп — `has-only-pinned-badge`', async () => {
    const d = listRow(ALICE)
    await fill(d, makeDialog({ peerId: ALICE, pinned: true, lastMessage: message() }))

    const pinned = d.dom.subtitleEl.querySelector('.dialog-subtitle-badge-pinned')!
    expect(pinned.className).toContain('badge-icon')
    expect(pinned.classList.contains('is-visible')).toBe(true)
    expect(d.dom.listEl.classList.contains('is-pinned')).toBe(true)
    expect(d.dom.listEl.querySelector(':scope > .row-sortable-icon')).not.toBeNull()
    expect(d.subtitleRow.classList.contains('has-only-pinned-badge')).toBe(true)
  })

  it('(б) закреп + непрочитанное: оба бейджа, `has-only-pinned-badge` снят (закреп уходит под счётчик CSS-ом)', async () => {
    const d = listRow(ALICE)
    await fill(d, makeDialog({ peerId: ALICE, pinned: true, lastMessage: message() }))
    await fill(d, makeDialog({ peerId: ALICE, pinned: true, unread: 3, lastMessage: message() }))

    expect(badges(d).map((el) => el.classList.contains('dialog-subtitle-badge-pinned') ? 'pinned' : 'unread')).toEqual(['pinned', 'unread'])
    expect(d.subtitleRow.classList.contains('has-only-pinned-badge')).toBe(false)
  })

  it('(б) закреп пользовательской папки — не `pFlags.pinned` (О-70: `pinnedPeerIds` у папки нет)', async () => {
    const d = listRow(ALICE)
    await fill(d, makeDialog({ peerId: ALICE, pinned: true, lastMessage: message() }), {
      filterId: 7, isArchive: false, isChatListNarrow: () => false,
    })
    expect(d.dom.subtitleEl.querySelector('.dialog-subtitle-badge-pinned')).toBeNull()
    expect(d.dom.listEl.classList.contains('is-pinned')).toBe(false)
  })

  it('(в) упоминания и реакции — свои бейджи в порядке создания tweb: непрочитанное, «@», реакция', async () => {
    const d = listRow(GROUP)
    await fill(d, makeDialog({ peerId: GROUP, unread: 3, unreadMentions: 2, unreadReactions: 1, lastMessage: message({ peerId: GROUP }) }))

    const order = badges(d).map((el) =>
      el.classList.contains('dialog-subtitle-badge-unread') ? 'unread' :
      el.classList.contains('dialog-subtitle-badge-mention') ? 'mention' :
      el.classList.contains('dialog-subtitle-badge-reaction') ? 'reaction' : el.className)
    expect(order).toEqual(['unread', 'mention', 'reaction'])
    expect(d.dom.mentionsBadge!.textContent).toBe('@')
    expect(d.dom.reactionsBadge!.querySelector('.tgico')).not.toBeNull()
  })

  it('(в) одно непрочитанное и оно упоминание — счётчик сам становится «@» (08d07c2b4), отдельного нет', async () => {
    const d = listRow(GROUP)
    await fill(d, makeDialog({ peerId: GROUP, unread: 1, unreadMentions: 1, lastMessage: message({ peerId: GROUP }) }))

    expect(d.dom.unreadBadge!.textContent).toBe('@')
    expect(d.dom.unreadBadge!.classList.contains('mention')).toBe(true)
    expect(d.dom.mentionsBadge).toBeUndefined()
  })

  it('бейдж на аватаре — только в узкой колонке и не в архиве (tweb :2770-2776)', async () => {
    const narrow = listRow(ALICE)
    await fill(narrow, makeDialog({ peerId: ALICE, unread: 4, lastMessage: message() }), {
      filterId: ALL_FOLDER_ID, isArchive: false, isChatListNarrow: () => true,
    })
    const avatarBadge = narrow.dom.listEl.querySelector<HTMLElement>(':scope > .avatar-badge')!
    expect(avatarBadge.textContent).toBe('4')

    const archive = listRow(ALICE)
    await fill(archive, makeDialog({ peerId: ALICE, unread: 4, lastMessage: message() }), {
      filterId: ARCHIVE_FOLDER_ID, isArchive: true, isChatListNarrow: () => true,
    })
    expect(archive.dom.listEl.querySelector('.avatar-badge')).toBeNull()

    const wide = listRow(ALICE)
    await fill(wide, makeDialog({ peerId: ALICE, unread: 4, lastMessage: message() }))
    expect(wide.dom.listEl.querySelector('.avatar-badge')).toBeNull()
  })

  it('галочки своего исходящего — по горизонту собеседника: ✓ до прочтения, ✓✓ после', async () => {
    const d = listRow(ALICE)
    const mine = message({ id: 20, fromId: ME, out: true })
    await fill(d, makeDialog({ peerId: ALICE, readOutboxMaxId: 19, lastMessage: mine }))
    expect(d.dom.statusSpan.querySelector('.sending-status-icon-check')).not.toBeNull()
    expect(d.dom.statusSpan.classList.contains('hide')).toBe(false)

    await fill(d, makeDialog({ peerId: ALICE, readOutboxMaxId: 20, lastMessage: mine }))
    expect(d.dom.statusSpan.querySelector('.sending-status-icon-checks')).not.toBeNull()
    expect(d.dom.statusSpan.children).toHaveLength(1)

    // чужое последнее — значка нет
    await fill(d, makeDialog({ peerId: ALICE, lastMessage: message({ id: 21 }) }))
    expect(d.dom.statusSpan.childElementCount).toBe(0)
    expect(d.dom.statusSpan.classList.contains('hide')).toBe(true)
  })

  it('черновик — «Draft:» `.danger` перед текстом, без миниатюр и галочек; дата — поздняя из двух', async () => {
    const d = listRow(ALICE)
    const draftDate = 1_700_000_500
    await fill(d, {
      ...makeDialog({ peerId: ALICE, lastMessage: message({ fromId: ME, out: true }) }),
      draft: { _: 'draftMessage', message: 'недописанное', date: draftDate },
    })

    const parts = Array.from(d.dom.lastMessageSpan.children) as HTMLElement[]
    expect(parts.map((part) => part.textContent)).toEqual(['Draft: ', 'недописанное'])
    expect(parts[0].querySelector('.danger')).not.toBeNull()
    expect(d.dom.statusSpan.childElementCount).toBe(0)
    expect(d.dom.lastTimeSpan.textContent).not.toBe('')
  })

  it('черновик у форума не показывается (tweb `getLastMessageForDialog` :2414-2421)', async () => {
    applyPeerOps([{ op: 'upsert', peers: [
      { _: 'channel', id: 200, title: 'Форум', photo: { _: 'chatPhotoEmpty' }, date: 0, pFlags: { megagroup: true, forum: true } },
    ] }])
    const d = listRow(-200)
    await fill(d, {
      ...makeDialog({ peerId: -200, lastMessage: message({ peerId: -200, text: 'тема' }) }),
      draft: { _: 'draftMessage', message: 'недописанное', date: 1_700_000_500 },
    })
    expect(d.dom.lastMessageSpan.textContent).not.toContain('Draft')
    expect(d.dom.lastMessageSpan.textContent).toContain('тема')
  })

  it('нет ни сообщения, ни черновика — пустой подзаголовок и время', async () => {
    const d = listRow(ALICE)
    await fill(d, makeDialog({ peerId: ALICE, lastMessage: message() }))
    await fill(d, makeDialog({ peerId: ALICE }))
    expect(d.dom.lastMessageSpan.childElementCount).toBe(0)
    expect(d.dom.lastTimeSpan.textContent).toBe('')
  })

  it('(г) 0af53a342: повторный проход с тем же сообщением не трогает подзаголовок', async () => {
    const d = listRow(GROUP)
    const dialog = makeDialog({ peerId: GROUP, unread: 1, lastMessage: message({ peerId: GROUP }) })
    await fill(d, dialog)
    const before = Array.from(d.dom.lastMessageSpan.childNodes)

    const records: MutationRecord[] = []
    const observer = new MutationObserver((list) => records.push(...list))
    observer.observe(d.dom.lastMessageSpan, { childList: true, subtree: true, characterData: true })

    // прочитали чат — бейджи меняются, подзаголовок тот же
    await fill(d, { ...dialog, unread_count: 0 })
    await settle()
    observer.disconnect()

    expect(records).toHaveLength(0)
    expect(Array.from(d.dom.lastMessageSpan.childNodes)).toEqual(before)
    expect(d.dom.unreadBadge === undefined || !d.dom.unreadBadge.classList.contains('is-visible')).toBe(true)
  })

  it('(г) другое сообщение или чужая запись в подзаголовок — перерисовка', async () => {
    const d = listRow(ALICE)
    await fill(d, makeDialog({ peerId: ALICE, lastMessage: message() }))
    await fill(d, makeDialog({ peerId: ALICE, lastMessage: message({ id: 11, text: 'новое' }) }))
    expect(d.dom.lastMessageSpan.textContent).toBe('новое')

    // кто-то другой написал в подзаголовок (группа поиска, «печатает») — ключ не спасает
    d.dom.lastMessageSpan.replaceChildren('печатает…')
    await fill(d, makeDialog({ peerId: ALICE, lastMessage: message({ id: 11, text: 'новое' }) }))
    expect(d.dom.lastMessageSpan.textContent).toBe('новое')
  })
})

// ── setBadgeState: переход только на смене состояния (0af53a342) ────────────
describe('DialogElement.setBadgeState', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  const state = { muted: false, pinned: true, unread: false, unreadAvatar: false, mentions: false, reactions: false, transitionDuration: 250 }

  it('(д) повторное то же состояние не проигрывает переход подписи (мигание многоточия у закреплённых)', () => {
    const d = addDialogNew({ peerId: ALICE, container: false, wrapOptions: { middleware: getMiddleware().get() }, managers })
    document.body.append(d.container)

    d.setBadgeState(state)
    expect(d.subtitleRow.classList.contains('animating')).toBe(true)
    vi.advanceTimersByTime(300)
    expect(d.subtitleRow.classList.contains('animating')).toBe(false)
    expect(d.subtitleRow.classList.contains('has-only-pinned-badge')).toBe(true)

    d.setBadgeState(state)
    expect(d.subtitleRow.classList.contains('animating')).toBe(false)
    expect(d.dom.pinnedBadge!.classList.contains('animating')).toBe(false)
  })

  it('смена состояния переход проигрывает: второй бейдж снимает `has-only-pinned-badge`', () => {
    const d = addDialogNew({ peerId: ALICE, container: false, wrapOptions: { middleware: getMiddleware().get() }, managers })
    document.body.append(d.container)

    d.setBadgeState(state)
    vi.advanceTimersByTime(300)
    d.setBadgeState({ ...state, unread: true, unreadText: '2' })
    expect(d.subtitleRow.classList.contains('animating')).toBe(true)
    vi.advanceTimersByTime(300)
    expect(d.subtitleRow.classList.contains('has-only-pinned-badge')).toBe(false)
  })

  it('скрытый бейдж уходит из DOM по концу перехода', () => {
    const d = addDialogNew({ peerId: ALICE, container: false, wrapOptions: { middleware: getMiddleware().get() }, managers })
    document.body.append(d.container)

    d.setBadgeState({ ...state, transitionDuration: 0, unread: true, unreadText: '1' })
    const unread = d.dom.unreadBadge!
    d.setBadgeState({ ...state, transitionDuration: 0, unread: false })
    expect(unread.isConnected).toBe(false)
    expect(d.dom.unreadBadge).toBeUndefined()
  })
})

// ── initDialog / getDialog (tweb `:2825-2984`): диалог — из зеркала (В7-3) ──
describe('initDialog', () => {
  afterEach(() => useChatsStore.setState({ dialogs: [], dialogIndexById: {} }))

  it('берёт диалог из зеркала `chatsStore` и наполняет строку подзаголовком и бейджами', async () => {
    const dialog = makeDialog({ peerId: ALICE, unread: 7, lastMessage: makeMessage({ id: 3, peerId: ALICE, fromId: ALICE, text: 'из зеркала' }) })
    // индекс сортировки — не позиция в массиве: строку ищут по пиру
    const other = makeDialog({ peerId: GROUP, unread: 1 })
    useChatsStore.setState({ dialogs: [other, dialog], dialogIndexById: { [GROUP]: 5, [ALICE]: 9 } })
    const d = addDialogNew({ peerId: ALICE, container: false, wrapOptions: { middleware: getMiddleware().get() }, managers })

    await initDialog(d, { peerId: ALICE, isBatch: true })
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(d.dom.lastMessageSpan.textContent).toBe('из зеркала')
    expect(d.dom.unreadBadge!.textContent).toBe('7')
  })

  it('диалога в зеркале нет — заготовка: пустая строка без бейджей (tweb `{peerId, pFlags: {}}`)', async () => {
    const d = addDialogNew({ peerId: ALICE, container: false, wrapOptions: { middleware: getMiddleware().get() }, managers })
    expect(getDialog(ALICE)).toMatchObject({ _: 'dialog', peerId: ALICE, unread_count: 0 })

    await initDialog(d, { peerId: ALICE, isBatch: true })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(d.dom.lastMessageSpan.childElementCount).toBe(0)
    expect(d.dom.unreadBadge).toBeUndefined()
  })
})

// ── «Избранное» и «Telegram» (пины PR #330, `docs/tweb/special-peers.md`) ───
describe('(ж) особые пиры в строке', () => {
  it('«Избранное»: имя Saved Messages, своё исходящее — без галочек (tweb :2723: `peerId !== myId`)', async () => {
    applyPeerOps([{ op: 'upsert', peers: [{ _: 'user', id: ME, first_name: 'Я', pFlags: { self: true } }] }])
    const d = addDialogNew({ peerId: ME, container: false, wrapOptions: { middleware: getMiddleware().get() }, managers })
    document.body.append(d.container)

    await setLastMessageN({
      dialog: makeDialog({ peerId: ME, lastMessage: makeMessage({ id: 5, peerId: ME, fromId: ME, out: true, text: 'заметка' }) }),
      dialogElement: d, setUnread: true, isBatch: true,
    })
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(d.dom.titleSpan.textContent).toBe('Saved Messages')
    expect(d.dom.listEl.querySelector('.avatar-icon-saved_filled')).not.toBeNull()
    expect(d.dom.statusSpan.childElementCount).toBe(0)
  })

  it('«Telegram» (777000) — обычная строка пира: имя с карточки, без глифа и подмен', async () => {
    applyPeerOps([{ op: 'upsert', peers: [{ _: 'user', id: 777000, first_name: 'Telegram', pFlags: { verified: true } }] }])
    const d = addDialogNew({ peerId: 777000, container: false, wrapOptions: { middleware: getMiddleware().get() }, managers })
    document.body.append(d.container)

    expect(d.dom.titleSpan.textContent).toBe('Telegram')
    expect(d.dom.listEl.querySelector('[class*="avatar-icon-"]')).toBeNull()
    expect(d.dom.avatarEl!.node.dataset.peerId).toBe('777000')
  })
})

// ── (з) владелец снимает то, что создал (DoD 5) ─────────────────────────────
describe('(з) DialogElement.destroy', () => {
  it('гасит Solid-корень строки и зону аватара/имени', () => {
    const d = addDialogNew({ peerId: ALICE, container: false, wrapOptions: { middleware: getMiddleware().get() }, managers })
    document.body.append(d.container)
    const middleware = d.middlewareHelper.get()

    d.destroy()

    expect(middleware()).toBe(false)
    const late = document.createElement('div')
    d.applyMediaElement(late)
    expect(late.parentElement).toBeNull()
  })

  it('remove() снимает строку из DOM', () => {
    const d = addDialogNew({ peerId: ALICE, container: false, wrapOptions: { middleware: getMiddleware().get() }, managers })
    document.body.append(d.container)
    d.remove()
    expect(document.body.querySelector('.chatlist-chat')).toBeNull()
  })
})
