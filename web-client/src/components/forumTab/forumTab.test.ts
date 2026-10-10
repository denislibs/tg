// Пины форум-таба (задача 1-6 волны 7): `GroupForumTab` + `AutonomousForumTopicList`
// в настоящем владельце списка (`lib/appDialogsManager.ts`: `toggleForumTab`,
// `toggleForumTabByPeerId`, `.topics-slider`, запись навигации `'forum'`) и настоящей
// колонке (`appSidebarLeft`). Подменены только геометрия скроллеров (её читает ядро
// виртуального списка), кадры анимации и ответ хранилища тем воркера
// (`forumTopics.getForumTopics`); живые изменения — операции `rt:forum_topic_op`.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import '@/test/lang'
import {
  FakeResizeObserver, flushFrames, installFrames, mountOwner, resetStores, settle, uninstallFrames, type Mounted,
} from '@lib/appDialogsManager.testkit'
import { applyPeerOps, resetPeerMirror } from '@core/peerCache'
import { makeDialog } from '@core/dialogs/testDialog'
import { makeMessage } from '@core/messages/testMessage'
import { ALL_FOLDER_ID } from '@core/folderIds'
import type { ForumTopic } from '@core/dialogs/forumTopic'
import { GENERAL_TOPIC_ID, generateMessageId } from '@core/history/messageId'
import { RT } from '@core/realtime/events'
import rootScope from '@lib/rootScope'
import type { Dialog } from '@core/models'
import { useChatsStore } from '@stores/chatsStore'
import appImManager from '@lib/appImManager'
import appNavigationController from '@core/navigation/appNavigationController'
import appSidebarLeft from '@components/sidebarLeft'
import SliderSuperTab from '@components/sliderTab'
import { GroupForumTab } from './groupForumTab'

const HOST_HEIGHT = 720
const FORUM_ID = -50
const FORUM_CHANNEL = { _: 'channel' as const, id: 50, title: 'Форум', photo: { _: 'chatPhotoEmpty' as const }, date: 0, participants_count: 7, pFlags: { megagroup: true as const, forum: true as const } }
const user = (id: number, name = 'U' + id) => ({ _: 'user' as const, id, first_name: name, pFlags: {} })

let mounted: Mounted | undefined

/** Тема хранилища: номер — клиентский (`generateMessageId`), как в `toForumTopic`. */
const topic = (id: number, over: Partial<ForumTopic> = {}): ForumTopic => ({
  _: 'forumTopic',
  id: generateMessageId(id),
  peerId: FORUM_ID,
  pFlags: {},
  date: 1_700_000_000,
  title: 'Тема ' + id,
  icon_color: 1,
  fromId: 1,
  top_message: generateMessageId(id),
  read_inbox_max_id: 0,
  read_outbox_max_id: 0,
  unread_count: 0,
  unread_mentions_count: 0,
  unread_reactions_count: 0,
  notify_settings: { _: 'peerNotifySettings' },
  index: 0,
  lastMessage: makeMessage({ id: generateMessageId(id), peerId: FORUM_ID, fromId: 1, text: 'текст ' + id, date: 1_700_000_000 }),
  ...over,
})

const topicOps = (ops: Parameters<typeof rootScope.dispatchEventSingle<typeof RT.forumTopicOp>>[1]['ops']) =>
  rootScope.dispatchEventSingle(RT.forumTopicOp, { ops })

function seed(dialogs: Dialog[]) {
  useChatsStore.setState({ dialogs: [], dialogIndexById: {}, loaded: true })
  useChatsStore.getState().applyDialogOps([{ op: 'reset', items: dialogs.map((dialog, i) => ({ dialog, index: (1000 - i) * 0x10000 })) }])
}

const dialogOf = (peerId: PeerId) =>
  makeDialog({ peerId, lastMessage: makeMessage({ id: 1, peerId, fromId: 1, text: 'm' + peerId, date: 1_700_000_000 }) })

async function start(topics: ForumTopic[] = [topic(1), topic(2)]) {
  applyPeerOps([{ op: 'upsert', peers: [FORUM_CHANNEL, user(1), user(2)] }])
  seed([dialogOf(FORUM_ID), dialogOf(2)])
  mounted = mountOwner({ getDialogs: async () => ({ dialogs: useChatsStore.getState().dialogs, count: 2, isEnd: true }) })
  // порядок — индекс хранилища: первая в массиве — выше
  const indexed = topics.map((t, i) => ({ ...t, index: t.index || (1000 - i) * 0x10000 }))
  mounted.hooks.managers.forumTopics.getForumTopics.mockImplementation(async (_peerId: number, offsetIndex?: number) =>
    offsetIndex !== undefined ? { dialogs: [], count: indexed.length, isEnd: true } : { dialogs: indexed, count: indexed.length, isEnd: true })
  await settle()
  await vi.waitFor(() => expect(row(FORUM_ID)).toBeDefined())
  return mounted
}

const xd = () => mounted!.manager.xds.get(ALL_FOLDER_ID)!
const row = (peerId: PeerId) => xd().getDialogElement(peerId)?.dom.listEl
const press = (el: HTMLElement) => el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }))
const slider = () => document.querySelector<HTMLElement>('.topics-slider')!
const forumTab = () => mounted!.manager.forumTab as GroupForumTab | undefined
const topicRows = () => Array.from(forumTab()!.xd.sortedList.list.querySelectorAll<HTMLElement>('a.chatlist-chat'))
.sort((a, b) => parseFloat(a.style.top) - parseFloat(b.style.top))
const forumItems = () => {
  let n = 0
  appNavigationController.findItem((item) => {
    if(item.type === 'forum') ++n
    return false
  })
  return n
}

async function openForum() {
  press(row(FORUM_ID)!)
  await vi.waitFor(() => {
    flushFrames()
    expect(forumTab()).toBeDefined()
    expect(forumItems()).toBe(1)
  })
  await vi.waitFor(() => expect(topicRows()).toHaveLength(forumTab()!.xd.sortedList.itemsLength()))
}

beforeEach(() => {
  resetStores()
  resetPeerMirror()
  expect(installFrames(), 'очередь fastRaf досталась этому файлу непрокрученной').toBe(true)
  vi.stubGlobal('ResizeObserver', FakeResizeObserver)
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function(this: HTMLElement) {
    if(this.classList.contains('scrollable')) {
      return { width: 360, height: HOST_HEIGHT, top: 0, left: 0, right: 360, bottom: HOST_HEIGHT, x: 0, y: 0, toJSON() {} } as DOMRect
    }
    return { width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0, x: 0, y: 0, toJSON() {} } as DOMRect
  })
  vi.spyOn(appImManager, 'selectTab').mockResolvedValue(undefined)
})

afterEach(() => {
  mounted?.manager.destroy()
  mounted = undefined
  appNavigationController.spliceItems(0, Infinity)
  uninstallFrames()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  document.body.replaceChildren()
  resetStores()
  resetPeerMirror()
})

describe('клик по форуму открывает таб тем поверх списка (tweb `toggleForumTabByPeerId` :1926-2053)', () => {
  it('плавающий `GroupForumTab` в `.topics-slider`, переход `is-visible`, колонка `is-forum-visible`, строка `is-forum-open`', async () => {
    const setPeer = vi.spyOn(appImManager, 'setPeer').mockResolvedValue(undefined)
    await start()
    await openForum()

    const tab = forumTab()!
    expect(tab).toBeInstanceOf(GroupForumTab)
    expect(slider().parentElement!.classList.contains('item-main')).toBe(true)
    expect(tab.container.parentElement).toBe(slider())
    expect(tab.container.classList.contains('topics-container')).toBe(true)
    expect(tab.container.classList.contains('is-floating')).toBe(true)
    expect(tab.container.classList.contains('topic-dialogs-override')).toBe(true)
    // `forumTab.ts:44-55` — `SetTransition` класса `is-visible` вперёд
    expect(tab.container.classList.contains('is-visible')).toBe(true)
    expect(tab.container.classList.contains('backwards')).toBe(false)
    // `transitionDrawersParent` (:1878-1893) и `has-forum-open` колонки (`sidebarLeft/index.ts:555`)
    const column = document.getElementById('column-left')!
    expect(column.classList.contains('is-forum-visible')).toBe(true)
    expect(column.classList.contains('has-forum-open')).toBe(true)
    expect(row(FORUM_ID)!.classList.contains('is-forum-open')).toBe(true)
    // чат форума не открыт — открыт таб
    expect(setPeer).not.toHaveBeenCalled()
    expect(mounted!.hooks.managers.forumTopics.getForumTopics).toHaveBeenCalledWith(FORUM_ID, undefined)
    // шапка: название группы и подпись
    expect(tab.title.textContent).toBe('Форум')
    expect(tab.subtitle.textContent).toContain('7')
  })

  it('строка темы — `DialogElement` без аватара: значок и название темы, номер темы в `data-thread-id`', async () => {
    await start([
      topic(1, { unread_count: 3, pFlags: { pinned: true } }),
      topic(2, { pFlags: { closed: true }, notify_settings: { _: 'peerNotifySettings', mute_until: 0x7FFFFFFF } }),
    ])
    await openForum()

    const [first, second] = topicRows()
    expect(first.dataset.peerId).toBe('' + FORUM_ID)
    expect(first.dataset.threadId).toBe('' + generateMessageId(1))
    expect(first.querySelector('.dialog-avatar')).toBeNull()
    expect(first.querySelector('.peer-title .topic-icon')).not.toBeNull()
    expect(first.querySelector('.peer-title-inner')!.textContent).toBe('Тема 1')
    await vi.waitFor(() => {
      expect(first.querySelector('.dialog-subtitle-badge-unread')!.textContent).toBe('3')
      // закрытая тема — замок вместо галочек (`:2763`)
      expect(second.querySelector('.message-status .tgico-premium_lock, .message-status [class*="premium_lock"]')).not.toBeNull()
      expect(second.classList.contains('is-muted')).toBe(true)
    })
    // бейджа на аватаре у темы нет (`:2765-2772`): аватара нет
    expect(first.querySelector('.avatar-badge')).toBeNull()
  })

  it('повторный клик по тому же форуму закрывает таб; запись `forum` одна', async () => {
    await start()
    await openForum()
    const tab = forumTab()!

    press(row(FORUM_ID)!)
    await vi.waitFor(() => expect(mounted!.manager.forumTab).toBeUndefined())
    expect(forumItems()).toBe(0)
    expect(tab.container.classList.contains('backwards')).toBe(true)
    expect(row(FORUM_ID)!.classList.contains('is-forum-open')).toBe(false)
  })

  it('чат главного списка закрывает открытый форум-таб (:2275-2281)', async () => {
    const setPeer = vi.spyOn(appImManager, 'setPeer').mockResolvedValue(undefined)
    await start()
    await openForum()

    press(row(2)!)
    await vi.waitFor(() => expect(mounted!.manager.forumTab).toBeUndefined())
    expect(setPeer).toHaveBeenCalledWith(expect.objectContaining({ peerId: 2 }))
    expect(forumItems()).toBe(0)
  })

  it('по концу ухода таб снят из DOM и реестра владельца (`onCloseAfterTimeout` → `destroy`)', async () => {
    await start()
    await openForum()
    const tab = forumTab()!

    void mounted!.manager.toggleForumTab()
    await vi.waitFor(() => {
      flushFrames()
      expect(tab.container.isConnected).toBe(false)
    }, { timeout: 2000 })
    expect(mounted!.manager.hasForumOpenFor(FORUM_ID)).toBe(false)
  })
})

describe('вкладкой колонки, когда в ней уже открыта вкладка (:1995-2034)', () => {
  it('форум открывается вкладкой слайдера (не плавающей), повторный клик её не дублирует', async () => {
    class SomeTab extends SliderSuperTab {}
    await start()
    await appSidebarLeft.createTab(SomeTab).open()

    press(row(FORUM_ID)!)
    await vi.waitFor(() => {
      const history = appSidebarLeft.getHistory()
      expect(history[history.length - 1]).toBeInstanceOf(GroupForumTab)
    })
    const history = appSidebarLeft.getHistory()
    const tab = history[history.length - 1] as GroupForumTab
    expect(tab.container.classList.contains('is-floating')).toBe(false)
    expect(slider().children).toHaveLength(0)
    expect(mounted!.manager.forumTab).toBeUndefined()

    press(row(FORUM_ID)!)
    await settle()
    expect(appSidebarLeft.getHistory().filter((t) => t instanceof GroupForumTab)).toHaveLength(1)
    appSidebarLeft.closeAllTabs()
  })
})

describe('Esc/Back закрывает форум-таб (запись навигации `forum`, :1853-1866)', () => {
  it('Esc снимает запись и закрывает таб; второй Esc форум не трогает', async () => {
    await start()
    await openForum()
    const column = document.getElementById('column-left')!

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    await vi.waitFor(() => expect(mounted!.manager.forumTab).toBeUndefined())
    expect(forumItems()).toBe(0)
    expect(column.classList.contains('backwards')).toBe(true)

    // второй Esc: форума уже нет, его запись не всплывает снова
    const toggle = vi.spyOn(mounted!.manager, 'toggleForumTab')
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    await settle()
    expect(toggle).not.toHaveBeenCalled()
  })

  it('закрытие крестиком тоже снимает запись: Back после него до форума не доходит', async () => {
    await start()
    await openForum()

    forumTab()!.closeBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await vi.waitFor(() => expect(mounted!.manager.forumTab).toBeUndefined())
    expect(forumItems()).toBe(0)
  })
})

describe('открытие темы', () => {
  it('клик по теме — `appImManager.setPeer({peerId, threadId})`; таб остаётся открытым', async () => {
    const setPeer = vi.spyOn(appImManager, 'setPeer').mockResolvedValue(undefined)
    await start([topic(1), topic(2, { pFlags: { closed: true } })])
    await openForum()

    press(topicRows()[1])
    expect(setPeer).toHaveBeenCalledTimes(1)
    expect(setPeer.mock.calls[0][0]).toEqual({
      peerId: FORUM_ID,
      threadId: generateMessageId(2),
      type: 'chat',
    })
    expect(mounted!.manager.forumTab).toBeDefined()
    expect(forumItems()).toBe(1)
  })

  // tweb: General — тема с номером `GENERAL_TOPIC_ID` (серверный 1, constants.ts:26);
  // клик открывает её тред, как любую тему (groupForumTab.ts:116-127 спеки Ф-5 п. 1)
  it('General — строка темы с номером GENERAL_TOPIC_ID, клик открывает её тред', async () => {
    const setPeer = vi.spyOn(appImManager, 'setPeer').mockResolvedValue(undefined)
    await start([topic(1, { id: GENERAL_TOPIC_ID, title: 'General' }), topic(2)])
    await openForum()

    const general = topicRows().find((el) => el.dataset.threadId === '' + GENERAL_TOPIC_ID)!
    expect(general).toBeDefined()
    expect(general.querySelector('.dialog-avatar')).toBeNull()
    expect(general.querySelector('.peer-title-inner')!.textContent).toBe('General')
    // значок General — по номеру (tweb messageActionTextNewUnsafe.ts:108)
    expect(general.querySelector('.topic-icon-general')).not.toBeNull()

    press(general)
    expect(setPeer).toHaveBeenCalledTimes(1)
    expect(setPeer.mock.calls[0][0]).toEqual({ peerId: FORUM_ID, threadId: GENERAL_TOPIC_ID, type: 'chat' })
  })

  it('`peer_changed` с темой подсвечивает её строку в табе, а не строку форума', async () => {
    await start()
    await openForum()
    const [, second] = topicRows()

    appImManager.dispatchEvent('peer_changed', { peerId: FORUM_ID, threadId: generateMessageId(2) } as never)
    expect(second.classList.contains('active')).toBe(true)
    expect(row(FORUM_ID)!.classList.contains('active')).toBe(false)

    appImManager.dispatchEvent('peer_changed', { peerId: 2 } as never)
    expect(second.classList.contains('active')).toBe(false)
  })
})

describe('скрытые темы (tweb `CAN_HIDE_TOPIC = false`, `forumTopics.ts:20`, `:122-125`)', () => {
  it('скрытая тема — обычная строка списка, отдельной секции нет', async () => {
    await start([topic(1), topic(2, { pFlags: { hidden: true } }), topic(3)])
    await openForum()

    expect(topicRows().map((el) => +el.dataset.threadId!)).toEqual([1, 2, 3].map((id) => generateMessageId(id)))
    expect(forumTab()!.container.querySelectorAll('.chatlist')).toHaveLength(1)
  })

  it('обновление, которое делает тему скрытой, снимает её строку (`canUpdateDialog`)', async () => {
    await start([topic(1), topic(2)])
    await openForum()
    const list = forumTab()!.xd

    const hidden = { ...list.getDialog(generateMessageId(2))!, pFlags: { hidden: true as const } }
    list.updateDialog(hidden)
    await vi.waitFor(() => expect(topicRows().map((el) => +el.dataset.threadId!)).toEqual([generateMessageId(1)]))
  })
})

// Живые события тем — операции хранилища тем воркера (tweb forumTopics.ts:40-104):
// список не перечитывается, строка меняется значением от владельца.
describe('живые события тем (Б-54)', () => {
  it('`update` переименовывает строку и поднимает её по индексу, список не перечитывается', async () => {
    await start([topic(1), topic(2)])
    await openForum()
    const getForumTopics = mounted!.hooks.managers.forumTopics.getForumTopics
    const calls = getForumTopics.mock.calls.length

    const renamed = { ...forumTab()!.xd.getDialog(generateMessageId(2))!, title: 'Новое имя', index: 5000 * 0x10000 }
    topicOps([{ op: 'update', peerId: FORUM_ID, topics: [renamed] }])
    await vi.waitFor(() => {
      flushFrames()
      const [first] = topicRows()
      expect(first.dataset.threadId).toBe('' + generateMessageId(2))
      expect(first.querySelector('.peer-title-inner')!.textContent).toBe('Новое имя')
    })
    expect(getForumTopics.mock.calls.length).toBe(calls)
  })

  it('`update` чужого форума строки не трогает', async () => {
    await start([topic(1)])
    await openForum()
    topicOps([{ op: 'update', peerId: -999, topics: [topic(1, { peerId: -999, title: 'чужая' })] }])
    await settle()
    expect(topicRows()[0].querySelector('.peer-title-inner')!.textContent).toBe('Тема 1')
  })

  it('`notify` — тема заглушена сроком: строка `is-muted`, срок истёк — нет', async () => {
    await start([topic(1), topic(2)])
    await openForum()
    const t2 = forumTab()!.xd.getDialog(generateMessageId(2))!
    const now = Math.floor(Date.now() / 1000)

    topicOps([{ op: 'notify', topic: { ...t2, notify_settings: { _: 'peerNotifySettings', mute_until: now + 3600 } } }])
    await vi.waitFor(() => expect(topicRows()[1].classList.contains('is-muted')).toBe(true))

    topicOps([{ op: 'notify', topic: { ...t2, notify_settings: { _: 'peerNotifySettings', mute_until: now - 1 } } }])
    await vi.waitFor(() => expect(topicRows()[1].classList.contains('is-muted')).toBe(false))
  })

  it('`unread` перерисовывает бейдж темы', async () => {
    await start([topic(1)])
    await openForum()
    const t1 = forumTab()!.xd.getDialog(generateMessageId(1))!
    topicOps([{ op: 'unread', topic: { ...t1, unread_count: 4 } }])
    await vi.waitFor(() => expect(topicRows()[0].querySelector('.dialog-subtitle-badge-unread')!.textContent).toBe('4'))
  })

  // О-71 + tweb dialogs.ts:968-985 (`processChangedUnreadOrUnmuted` → `dialog_unread`
  // форума): строка ФОРУМА в списке чатов пересчитывает бейдж по темам
  it('`forumUnread` — строка форума в списке чатов: бейдж = число непрочитанных тем', async () => {
    await start([topic(1)])
    const getForumUnreadCount = mounted!.hooks.managers.forumTopics.getForumUnreadCount
    expect(getForumUnreadCount).toHaveBeenCalledWith(FORUM_ID)
    getForumUnreadCount.mockImplementation(async () => ({ count: 3, unreadNotifySettings: [] }))
    topicOps([{ op: 'forumUnread', peerId: FORUM_ID }])
    await vi.waitFor(() => expect(row(FORUM_ID)!.querySelector('.dialog-subtitle-badge-unread')!.textContent).toBe('3'))
  })

  it('`drop` снимает строку', async () => {
    await start([topic(1), topic(2)])
    await openForum()
    topicOps([{ op: 'drop', peerId: FORUM_ID, id: generateMessageId(1) }])
    await vi.waitFor(() => expect(topicRows().map((el) => +el.dataset.threadId!)).toEqual([generateMessageId(2)]))
  })
})
