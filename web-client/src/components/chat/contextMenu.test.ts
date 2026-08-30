// Тесты порта `components/chat/contextMenu.ts` (tweb `ChatContextMenu`).
//
// Меню поднимается ровно так, как его поднимет лента: узкие порт-интерфейсы
// (`ContextMenuChat`/`ContextMenuBubbles`/`ContextMenuManagers`/
// `ContextMenuPopups`) + настоящие зеркала (`messagesMirror` — окно чата,
// `peerCache` — карточки пиров), настоящий `ChatSelection` и настоящие
// `contextMenuController`/`ButtonMenu`. Ничего из проверяемого не подменено:
// подмена ButtonMenu превратила бы тест состава пунктов в тест мока.
//
// DOM бабла — разметка ленты (`bubbles.ts:903-921`):
//   .bubbles-inner > .bubble[.is-in|.is-out][data-mid][data-peer-id]
//                      > .bubble-content-wrapper > .bubble-content
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ChatContextMenu, {
  type ContextMenuChat,
  type ContextMenuManagers,
  type ContextMenuPopups,
} from './contextMenu'
import ChatSelection, { type SelectionBubbles } from './selection'
import contextMenuController from '@helpers/contextMenuController'
import rootScope from '@lib/rootScope'
import { putMirrorPage, resetMessagesMirror } from '@core/history/messagesMirror'
import { applyPeerOps, resetPeerMirror } from '@core/peerCache'
import type { MyMessage } from '@core/models'

const PEER = 5 // ключ ≥ 0 — личный чат (core/peers/peerId.ts)
const CHANNEL = -7
const KEY = 'win'

function message(id: number, extra: Partial<MyMessage> = {}): MyMessage {
  return {
    _: 'message',
    id,
    pFlags: {},
    peerId: PEER,
    fromId: PEER,
    peer_id: { _: 'peerUser', user_id: PEER },
    date: 1700000000 + id,
    message: `text ${id}`,
    ...extra,
  } as MyMessage
}

function makeBubble(mid: number, options: { out?: boolean, classes?: string[], peerId?: number } = {}) {
  const bubble = document.createElement('div')
  bubble.classList.add('bubble', options.out ? 'is-out' : 'is-in', ...(options.classes ?? []))
  bubble.dataset.mid = String(mid)
  bubble.dataset.peerId = String(options.peerId ?? PEER)

  const wrapper = document.createElement('div')
  wrapper.classList.add('bubble-content-wrapper')
  const content = document.createElement('div')
  content.classList.add('bubble-content')
  wrapper.append(content)
  bubble.append(wrapper)
  return { bubble, content }
}

class FakeBubbles implements SelectionBubbles {
  constructor(public inner: HTMLElement) {}

  getRenderedHistory(sort: 'asc' | 'desc'): string[] {
    const mids = Array.from(this.inner.querySelectorAll<HTMLElement>('.bubble'))
      .map((bubble) => `${bubble.dataset.peerId}_${bubble.dataset.mid}`)
    return sort === 'asc' ? mids : mids.reverse()
  }

  getBubble(fullMid: string): HTMLElement | undefined {
    const mid = fullMid.slice(fullMid.indexOf('_') + 1)
    return this.inner.querySelector<HTMLElement>(`.bubble[data-mid="${mid}"]`) ?? undefined
  }

  getBubbleGroupedItems(bubble: HTMLElement): HTMLElement[] {
    return Array.from(bubble.querySelectorAll<HTMLElement>('.grouped-item'))
  }

  async getMountedBubble(fullMid: string) {
    const bubble = this.getBubble(fullMid)
    return bubble ? { bubble } : undefined
  }
}

function makeManagers() {
  return {
    messages: {
      votePoll: vi.fn().mockResolvedValue(undefined),
      closePoll: vi.fn().mockResolvedValue(undefined),
      viewers: vi.fn().mockResolvedValue([]),
    },
    chats: { getReadDate: vi.fn().mockResolvedValue(null) },
    media: { downloadToDisc: vi.fn() },
  } satisfies ContextMenuManagers
}

function makePopups() {
  return {
    showPinMessage: vi.fn(),
    showDeleteMessages: vi.fn(),
    showForward: vi.fn(),
    showMessageReport: vi.fn(),
    showReactedList: vi.fn(),
    showStatistics: vi.fn(),
    showFactCheckEditor: vi.fn(),
  } satisfies ContextMenuPopups
}

function makeChat(overrides: Partial<ContextMenuChat> = {}): ContextMenuChat {
  return {
    peerId: PEER,
    messagesStorageKey: KEY,
    canSend: () => true,
    hasMessageInput: () => true,
    initMessageReply: vi.fn(),
    initMessageEditing: vi.fn(),
    initSearch: vi.fn(),
    ...overrides,
  }
}

/** Правый клик (десктопный путь `attachContextMenuListener`). */
function rightClick(target: HTMLElement) {
  const e = new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
  Object.defineProperty(e, 'pageX', { value: 10 })
  Object.defineProperty(e, 'pageY', { value: 10 })
  target.dispatchEvent(e)
}

/** Дать отработать `verify()`/`ButtonMenu` (меню открывается асинхронно). */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

function menuElement(): HTMLElement | null {
  return document.getElementById('bubble-contextmenu')
}

function itemTexts(): string[] {
  return Array.from(menuElement()?.querySelectorAll<HTMLElement>('.btn-menu-item') ?? [])
    .map((item) => item.querySelector<HTMLElement>('.btn-menu-item-text')?.textContent ?? '')
}

let container: HTMLElement

beforeEach(() => {
  resetMessagesMirror()
  resetPeerMirror()
  document.body.innerHTML = ''
  container = document.createElement('div')
  container.classList.add('bubbles-inner')
  document.body.append(container)
})

afterEach(() => {
  contextMenuController.close()
})

describe('ChatContextMenu — открытие (tweb :246-585)', () => {
  it('правый клик по баблу вешает в body меню tweb-разметкой и открывает его', async() => {
    putMirrorPage(KEY, [message(1)])
    const { bubble, content } = makeBubble(1)
    container.append(bubble)

    const menu = new ChatContextMenu(makeChat(), {}, makeManagers(), makePopups())
    menu.attachTo(container)

    rightClick(content)
    await flush()

    const element = menuElement()
    expect(element).not.toBeNull()
    expect(element!.parentElement).toBe(document.body)
    expect(element!.classList.contains('btn-menu')).toBe(true)
    expect(element!.classList.contains('contextmenu')).toBe(true)
    // openBtnMenu (contextMenuController:134-151)
    expect(element!.classList.contains('active')).toBe(true)
  })

  // `bubble-first` — плейсхолдер ПУСТОГО ЧАТА (tweb bubbles.ts:10785), а не
  // дата-бабл: тот отсекается раньше, `pointer-events: none` у `.is-date`.
  it('плейсхолдер пустого чата (`bubble-first`) меню не открывает (:363)', async() => {
    putMirrorPage(KEY, [message(1)])
    const { bubble, content } = makeBubble(1, { classes: ['bubble-first'] })
    container.append(bubble)

    const menu = new ChatContextMenu(makeChat(), {}, makeManagers(), makePopups())
    menu.attachTo(container)

    rightClick(content)
    await flush()

    expect(menuElement()).toBeNull()
  })

  it('повторный вызов при уже активном меню второго меню не строит (:371-373)', async() => {
    putMirrorPage(KEY, [message(1)])
    const { bubble, content } = makeBubble(1)
    container.append(bubble)

    const menu = new ChatContextMenu(makeChat(), {}, makeManagers(), makePopups())
    menu.attachTo(container)

    rightClick(content)
    await flush()
    const first = menuElement()

    rightClick(content)
    await flush()

    expect(document.querySelectorAll('#bubble-contextmenu')).toHaveLength(1)
    expect(menuElement()).toBe(first)
  })

  it('удаление сообщения закрывает открытое меню (:323-347)', async() => {
    putMirrorPage(KEY, [message(1)])
    const { bubble, content } = makeBubble(1)
    container.append(bubble)

    const menu = new ChatContextMenu(makeChat(), {}, makeManagers(), makePopups())
    menu.attachTo(container)

    rightClick(content)
    await flush()
    const element = menuElement()!
    expect(element.classList.contains('active')).toBe(true)

    rootScope.dispatchEventSingle('history_delete', { peerId: PEER, msgs: new Set([1]) })
    expect(element.classList.contains('active')).toBe(false)
  })
})

describe('ChatContextMenu — состав пунктов (setButtons, tweb :715-1315)', () => {
  it('входящее текстовое в личке: Reply, Copy, Pin, Forward, Delete — в порядке tweb', async() => {
    putMirrorPage(KEY, [message(1)])
    const { bubble, content } = makeBubble(1)
    container.append(bubble)

    const menu = new ChatContextMenu(makeChat(), {}, makeManagers(), makePopups())
    menu.attachTo(container)

    rightClick(content)
    await flush()

    expect(itemTexts()).toEqual(['Reply', 'Copy', 'Pin', 'Forward', 'Delete'])
  })

  it('«Изменить» появляется только у своего сообщения (verify canEditMessage, :1007-1014)', async() => {
    putMirrorPage(KEY, [message(1, { pFlags: { out: true } })])
    const { bubble, content } = makeBubble(1, { out: true })
    container.append(bubble)

    const managers = makeManagers()
    const menu = new ChatContextMenu(makeChat(), {}, managers, makePopups())
    menu.attachTo(container)

    rightClick(content)
    await flush()

    expect(itemTexts()).toContain('Edit')
  })

  it('исходящее в личке: первым идёт пункт read-date с шиммером, он же спрашивает дату прочтения (:1506-1541)', async() => {
    putMirrorPage(KEY, [message(1, { pFlags: { out: true } })])
    const { bubble, content } = makeBubble(1, { out: true })
    container.append(bubble)

    const managers = makeManagers()
    // ответ висит в полёте — ровно то состояние, ради которого в оригинале
    // существует шиммер
    managers.chats.getReadDate.mockReturnValue(new Promise(() => {}))
    const menu = new ChatContextMenu(makeChat(), {}, managers, makePopups())
    menu.attachTo(container)

    rightClick(content)
    await flush()

    const first = menuElement()!.querySelector<HTMLElement>('.btn-menu-item')!
    expect(first.querySelector('.btn-menu-item-icon')).not.toBeNull()
    expect(first.querySelector('.btn-menu-item-loader.shimmer')).not.toBeNull()
    expect(managers.chats.getReadDate).toHaveBeenCalledWith(PEER, 1)
    // разделитель под пунктом (:1514)
    expect(first.nextElementSibling?.tagName).toBe('HR')
  })

  it('read-date недоступен — пункт и его разделитель убираются (:1532-1535)', async() => {
    putMirrorPage(KEY, [message(1, { pFlags: { out: true } })])
    const { bubble, content } = makeBubble(1, { out: true })
    container.append(bubble)

    const managers = makeManagers() // getReadDate → null
    const menu = new ChatContextMenu(makeChat(), {}, managers, makePopups())
    menu.attachTo(container)

    rightClick(content)
    await flush()

    expect(menuElement()!.querySelector('.btn-menu-item-loader')).toBeNull()
    expect(menuElement()!.querySelector('hr')).toBeNull()
    expect(itemTexts()[0]).toBe('Reply')
  })

  it('read-date скрыт приватностью — «Read show when» (:1537-1540)', async() => {
    putMirrorPage(KEY, [message(1, { pFlags: { out: true } })])
    const { bubble, content } = makeBubble(1, { out: true })
    container.append(bubble)

    const managers = makeManagers()
    managers.chats.getReadDate.mockResolvedValue({ restricted: true })
    const menu = new ChatContextMenu(makeChat(), {}, managers, makePopups())
    menu.attachTo(container)

    rightClick(content)
    await flush()

    const first = menuElement()!.querySelector<HTMLElement>('.btn-menu-item-text')!
    expect(first.textContent).toBe('Read show when')
    expect(first.querySelector('.show-when')?.textContent).toBe('show when')
  })

  it('в канале без прав нет ни «Закрепить», ни «Статистики», зато есть «Скопировать ссылку»', async() => {
    applyPeerOps([{ op: 'upsert', peers: [{ _: 'channel', id: 7, title: 'ch', pFlags: { broadcast: true }, photo: undefined, date: 0 } as never] }])
    putMirrorPage(KEY, [message(1, { peerId: CHANNEL, peer_id: { _: 'peerChannel', channel_id: 7 } })])
    const { bubble, content } = makeBubble(1, { peerId: CHANNEL })
    container.append(bubble)

    const menu = new ChatContextMenu(makeChat({ peerId: CHANNEL }), {}, makeManagers(), makePopups())
    menu.attachTo(container)

    rightClick(content)
    await flush()

    const texts = itemTexts()
    expect(texts).toContain('Copy Message Link')
    expect(texts).not.toContain('Pin')
    expect(texts).not.toContain('Statistics')
  })

  it('в режиме выделения остаются только пункты с withSelection (:703)', async() => {
    putMirrorPage(KEY, [message(1)])
    const { bubble, content } = makeBubble(1)
    container.append(bubble)

    const selection = new ChatSelection(new FakeBubbles(container), { messages: {} })
    selection.toggleByElement(bubble)
    expect(selection.isSelecting).toBe(true)

    const menu = new ChatContextMenu(makeChat(), { selection }, makeManagers(), makePopups())
    menu.attachTo(container)

    rightClick(content)
    await flush()

    expect(itemTexts()).toEqual(['Copy', 'Forward', 'Clear Selection', 'Delete'])
  })
})

describe('ChatContextMenu — действия пунктов', () => {
  async function openOn(mid: number, options: { chat?: Partial<ContextMenuChat>, target?: 'content' } = {}) {
    const { bubble, content } = makeBubble(mid)
    container.append(bubble)
    const chat = makeChat(options.chat)
    const managers = makeManagers()
    const popups = makePopups()
    const menu = new ChatContextMenu(chat, {}, managers, popups)
    menu.attachTo(container)
    rightClick(content)
    await flush()
    return { chat, managers, popups, bubble }
  }

  function clickItem(text: string) {
    const item = Array.from(menuElement()!.querySelectorAll<HTMLElement>('.btn-menu-item'))
      .find((el) => el.querySelector('.btn-menu-item-text')?.textContent === text)
    expect(item, `пункт «${text}» не найден`).toBeTruthy()
    item!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
  }

  it('«Ответить» зовёт композер номером сообщения и закрывает меню (:1861-1872)', async() => {
    putMirrorPage(KEY, [message(1)])
    const { chat } = await openOn(1)

    const element = menuElement()!
    clickItem('Reply')

    expect(chat.initMessageReply).toHaveBeenCalledWith(1)
    expect(element.classList.contains('active')).toBe(false)
  })

  it('«Удалить» отдаёт попапу ВЕСЬ альбом, а не один номер (:2054-2065)', async() => {
    putMirrorPage(KEY, [
      message(10, { grouped_id: 99 }),
      message(11, { grouped_id: 99 }),
    ])
    const { popups } = await openOn(10)

    clickItem('Delete')

    expect(popups.showDeleteMessages).toHaveBeenCalledWith(PEER, [10, 11])
  })

  it('«Переслать» открывает попап пересылки альбомом (:2032-2044)', async() => {
    putMirrorPage(KEY, [
      message(10, { grouped_id: 99 }),
      message(11, { grouped_id: 99 }),
    ])
    const { popups } = await openOn(10)

    clickItem('Forward')

    expect(popups.showForward).toHaveBeenCalledWith({ [PEER]: [10, 11] })
  })

  it('«Закрепить» открывает попап закрепления (:2016-2018)', async() => {
    putMirrorPage(KEY, [message(1)])
    const { popups } = await openOn(1)

    clickItem('Pin')

    expect(popups.showPinMessage).toHaveBeenCalledWith(PEER, 1)
  })

  // Пункт `views` группы (:1543-1644 + :1245-1251): у сообщения есть недавние
  // реакции → текст «Reacted N», клик открывает список отреагировавших.
  // ТРЕТИЙ аргумент — адаптация, а не порт (докблок `showReactedList`): у tweb
  // это модальный `PopupReactedList`, у нас позиционируемый попап, и якорем ему
  // служит точка клика по пункту.
  it('пункт «Reacted N» открывает список отреагировавших ЯКОРЕМ по клику (:1245-1251)', async() => {
    const GROUP = -9
    applyPeerOps([{ op: 'upsert', peers: [{ _: 'channel', id: 9, title: 'gr', pFlags: { megagroup: true }, photo: undefined, date: 0 } as never] }])
    putMirrorPage(KEY, [message(1, {
      peerId: GROUP,
      peer_id: { _: 'peerChannel', channel_id: 9 },
      reactions: {
        _: 'messageReactions',
        results: [{ _: 'reactionCount', reaction: { _: 'reactionEmoji', emoticon: '👍' }, count: 2 }],
        recent_reactions: [
          { _: 'messagePeerReaction', peer_id: { _: 'peerUser', user_id: 8 }, date: 0, reaction: { _: 'reactionEmoji', emoticon: '👍' } },
        ],
      },
    })])
    const { bubble, content } = makeBubble(1, { peerId: GROUP })
    container.append(bubble)

    const popups = makePopups()
    const menu = new ChatContextMenu(makeChat({ peerId: GROUP }), {}, makeManagers(), popups)
    menu.attachTo(container)
    rightClick(content)
    await flush()

    expect(itemTexts()).toContain('Reacted 2')
    const item = Array.from(menuElement()!.querySelectorAll<HTMLElement>('.btn-menu-item'))
      .find((el) => el.querySelector('.btn-menu-item-text')?.textContent === 'Reacted 2')!
    const click = new MouseEvent('click', { bubbles: true, cancelable: true, clientX: 42, clientY: 84 })
    item.dispatchEvent(click)

    expect(popups.showReactedList).toHaveBeenCalledWith(GROUP, 1, { x: 42, y: 84 })
  })
})

// «Кто просмотрел» — это ВТОРАЯ ветка того же пункта `views` группы: реакций у
// сообщения нет, поэтому текст пункта приезжает ответом `messages.viewers`
// (порт tweb :1543-1644, где ту же роль играет
// `getMessageReactionsListAndReadParticipants`). Пункт показывается только у
// СВОЕГО сообщения в не-broadcast чате — `canViewMessageReadParticipants`
// (appMessagesManager.ts:9109-9123), поэтому у чужого его быть не должно.
describe('ChatContextMenu — «кто просмотрел» (views без реакций, tweb :1543-1644)', () => {
  const GROUP = -9

  function groupMessage(extra: Partial<MyMessage> = {}): MyMessage {
    return message(1, {
      peerId: GROUP,
      peer_id: { _: 'peerChannel', channel_id: 9 },
      ...extra,
    })
  }

  function upsertGroup() {
    applyPeerOps([{ op: 'upsert', peers: [{ _: 'channel', id: 9, title: 'gr', pFlags: { megagroup: true }, photo: undefined, date: 0 } as never] }])
  }

  async function openInGroup(managers: ReturnType<typeof makeManagers>, popups = makePopups()) {
    const { bubble, content } = makeBubble(1, { out: true, peerId: GROUP })
    container.append(bubble)
    const menu = new ChatContextMenu(makeChat({ peerId: GROUP }), {}, managers, popups)
    menu.attachTo(container)
    rightClick(content)
    await flush()
    return popups
  }

  function viewsItem(): HTMLElement | undefined {
    // пункт `views` — единственный без своего `text` в `setButtons`: его подпись
    // ставит `init`, а иконка приезжает `prepend`-ом (`checks`/`reactions`)
    return Array.from(menuElement()?.querySelectorAll<HTMLElement>('.btn-menu-item') ?? [])
      .find((el) => /Seen by|Nobody viewed|Loading/.test(el.querySelector('.btn-menu-item-text')?.textContent ?? ''))
  }

  it('своё сообщение в группе без реакций: пункт спрашивает `messages.viewers` и пишет «Seen by N»', async() => {
    upsertGroup()
    putMirrorPage(KEY, [groupMessage({ pFlags: { out: true } })])

    const managers = makeManagers()
    managers.messages.viewers.mockResolvedValue([11, 12])
    await openInGroup(managers)
    await flush()

    expect(managers.messages.viewers).toHaveBeenCalledWith(GROUP, 1)
    expect(itemTexts()).toContain('Seen by 2')
  })

  // Текст ключа `Loading` — 'Loading...' (взят у оригинала вместе с ключом, tweb lang.ts):
  // после кодмода задачи 6 пункт показывает его, а не старую строку 'Loading'.
  it('ответ ещё в полёте — у пункта стоит «Loading» (:1574)', async() => {
    upsertGroup()
    putMirrorPage(KEY, [groupMessage({ pFlags: { out: true } })])

    const managers = makeManagers()
    managers.messages.viewers.mockReturnValue(new Promise(() => {}))
    await openInGroup(managers)

    expect(itemTexts()).toContain('Loading...')
  })

  it('никто не просмотрел — «Nobody viewed», и клик списка не открывает (:1556, :1619-1624)', async() => {
    upsertGroup()
    putMirrorPage(KEY, [groupMessage({ pFlags: { out: true } })])

    const managers = makeManagers() // viewers → []
    const popups = await openInGroup(managers)
    await flush()

    expect(itemTexts()).toContain('Nobody viewed')
    viewsItem()!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    expect(popups.showReactedList).not.toHaveBeenCalled()
  })

  it('просмотревшие есть — клик по пункту открывает список якорем (:1632-1641, :1245-1251)', async() => {
    upsertGroup()
    putMirrorPage(KEY, [groupMessage({ pFlags: { out: true } })])

    const managers = makeManagers()
    managers.messages.viewers.mockResolvedValue([11, 12])
    const popups = await openInGroup(managers)
    await flush()

    viewsItem()!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: 7, clientY: 9 }))
    expect(popups.showReactedList).toHaveBeenCalledWith(GROUP, 1, { x: 7, y: 9 })
  })

  it('чужое сообщение — пункта нет вовсе, `messages.viewers` не спрашивается (appMessagesManager.ts:9109-9123)', async() => {
    upsertGroup()
    putMirrorPage(KEY, [groupMessage()]) // без pFlags.out

    const managers = makeManagers()
    const { bubble, content } = makeBubble(1, { peerId: GROUP })
    container.append(bubble)
    const menu = new ChatContextMenu(makeChat({ peerId: GROUP }), {}, managers, makePopups())
    menu.attachTo(container)
    rightClick(content)
    await flush()
    await flush()

    expect(viewsItem()).toBeUndefined()
    expect(managers.messages.viewers).not.toHaveBeenCalled()
  })
})

// ВЕЩАТЕЛЬНЫЙ КАНАЛ: реакции там анонимны, и пункта `views` у оригинала нет
// ВОВСЕ — не «есть, но не открывает список». Оба терма его verify
// (contextMenu.ts:1257-1258) там ложны: `recent_reactions` сервер не присылает
// (право на список — то же `can_see_list`, которого в канале нет), а
// `canViewMessageReadParticipants` отсекает broadcast явно
// (appMessagesManager.ts:9109-9116). Задача #93.
describe('ChatContextMenu — пункт `views` в вещательном канале (tweb :1257-1258)', () => {
  const CHANNEL = -7

  it('реакции есть, права на список нет — пункта нет и `messages.viewers` не спрашивается', async() => {
    applyPeerOps([{ op: 'upsert', peers: [{ _: 'channel', id: 7, title: 'ch', pFlags: {}, photo: undefined, date: 0 } as never] }])
    putMirrorPage(KEY, [message(1, {
      peerId: CHANNEL,
      peer_id: { _: 'peerChannel', channel_id: 7 },
      pFlags: { out: true },
      // Агрегат едет, вектора recent_reactions в нём нет — ровно то, что
      // отдаёт сервер без права на список (domain/messagewire.go).
      reactions: {
        _: 'messageReactions',
        results: [{ _: 'reactionCount', reaction: { _: 'reactionEmoji', emoticon: '👍' }, count: 2 }],
      },
    })])

    const managers = makeManagers()
    const { bubble, content } = makeBubble(1, { out: true, peerId: CHANNEL })
    container.append(bubble)
    const menu = new ChatContextMenu(makeChat({ peerId: CHANNEL }), {}, managers, makePopups())
    menu.attachTo(container)
    rightClick(content)
    await flush()
    await flush()

    // Меню ОТКРЫТО — иначе «пункта нет» ничего не значило бы.
    expect(itemTexts()).toContain('Reply')
    const views = Array.from(menuElement()?.querySelectorAll<HTMLElement>('.btn-menu-item') ?? [])
      .find((el) => /Seen by|Nobody viewed|Loading|Reacted/.test(el.querySelector('.btn-menu-item-text')?.textContent ?? ''))
    expect(views).toBeUndefined()
    expect(managers.messages.viewers).not.toHaveBeenCalled()
  })
})
