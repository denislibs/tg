// Тесты порта `components/chat/contextMenu.ts` (tweb `ChatContextMenu`).
//
// Меню поднимается ровно так, как его поднимает `Chat.init`: фейковый `Chat`
// (`testChat.ts`) с настоящим `ChatSelection`, узкие `ContextMenuManagers`/
// замоканные попапы пунктов (`popups/*` — граница модуля) + настоящие зеркала (`messagesMirror` — окно чата,
// `peerCache` — карточки пиров) и настоящие `contextMenuController`/`ButtonMenu`. Ничего из проверяемого не подменено:
// подмена ButtonMenu превратила бы тест состава пунктов в тест мока.
//
// DOM бабла — разметка ленты (`bubbles.ts:903-921`):
//   .bubbles-inner > .bubble[.is-in|.is-out][data-mid][data-peer-id]
//                      > .bubble-content-wrapper > .bubble-content
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ChatContextMenu, {
  type ContextMenuManagers,
} from './contextMenu'
import type { SelectionBubbles } from './selection'
import { ChatType } from './chatType'
import type Chat from './chat'
import { attachTestSelection, createTestChat, type TestChatOptions } from './testChat'
import contextMenuController from '@helpers/contextMenuController'
import { CLICK_EVENT_NAME } from '@helpers/dom/clickEvent'
import rootScope from '@lib/rootScope'
import { putMirrorPage, resetMessagesMirror } from '@core/history/messagesMirror'
import { applyPeerOps, resetPeerMirror } from '@core/peerCache'
import type { MyMessage } from '@core/models'
import wrapSticker from '@components/wrappers/sticker'

// Панель быстрых реакций рисует стикеры ролей; сами файлы к меню отношения не
// имеют — важен только факт встраивания панели и её отступ.
vi.mock('@components/wrappers/sticker', () => ({ default: vi.fn() }))

// Попапы пунктов меню tweb зовёт напрямую (`PopupPinMessage`, `showForwardPopup`, …);
// тест меню проверяет, ЧТО и С ЧЕМ меню у них просит, — граница модуля.
const popups = vi.hoisted(() => ({
  showPinMessagePopup: vi.fn(),
  showDeleteMessagesPopup: vi.fn(),
  showForwardPopup: vi.fn(),
  showMessageReport: vi.fn(),
  showReactedListPopup: vi.fn(),
}))
vi.mock('@components/popups/unpinMessage', () => ({ default: popups.showPinMessagePopup }))
vi.mock('@components/popups/deleteMessages', () => ({ default: popups.showDeleteMessagesPopup }))
vi.mock('@components/popups/forward.bridge', () => ({ default: popups.showForwardPopup }))
vi.mock('@components/popups/reportAd.bridge', () => ({ showMessageReport: popups.showMessageReport }))
vi.mock('@components/popups/reactedList.bridge', () => ({ default: popups.showReactedListPopup }))
// тост держит свой слой кликов (`OverlayClickHandler`) и съел бы правый клик
// следующего теста
vi.mock('@components/toast', () => ({ toastNew: vi.fn(), toast: vi.fn() }))

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
    // свежее: правка в личке ограничена сроком (EDIT_TIME_LIMIT, tweb edit_time_limit)
    date: Math.floor(Date.now() / 1000) - 3600 + id,
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
}

function makeManagers() {
  return {
    messages: {
      votePoll: vi.fn().mockResolvedValue(undefined),
      closePoll: vi.fn().mockResolvedValue(undefined),
      viewers: vi.fn().mockResolvedValue([]),
      setFactCheck: vi.fn().mockResolvedValue(undefined),
      removeFactCheck: vi.fn().mockResolvedValue(undefined),
    },
    chats: { getReadDate: vi.fn().mockResolvedValue(null) },
  } satisfies ContextMenuManagers
}

/** Тот же срез, но с проводкой панели быстрых реакций: каталог + пара
 *  «поставить/снять» (tweb `apiManagerProxy.getAvailableReactions` +
 *  `chat.sendReaction`). Без них панель не показывается вовсе. */
function makeReactionManagers(...emojis: string[]) {
  const base = makeManagers()
  return {
    ...base,
    messages: {
      ...base.messages,
      react: vi.fn().mockResolvedValue(undefined),
      unreact: vi.fn().mockResolvedValue(undefined),
    },
    reactions: {
      list: vi.fn(async () => emojis.map((emoji, i) => ({
        emoji, title: '', position: i, premium: false, inactive: false,
        appearMediaId: 10 + i, selectMediaId: 20 + i, staticMediaId: 30 + i,
      }))),
    },
  } satisfies ContextMenuManagers
}

/** `Chat` лички с композером и выделением поверх баблов `container`. */
function makeChat(options: TestChatOptions = {}): Chat {
  const chat = createTestChat({ peerId: PEER, messagesStorageKey: KEY, ...options })
  attachTestSelection(chat, new FakeBubbles(container))
  return chat
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

function makePopups() {
  return popups
}

beforeEach(() => {
  Object.values(popups).forEach((fn) => fn.mockClear())
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

    const menu = new ChatContextMenu(makeChat(), makeManagers())
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

    const menu = new ChatContextMenu(makeChat(), makeManagers())
    menu.attachTo(container)

    rightClick(content)
    await flush()

    expect(menuElement()).toBeNull()
  })

  it('повторный вызов при уже активном меню второго меню не строит (:371-373)', async() => {
    putMirrorPage(KEY, [message(1)])
    const { bubble, content } = makeBubble(1)
    container.append(bubble)

    const menu = new ChatContextMenu(makeChat(), makeManagers())
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

    const menu = new ChatContextMenu(makeChat(), makeManagers())
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
  it('входящее текстовое в личке: Reply, Copy, Pin, Forward, Select, Delete — в порядке tweb', async() => {
    putMirrorPage(KEY, [message(1)])
    const { bubble, content } = makeBubble(1)
    container.append(bubble)

    const menu = new ChatContextMenu(makeChat(), makeManagers())
    menu.attachTo(container)

    rightClick(content)
    await flush()

    expect(itemTexts()).toEqual(['Reply', 'Copy', 'Pin', 'Forward', 'Select', 'Delete'])
  })

  it('без композера (`chat.input.messageInput`) «Ответить» нет (verify :984)', async() => {
    putMirrorPage(KEY, [message(1)])
    const { bubble, content } = makeBubble(1)
    container.append(bubble)

    const menu = new ChatContextMenu(makeChat({ input: { messageInput: undefined } }), makeManagers())
    menu.attachTo(container)

    rightClick(content)
    await flush()

    expect(itemTexts()).toEqual(['Copy', 'Pin', 'Forward', 'Select', 'Delete'])
  })

  it('«Изменить» появляется только у своего сообщения (verify canEditMessage, :1007-1014)', async() => {
    putMirrorPage(KEY, [message(1, { pFlags: { out: true } })])
    const { bubble, content } = makeBubble(1, { out: true })
    container.append(bubble)

    const managers = makeManagers()
    const menu = new ChatContextMenu(makeChat(), managers)
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
    const menu = new ChatContextMenu(makeChat(), managers)
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
    const menu = new ChatContextMenu(makeChat(), managers)
    menu.attachTo(container)

    rightClick(content)
    await flush()

    expect(menuElement()!.querySelector('.btn-menu-item-loader')).toBeNull()
    expect(menuElement()!.querySelector('hr')).toBeNull()
    expect(itemTexts()[0]).toBe('Reply')
  })

  // Порт :1526 — `formatFullSentTime(outboxReadDate.date, true, false)`. До
  // задачи #121 подпись строил `friendlyMsgTime`, у которого выбор языка —
  // тернарник `ru ? … : …`: немецкий, испанский, французский и украинский
  // читали «прочитано» по-английски. Пин держит именно ХЕЛПЕР: у него «сегодня»
  // это ключ `Date.Today`, а не дата, и время отделено ключом-предлогом.
  it('read-date получен — подпись строит `formatFullSentTime` (:1526)', async() => {
    putMirrorPage(KEY, [message(1, { pFlags: { out: true } })])
    const { bubble, content } = makeBubble(1, { out: true })
    container.append(bubble)

    const readAt = new Date()
    readAt.setHours(9, 41, 0, 0)

    const managers = makeManagers()
    managers.chats.getReadDate.mockResolvedValue({ readAt: readAt.toISOString() })
    const menu = new ChatContextMenu(makeChat(), managers)
    menu.attachTo(container)

    rightClick(content)
    await flush()

    const first = menuElement()!.querySelector<HTMLElement>('.btn-menu-item-text')!
    expect(first.textContent).toBe('Today at 09:41')
    // Части — ЖИВЫЕ узлы ядра: «Сегодня» и предлог переводятся, дата и время
    // переписывают себя на смену языка. Склейка строкой дала бы тот же текст,
    // поэтому проверяется и структура.
    expect(first.querySelectorAll('.i18n').length).toBeGreaterThan(2)
  })

  // `readAt` приезжает СТРОКОЙ с нашего провода (`ReadDateResult`,
  // `chatsManager.ts:62`), тогда как у оригинала это `int` из MTProto. Битая
  // строка даёт `NaN`, а `formatFullSentTime(NaN)` бросает `RangeError` из
  // `Intl` — здесь, внутри `.then()` без `catch`, это давало бы unhandled
  // rejection и ВЕЧНЫЙ ШИММЕР на месте подписи. Снесённый отсюда
  // `friendlyMsgTime` такую защиту имел (`friendlyTime.ts:6`), и порт её снял.
  it('битый read-date не роняет обработчик — пункт убирается, шиммера не остаётся', async() => {
    putMirrorPage(KEY, [message(1, { pFlags: { out: true } })])
    const { bubble, content } = makeBubble(1, { out: true })
    container.append(bubble)

    const rejections: unknown[] = []
    const onRejection = (e: PromiseRejectionEvent) => { rejections.push(e.reason) }
    window.addEventListener('unhandledrejection', onRejection)

    const managers = makeManagers()
    managers.chats.getReadDate.mockResolvedValue({ readAt: 'не дата' })
    const menu = new ChatContextMenu(makeChat(), managers)
    menu.attachTo(container)

    rightClick(content)
    await flush()
    window.removeEventListener('unhandledrejection', onRejection)

    expect(rejections).toEqual([])
    // Исход тот же, что «read-date недоступен» (:1532-1535): ни пункта, ни его
    // разделителя, ни повисшего шиммера.
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
    const menu = new ChatContextMenu(makeChat(), managers)
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

    const menu = new ChatContextMenu(makeChat({ peerId: CHANNEL }), makeManagers())
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

    const chat = makeChat()
    chat.selection.toggleByElement(bubble)
    expect(chat.selection.isSelecting).toBe(true)

    const menu = new ChatContextMenu(chat, makeManagers())
    menu.attachTo(container)

    rightClick(content)
    await flush()

    // tweb :1316-1318, :1442-1444 — «Переслать/Удалить выбранные» сверяются с
    // кнопками панели выделения, она уже собрана (`ChatSelection.onToggleSelection`)
    expect(itemTexts()).toEqual(['Copy selected', 'Forward selected', 'Clear selection', 'Delete selected'])
  })
})

describe('ChatContextMenu — действия пунктов', () => {
  async function openOn(mid: number, options: { chat?: TestChatOptions, target?: 'content' } = {}) {
    const { bubble, content } = makeBubble(mid)
    container.append(bubble)
    const initMessageReply = vi.fn()
    const chat = makeChat({ ...options.chat, input: { initMessageReply, ...options.chat?.input } })
    const managers = makeManagers()
    const popups = makePopups()
    const menu = new ChatContextMenu(chat, managers)
    menu.attachTo(container)
    rightClick(content)
    await flush()
    return { chat, managers, popups, bubble, initMessageReply }
  }

  function clickItem(text: string) {
    const item = Array.from(menuElement()!.querySelectorAll<HTMLElement>('.btn-menu-item'))
      .find((el) => el.querySelector('.btn-menu-item-text')?.textContent === text)
    expect(item, `пункт «${text}» не найден`).toBeTruthy()
    item!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
  }

  it('«Ответить» зовёт композер ответом на сообщение и закрывает меню (:1861-1872)', async() => {
    putMirrorPage(KEY, [message(1)])
    const { initMessageReply } = await openOn(1)

    const element = menuElement()!
    clickItem('Reply')

    expect(initMessageReply).toHaveBeenCalledWith({ replyToMsgId: 1 })
    expect(element.classList.contains('active')).toBe(false)
  })

  it('«Удалить» отдаёт попапу ВЕСЬ альбом, а не один номер (:2054-2065)', async() => {
    putMirrorPage(KEY, [
      message(10, { grouped_id: 99 }),
      message(11, { grouped_id: 99 }),
    ])
    const { popups } = await openOn(10)

    clickItem('Delete')

    expect(popups.showDeleteMessagesPopup).toHaveBeenCalledTimes(1)
    expect(popups.showDeleteMessagesPopup).toHaveBeenCalledWith(PEER, [10, 11], ChatType.Chat, undefined, expect.any(Function))
  })

  it('«Переслать» открывает попап пересылки альбомом (:2032-2044)', async() => {
    putMirrorPage(KEY, [
      message(10, { grouped_id: 99 }),
      message(11, { grouped_id: 99 }),
    ])
    const { popups } = await openOn(10)

    clickItem('Forward')

    expect(popups.showForwardPopup).toHaveBeenCalledTimes(1)
    expect(popups.showForwardPopup).toHaveBeenCalledWith({ [PEER]: [10, 11] })
  })

  it('«Закрепить» открывает попап закрепления (:2016-2018)', async() => {
    putMirrorPage(KEY, [message(1)])
    const { popups } = await openOn(1)

    clickItem('Pin')

    expect(popups.showPinMessagePopup).toHaveBeenCalledTimes(1)
    expect(popups.showPinMessagePopup).toHaveBeenCalledWith(PEER, 1)
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
    const menu = new ChatContextMenu(makeChat({ peerId: GROUP }), makeManagers())
    menu.attachTo(container)
    rightClick(content)
    await flush()

    // Текст пункта — ключ оригинала с формой числа (`Chat.Context.ReactedFast` = «%d Reacted»).
    expect(itemTexts()).toContain('2 Reacted')
    const item = Array.from(menuElement()!.querySelectorAll<HTMLElement>('.btn-menu-item'))
      .find((el) => el.querySelector('.btn-menu-item-text')?.textContent === '2 Reacted')!
    const click = new MouseEvent('click', { bubbles: true, cancelable: true, clientX: 42, clientY: 84 })
    item.dispatchEvent(click)

    expect(popups.showReactedListPopup).toHaveBeenCalledWith(expect.objectContaining({ id: 1, peerId: GROUP }), { x: 42, y: 84 })
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
      // окно `chat_read_mark_expire_period` (tweb :12336) — сообщение свежее
      date: Math.floor(Date.now() / 1000) - 60,
      ...extra,
    })
  }

  function upsertGroup() {
    applyPeerOps([{ op: 'upsert', peers: [{ _: 'channel', id: 9, title: 'gr', pFlags: { megagroup: true }, photo: undefined, date: 0 } as never] }])
  }

  async function openInGroup(managers: ReturnType<typeof makeManagers>, popups = makePopups()) {
    const { bubble, content } = makeBubble(1, { out: true, peerId: GROUP })
    container.append(bubble)
    const menu = new ChatContextMenu(makeChat({ peerId: GROUP }), managers)
    menu.attachTo(container)
    rightClick(content)
    await flush()
    return popups
  }

  function viewsItem(): HTMLElement | undefined {
    // пункт `views` — единственный без своего `text` в `setButtons`: его подпись
    // ставит `init`, а иконка приезжает `prepend`-ом (`checks`/`reactions`)
    return Array.from(menuElement()?.querySelectorAll<HTMLElement>('.btn-menu-item') ?? [])
      .find((el) => /Seen|Nobody viewed|Loading/.test(el.querySelector('.btn-menu-item-text')?.textContent ?? ''))
  }

  it('своё сообщение в группе без реакций: пункт спрашивает `messages.viewers` и пишет «Seen by N»', async() => {
    upsertGroup()
    putMirrorPage(KEY, [groupMessage({ pFlags: { out: true } })])

    const managers = makeManagers()
    managers.messages.viewers.mockResolvedValue([11, 12])
    await openInGroup(managers)
    await flush()

    expect(managers.messages.viewers).toHaveBeenCalledWith(GROUP, 1)
    // `MessageSeen` у оригинала: одна — «Seen», больше — «%1$d Seen».
    expect(itemTexts()).toContain('2 Seen')
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
    expect(popups.showReactedListPopup).not.toHaveBeenCalled()
  })

  it('просмотревшие есть — клик по пункту открывает список якорем (:1632-1641, :1245-1251)', async() => {
    upsertGroup()
    putMirrorPage(KEY, [groupMessage({ pFlags: { out: true } })])

    const managers = makeManagers()
    managers.messages.viewers.mockResolvedValue([11, 12])
    const popups = await openInGroup(managers)
    await flush()

    viewsItem()!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: 7, clientY: 9 }))
    expect(popups.showReactedListPopup).toHaveBeenCalledWith(expect.objectContaining({ id: 1, peerId: GROUP }), { x: 7, y: 9 })
  })

  it('чужое сообщение — пункта нет вовсе, `messages.viewers` не спрашивается (appMessagesManager.ts:9109-9123)', async() => {
    upsertGroup()
    putMirrorPage(KEY, [groupMessage()]) // без pFlags.out

    const managers = makeManagers()
    const { bubble, content } = makeBubble(1, { peerId: GROUP })
    container.append(bubble)
    const menu = new ChatContextMenu(makeChat({ peerId: GROUP }), managers)
    menu.attachTo(container)
    rightClick(content)
    await flush()
    await flush()

    expect(viewsItem()).toBeUndefined()
    expect(managers.messages.viewers).not.toHaveBeenCalled()
  })

  // Пороги `chat_read_mark_*` (tweb :12334-12339): сервер за ними отказывает
  // (`usecase/chat/message_pin.go`), и пункт без них висел бы в «Loading».
  it.each([
    ['старше недели', { date: Math.floor(Date.now() / 1000) - 8 * 86400 }, 5],
    ['группа больше порога', {}, 101],
  ])('%s — пункта нет, `messages.viewers` не спрашивается', async(_name, extra, count) => {
    applyPeerOps([{ op: 'upsert', peers: [{ _: 'channel', id: 9, title: 'gr', pFlags: { megagroup: true }, photo: undefined, date: 0, participants_count: count } as never] }])
    putMirrorPage(KEY, [groupMessage({ pFlags: { out: true }, ...extra })])

    const managers = makeManagers()
    await openInGroup(managers)
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
    const menu = new ChatContextMenu(makeChat({ peerId: CHANNEL }), managers)
    menu.attachTo(container)
    rightClick(content)
    await flush()
    await flush()

    // Меню ОТКРЫТО — иначе «пункта нет» ничего не значило бы.
    expect(itemTexts()).toContain('Reply')
    const views = Array.from(menuElement()?.querySelectorAll<HTMLElement>('.btn-menu-item') ?? [])
      .find((el) => /Seen|Nobody viewed|Loading|Reacted/.test(el.querySelector('.btn-menu-item-text')?.textContent ?? ''))
    expect(views).toBeUndefined()
    expect(managers.messages.viewers).not.toHaveBeenCalled()
  })
})

describe('ChatContextMenu — панель быстрых реакций (tweb :1646-1695, :2229-2286)', () => {
  beforeEach(() => {
    vi.mocked(wrapSticker).mockImplementation(() => ({
      render: new Promise(() => {}), width: 28, height: 28, destroy: vi.fn(),
    }))
  })

  it('встраивает панель в меню и оборачивает пункты в `btn-menu-items`', async() => {
    putMirrorPage(KEY, [message(1)])
    const { bubble, content } = makeBubble(1)
    container.append(bubble)

    const menu = new ChatContextMenu(makeChat(), makeReactionManagers('👍', '❤️'))
    menu.attachTo(container)
    rightClick(content)
    await flush()

    const element = menuElement()!
    // tweb :2255-2265 — панель кладётся ПЕРЕД обёрткой пунктов.
    expect(element.classList.contains('has-items-wrapper')).toBe(true)
    const [first, second] = Array.from(element.children)
    expect(first.classList.contains('btn-menu-reactions-container')).toBe(true)
    expect(second.classList.contains('btn-menu-items')).toBe(true)
    expect(second.querySelectorAll('.btn-menu-item').length).toBeGreaterThan(0)
  })

  it('рисует в панели не больше семи реакций каталога (tweb REACTIONS_MAX_LENGTH)', async() => {
    putMirrorPage(KEY, [message(1)])
    const { bubble, content } = makeBubble(1)
    container.append(bubble)

    const emojis = ['1', '2', '3', '4', '5', '6', '7', '8', '9']
    const menu = new ChatContextMenu(makeChat(), makeReactionManagers(...emojis))
    menu.attachTo(container)
    rightClick(content)
    await flush()

    expect(menuElement()!.querySelectorAll('.btn-menu-reactions-reaction')).toHaveLength(7)
  })

  it('без каталога реакций панели в меню нет (пункты остаются без обёртки)', async() => {
    putMirrorPage(KEY, [message(1)])
    const { bubble, content } = makeBubble(1)
    container.append(bubble)

    const menu = new ChatContextMenu(makeChat(), makeManagers())
    menu.attachTo(container)
    rightClick(content)
    await flush()

    const element = menuElement()!
    expect(element.querySelector('.btn-menu-reactions-container')).toBeNull()
    expect(element.classList.contains('has-items-wrapper')).toBe(false)
  })

  it('отступ панели доезжает до позиционирования меню', async() => {
    putMirrorPage(KEY, [message(1)])
    const { bubble, content } = makeBubble(1)
    container.append(bubble)

    const menu = new ChatContextMenu(makeChat(), makeReactionManagers('👍'))
    menu.attachTo(container)
    rightClick(content)
    await flush()
    const withPanel = menuElement()!.style.left
    contextMenuController.close()
    menuElement()!.remove()

    const plain = new ChatContextMenu(makeChat(), makeManagers())
    plain.attachTo(container)
    rightClick(content)
    await flush()
    const withoutPanel = menuElement()!.style.left

    // `getReactionsMenuPadding('horizontal').right = 40` (tweb :2196, :2213)
    // прибавляется к базовым 8 (`positionMenu`, `PADDING_RIGHT`) — это и есть
    // разница в ИТОГОВОЙ координате, а не «функцию позвали с аргументом».
    expect(parseFloat(withoutPanel) - parseFloat(withPanel)).toBe(40)
  })

  it('выбор в панели ставит реакцию и закрывает меню', async() => {
    putMirrorPage(KEY, [message(1)])
    const { bubble, content } = makeBubble(1)
    container.append(bubble)

    const managers = makeReactionManagers('👍', '❤️')
    const menu = new ChatContextMenu(makeChat(), managers)
    menu.attachTo(container)
    rightClick(content)
    await flush()

    menuElement()!.querySelectorAll<HTMLElement>('.btn-menu-reactions-reaction')[1].click()

    expect(managers.messages.react).toHaveBeenCalledWith(PEER, 1, '❤️')
    expect(managers.messages.unreact).not.toHaveBeenCalled()
    expect(menuElement()!.classList.contains('active')).toBe(false)
  })

  it('повторный выбор УЖЕ СВОЕЙ реакции снимает её (tweb appReactionsManager.ts:733-747)', async() => {
    putMirrorPage(KEY, [message(1, {
      reactions: {
        _: 'messageReactions',
        results: [{ _: 'reactionCount', reaction: { _: 'reactionEmoji', emoticon: '👍' }, count: 1, chosen_order: 0 }],
      },
    } as Partial<MyMessage>)])
    const { bubble, content } = makeBubble(1)
    container.append(bubble)

    const managers = makeReactionManagers('👍')
    const menu = new ChatContextMenu(makeChat(), managers)
    menu.attachTo(container)
    rightClick(content)
    await flush()

    menuElement()!.querySelector<HTMLElement>('.btn-menu-reactions-reaction')!.click()

    expect(managers.messages.unreact).toHaveBeenCalledWith(PEER, 1, '👍')
    expect(managers.messages.react).not.toHaveBeenCalled()
  })

  it('направление тоггла решается СОСТОЯНИЕМ НА МОМЕНТ ВЫБОРА, а не сборки меню', async() => {
    // Меню собирается по правому клику, а выбор в панели случается позже —
    // реакция за это время успевает измениться. Оригинал перечитывает сообщение
    // прямо перед отправкой (appReactionsManager.ts:669); стенд повторяет ровно
    // это: меню собралось на «реакции нет», окно уже несёт «моя».
    putMirrorPage(KEY, [message(1)])
    const { bubble, content } = makeBubble(1)
    container.append(bubble)

    const managers = makeReactionManagers('👍')
    const menu = new ChatContextMenu(makeChat(), managers)
    menu.attachTo(container)
    rightClick(content)
    await flush()

    putMirrorPage(KEY, [message(1, {
      reactions: {
        _: 'messageReactions',
        results: [{ _: 'reactionCount', reaction: { _: 'reactionEmoji', emoticon: '👍' }, count: 1, chosen_order: 0 }],
      },
    } as Partial<MyMessage>)])

    menuElement()!.querySelector<HTMLElement>('.btn-menu-reactions-reaction')!.click()

    expect(managers.messages.unreact).toHaveBeenCalledWith(PEER, 1, '👍')
    expect(managers.messages.react).not.toHaveBeenCalled()
  })

  it('над ещё НЕ ОТПРАВЛЕННЫМ сообщением панели нет (tweb :1654 `pFlags.is_outgoing`)', async() => {
    // Дробный номер — наш признак «ещё не отправлено» (`isLocalMessageId`).
    // Реакция по такому номеру ушла бы в сеть с локальным идентификатором и
    // молча пропала бы; у оригинала панель над ним не поднимается вовсе.
    putMirrorPage(KEY, [message(1.5)])
    const { bubble, content } = makeBubble(1.5)
    container.append(bubble)

    const menu = new ChatContextMenu(makeChat(), makeReactionManagers('👍'))
    menu.attachTo(container)
    rightClick(content)
    await flush()

    // Меню ОТКРЫТО — иначе «панели нет» ничего не значило бы.
    const element = menuElement()!
    expect(element.classList.contains('active')).toBe(true)
    expect(element.querySelector('.btn-menu-reactions-container')).toBeNull()
  })

  it('отступы панели — числа оригинала (tweb :2192-2218)', () => {
    // Прямой пин на функцию, а не через `positionMenu`: тот читает только
    // `right`/`bottom`/`left` (`helpers/positionMenu.ts:83-91` — `top` не
    // читает и сам оригинал), а `left` — лишь в мобильной ветке (`side ===
    // 'right'`, :123). Через позиционирование проверяем `right` (стенд выше);
    // остальные два числа наблюдать больше нечем.
    expect(ChatContextMenu.getReactionsMenuPadding()).toEqual({ top: 44, right: 40, left: 56 })
  })
})

describe('ChatContextMenu — «Выбрать» у служебного сообщения (tweb e9428f2a9)', () => {
  it('служебное сообщение выделяется, пункт «Выбрать» в меню есть', async() => {
    putMirrorPage(KEY, [{
      _: 'messageService',
      id: 1,
      pFlags: {},
      peerId: PEER,
      fromId: PEER,
      peer_id: { _: 'peerUser', user_id: PEER },
      date: 1700000001,
      action: { _: 'messageActionChatJoinedByLink', inviter_id: PEER },
    } as unknown as MyMessage])
    const { bubble, content } = makeBubble(1, { classes: ['service'] })
    container.append(bubble)

    const menu = new ChatContextMenu(makeChat(), makeManagers())
    menu.attachTo(container)

    rightClick(content)
    await flush()

    expect(itemTexts()).toContain('Select')
  })
})

// П-5 (Б-28): пункты действий вернулись — их `verify` 1:1 с tweb 812502980
// (`contextMenu.ts:1088-1093` факт-чек, :1222-1247 закреп, :1302-1310
// пересылка, :1336-1353 жалоба, :1424-1427 удаление), а клик зовёт попап tweb.
describe('ChatContextMenu — пункты действий: видимость по verify (П-5)', () => {
  const GROUP = -9

  function upsertChannel(id: number, pFlags: Record<string, true>, adminRights?: Record<string, true>) {
    applyPeerOps([{ op: 'upsert', peers: [{
      _: 'channel', id, title: 'c', pFlags, photo: undefined, date: 0,
      ...(adminRights ? { admin_rights: { _: 'chatAdminRights', pFlags: adminRights } } : {}),
    } as never] }])
  }

  async function itemsOn(peerId: number, msg: MyMessage, out = false): Promise<string[]> {
    putMirrorPage(KEY, [msg])
    const { bubble, content } = makeBubble(msg.id, { peerId, out })
    container.append(bubble)
    const menu = new ChatContextMenu(makeChat({ peerId }), makeManagers())
    menu.attachTo(container)
    rightClick(content)
    await flush()
    return itemTexts()
  }

  it('своё в личке: правка, закреп, пересылка, удаление; жалобы нет', async() => {
    const texts = await itemsOn(PEER, message(1, { pFlags: { out: true } }), true)
    expect(texts).toEqual(expect.arrayContaining(['Edit', 'Pin', 'Forward', 'Delete']))
    expect(texts).not.toContain('Report')
  })

  it('чужое в личке: закреп, пересылка, удаление (личка — всегда, canDeleteMessage); жалобы нет', async() => {
    const texts = await itemsOn(PEER, message(1))
    expect(texts).toEqual(expect.arrayContaining(['Pin', 'Forward', 'Delete']))
    expect(texts).not.toContain('Report')
    expect(texts).not.toContain('Edit')
  })

  it('закреплённое: «Unpin» вместо «Pin» (:1238-1247)', async() => {
    const texts = await itemsOn(PEER, message(1, { pFlags: { pinned: true } }))
    expect(texts).toContain('Unpin')
    expect(texts).not.toContain('Pin')
  })

  it('канал без прав: пересылка и жалоба есть; закрепа, удаления и факт-чека нет', async() => {
    upsertChannel(7, { broadcast: true })
    const texts = await itemsOn(CHANNEL, message(1, { peerId: CHANNEL, fromId: CHANNEL }))
    expect(texts).toEqual(expect.arrayContaining(['Forward', 'Report']))
    expect(texts).not.toContain('Pin')
    expect(texts).not.toContain('Delete')
    expect(texts).not.toContain('Add Fact Check')
  })

  it('канал, я админ с правами закрепа и удаления: закреп и удаление есть, факт-чека без post_messages нет', async() => {
    upsertChannel(7, { broadcast: true }, { pin_messages: true, delete_messages: true })
    const texts = await itemsOn(CHANNEL, message(1, { peerId: CHANNEL, fromId: CHANNEL }))
    expect(texts).toEqual(expect.arrayContaining(['Pin', 'Forward', 'Report', 'Delete']))
    // A5-28: правило сервера — post_messages; пункт не показывается тому, кому
    // сервер откажет.
    expect(texts).not.toContain('Add Fact Check')
  })

  it('канал, я админ с post_messages: факт-чек есть', async() => {
    upsertChannel(7, { broadcast: true }, { post_messages: true })
    const texts = await itemsOn(CHANNEL, message(1, { peerId: CHANNEL, fromId: CHANNEL }))
    expect(texts).toContain('Add Fact Check')
  })

  it('факт-чек уже стоит — пункт «Edit Fact Check» (:1090)', async() => {
    upsertChannel(7, { broadcast: true }, { post_messages: true })
    const texts = await itemsOn(CHANNEL, message(1, {
      peerId: CHANNEL, fromId: CHANNEL,
      factcheck: { _: 'factCheck', text: { _: 'textWithEntities', text: 'old', entities: [] } },
    } as Partial<MyMessage>))
    expect(texts).toContain('Edit Fact Check')
  })

  it('мегагруппа, чужое, я не админ: жалоба есть, закрепа и удаления нет', async() => {
    upsertChannel(9, { megagroup: true })
    const texts = await itemsOn(GROUP, message(1, { peerId: GROUP, fromId: 77 }))
    expect(texts).toContain('Report')
    expect(texts).not.toContain('Pin')
    expect(texts).not.toContain('Delete')
  })

  it('ещё не отправленное (дробный номер): ни закрепа, ни пересылки, ни удаления', async() => {
    const texts = await itemsOn(PEER, message(1.5, { pFlags: { out: true } }), true)
    expect(texts).not.toContain('Pin')
    expect(texts).not.toContain('Forward')
    expect(texts).not.toContain('Delete')
  })
})

describe('ChatContextMenu — действия П-5: попап и RPC', () => {
  function clickText(text: string, init: MouseEventInit = {}) {
    const item = Array.from(menuElement()!.querySelectorAll<HTMLElement>('.btn-menu-item'))
      .find((el) => el.querySelector('.btn-menu-item-text')?.textContent === text)
    expect(item, `пункт «${text}» не найден`).toBeTruthy()
    item!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ...init }))
  }

  async function openChannelAsAdmin(msg: MyMessage, managers = makeManagers()) {
    applyPeerOps([{ op: 'upsert', peers: [{
      _: 'channel', id: 7, title: 'c', pFlags: { broadcast: true }, photo: undefined, date: 0,
      admin_rights: { _: 'chatAdminRights', pFlags: { pin_messages: true, delete_messages: true, post_messages: true } },
    } as never] }])
    putMirrorPage(KEY, [msg])
    const { bubble, content } = makeBubble(msg.id, { peerId: CHANNEL })
    container.append(bubble)
    const menu = new ChatContextMenu(makeChat({ peerId: CHANNEL }), managers)
    menu.attachTo(container)
    rightClick(content)
    await flush()
    return managers
  }

  it('«Открепить» зовёт PopupPinMessage с unpin (:2224-2226)', async() => {
    putMirrorPage(KEY, [message(1, { pFlags: { pinned: true } })])
    const { bubble, content } = makeBubble(1)
    container.append(bubble)
    const menu = new ChatContextMenu(makeChat(), makeManagers())
    menu.attachTo(container)
    rightClick(content)
    await flush()

    clickText('Unpin')
    expect(popups.showPinMessagePopup).toHaveBeenCalledWith(PEER, 1, true)
  })

  it('«Пожаловаться» зовёт showMessageReport одним сообщением (:1339-1348)', async() => {
    await openChannelAsAdmin(message(1, { peerId: CHANNEL, fromId: CHANNEL }))
    clickText('Report')
    expect(popups.showMessageReport).toHaveBeenCalledTimes(1)
    expect(popups.showMessageReport).toHaveBeenCalledWith(CHANNEL, [1], undefined)
  })

  it('«Удалить» в канале отдаёт попапу пир, номер и тип чата (:2269-2287)', async() => {
    await openChannelAsAdmin(message(1, { peerId: CHANNEL, fromId: CHANNEL }))
    clickText('Delete')
    expect(popups.showDeleteMessagesPopup).toHaveBeenCalledWith(CHANNEL, [1], ChatType.Chat, undefined, expect.any(Function))
  })

  it('факт-чек: попап с полем, «Done» шлёт ОДИН setFactCheck с текстом (:2110-2162)', async() => {
    const managers = await openChannelAsAdmin(message(1, { peerId: CHANNEL, fromId: CHANNEL }))
    clickText('Add Fact Check')
    await flush()

    const popup = document.querySelector('.popup.popup-confirmation')!
    expect(popup.querySelector('.popup-title')!.textContent).toBe('Fact Check')
    const input = popup.querySelector<HTMLElement>('.input-field-input')!
    input.textContent = 'Проверено'
    input.dispatchEvent(new Event('input', { bubbles: true }))

    const done = Array.from(popup.querySelectorAll<HTMLButtonElement>('.popup-buttons > button'))
      .find((button) => button.textContent === 'Done')!
    done.dispatchEvent(new MouseEvent(CLICK_EVENT_NAME, { bubbles: true }))
    await flush()

    expect(managers.messages.setFactCheck).toHaveBeenCalledTimes(1)
    expect(managers.messages.setFactCheck).toHaveBeenCalledWith(CHANNEL, 1, 'Проверено')
    expect(managers.messages.removeFactCheck).not.toHaveBeenCalled()
  })

  it('факт-чек: стёртый текст — кнопка «Remove», снимает проверку (:2119-2128, :2152-2156)', async() => {
    const managers = await openChannelAsAdmin(message(1, {
      peerId: CHANNEL, fromId: CHANNEL,
      factcheck: { _: 'factCheck', text: { _: 'textWithEntities', text: 'old', entities: [] } },
    } as Partial<MyMessage>))
    clickText('Edit Fact Check')
    await flush()

    const popup = document.querySelector('.popup.popup-confirmation')!
    const input = popup.querySelector<HTMLElement>('.input-field-input')!
    expect(input.textContent).toBe('old')
    input.textContent = ''
    input.dispatchEvent(new Event('input', { bubbles: true }))

    const action = popup.querySelector<HTMLButtonElement>('.popup-buttons > button.danger')!
    expect(action.textContent).toBe('Remove')
    action.dispatchEvent(new MouseEvent(CLICK_EVENT_NAME, { bubbles: true }))
    await flush()

    expect(managers.messages.removeFactCheck).toHaveBeenCalledTimes(1)
    expect(managers.messages.removeFactCheck).toHaveBeenCalledWith(CHANNEL, 1)
    expect(managers.messages.setFactCheck).not.toHaveBeenCalled()
  })
})

// Лента отложенных (`ChatType.Scheduled`, tweb :959-972, гейты Reply/Pin/Forward —
// :1017, :1235, :1310): «Отправить сейчас» → подтверждение (`popups/sendNow.ts`) →
// `sendScheduledMessages`; правка текста отложенного скрыта (Б-92).
describe('ChatContextMenu — лента отложенных', () => {
  const SCHEDULED_KEY = `${PEER}_scheduled`

  async function openScheduled(mid: number) {
    putMirrorPage(SCHEDULED_KEY, [message(mid, { pFlags: { out: true, is_scheduled: true } })])
    const { bubble, content } = makeBubble(mid, { out: true })
    container.append(bubble)
    const chat = makeChat({ type: ChatType.Scheduled, messagesStorageKey: SCHEDULED_KEY })
    const managers = { ...makeManagers(), messages: { ...makeManagers().messages, sendScheduledMessages: vi.fn().mockResolvedValue(undefined) } }
    const menu = new ChatContextMenu(chat, managers)
    menu.attachTo(container)
    rightClick(content)
    await flush()
    return { managers }
  }

  it('пункты: «Отправить сейчас» первым; ответа, правки, закрепа и пересылки нет', async() => {
    await openScheduled(1)
    const items = itemTexts()
    expect(items[0]).toBe('Send Now')
    expect(items).not.toContain('Reply')
    expect(items).not.toContain('Edit')
    expect(items).not.toContain('Pin')
    expect(items).not.toContain('Forward')
    expect(items).toContain('Delete')
  })

  it('«Отправить сейчас» спрашивает подтверждение и шлёт `sendScheduledMessages`', async() => {
    const { managers } = await openScheduled(1)
    const item = Array.from(menuElement()!.querySelectorAll<HTMLElement>('.btn-menu-item'))
      .find((el) => el.querySelector('.btn-menu-item-text')?.textContent === 'Send Now')!
    item.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    expect(managers.messages.sendScheduledMessages).not.toHaveBeenCalled()

    const popup = document.querySelector<HTMLElement>('.popup-peer.popup-delete-chat')
    expect(popup).toBeTruthy()
    expect(popup!.querySelector('.popup-title')?.textContent).toBe('Send Message Now')
    const send = Array.from(popup!.querySelectorAll<HTMLElement>('.popup-button'))
      .find((button) => button.textContent === 'Send')!
    send.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))

    expect(managers.messages.sendScheduledMessages).toHaveBeenCalledWith(PEER, [1])
  })

  it('в обычном чате пункта «Отправить сейчас» нет', async() => {
    putMirrorPage(KEY, [message(1)])
    const { bubble, content } = makeBubble(1)
    container.append(bubble)
    const managers = { ...makeManagers(), messages: { ...makeManagers().messages, sendScheduledMessages: vi.fn() } }
    const menu = new ChatContextMenu(makeChat(), managers)
    menu.attachTo(container)
    rightClick(content)
    await flush()
    expect(itemTexts()).not.toContain('Send Now')
  })
})
