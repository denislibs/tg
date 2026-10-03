// Пины ядра шапки чата (`components/chat/topbar.ts`, порт tweb `chat/topbar.ts`):
// заголовок и подпись по виду пира (`setTitleManual` `:1550-1641`, `createStatus`
// `:1718-1845`, статус `appImManager.setPeerStatus` `:3677-3803` — блок L, «N онлайн» —
// `getOnlines`), клик по шапке → правая колонка (`:259-286`), «назад» → `chat.pop()`
// (`:288-306`), кнопки звонка по правам (`verify*` `:340-415`, пачка П-4).
//
// `Chat` — минимальный фейк по срезу `TopbarChat`; статус считает настоящий
// синглтон `appImManager` (без `construct` — менеджеры приходят опцией).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import rootScope from '@lib/rootScope'
import { applyPeerOps, resetPeerMirror } from '@core/peerCache'
import { resetMessagesMirror, setMirrorHistoryCount, winKey } from '@core/history/messagesMirror'
import { useChatsStore } from '@stores/chatsStore'
import mediaSizes, { ScreenSize } from '@core/dom/mediaSizes'
import appImManager, { LEFT_COLUMN_ACTIVE_CLASSNAME } from '@lib/appImManager'
import { resetChatFullMirror, saveChatFull } from '@core/chatFullCache'
import { useGroupCallStore } from '@stores/groupCallStore'
import { useLivestreamStore } from '@stores/livestreamStore'
import { RIGHT_COLUMN_ACTIVE_CLASSNAME, type AppSidebarRight } from '@components/sidebarRight'
import { getMiddleware } from '@helpers/middleware'
import type { Managers } from '@/client/bootstrap'
import { makeDialog } from '@core/dialogs/testDialog'
import ChatTopbar, { type TopbarChat } from './topbar'

// happy-dom без `RTCPeerConnection` — звонки «поддерживаются» явно
vi.mock('@environment/callSupport', () => ({ default: true }))
import { ChatType } from './chatType'

const ME: PeerId = 1
const ALICE: PeerId = 7
const BOT: PeerId = 8
/** супергруппа и канал: ключ пира — отрицательный id */
const GROUP: PeerId = -100
const CHANNEL: PeerId = -200
/** группа, где я создатель (`manage_call`), и канал, где я создатель */
const MY_GROUP: PeerId = -300
const MY_CHANNEL: PeerId = -400
/** группа больше 100 участников — «N онлайн» не считается (Б-84) */
const BIG_GROUP: PeerId = -500
const BOB: PeerId = 9
const CAROL: PeerId = 10

const channelParticipants = vi.fn(async(_peerId: PeerId, _offset: number, _limit: number) => ({
  _: 'channels.channelParticipants',
  count: 3,
  participants: [ALICE, BOB, CAROL].map((user_id) => ({ _: 'channelParticipant', user_id, date: 0 })),
  chats: [],
  users: [],
}))
const managers = {
  peers: { fillMirror: async() => {} },
  groups: { channelParticipants },
} as unknown as Managers

let sidebar: { toggleSidebar: ReturnType<typeof vi.fn> }
let topbars: ChatTopbar[]

type FakeChat = TopbarChat & { pop: ReturnType<typeof vi.fn> }

function makeChat(options: Partial<Omit<TopbarChat, 'pop'>> & { peerId: PeerId }): FakeChat {
  const container = document.createElement('div')
  container.classList.add('chat')
  document.body.append(container)
  const pop = vi.fn()
  const isBroadcast = options.peerId === CHANNEL || options.peerId === MY_CHANNEL
  const isAnyGroup = options.peerId < 0 && !isBroadcast
  return { container, type: ChatType.Chat, pop, appImManager, isBroadcast, isAnyGroup, ...options }
}

async function open(chat: TopbarChat) {
  const topbar = new ChatTopbar(chat, sidebar as unknown as AppSidebarRight, managers)
  topbars.push(topbar)
  topbar.constructPeerHelpers()
  topbar.construct()
  chat.container.append(topbar.container)
  const helper = getMiddleware()
  const callback = await topbar.finishPeerChange({ middleware: helper.get() })
  callback()
  return topbar
}

const q = (topbar: ChatTopbar, selector: string) => topbar.container.querySelector<HTMLElement>(selector)!

beforeEach(() => {
  topbars = []
  sidebar = { toggleSidebar: vi.fn(() => Promise.resolve()) }
  resetPeerMirror()
  resetMessagesMirror()
  applyPeerOps([{ op: 'upsert', peers: [
    { _: 'user', id: ME, first_name: 'Я', pFlags: { self: true } },
    { _: 'user', id: ALICE, first_name: 'Алиса', pFlags: {} },
    { _: 'user', id: BOT, first_name: 'Бот', pFlags: { bot: true } },
    { _: 'channel', id: 100, title: 'Группа', photo: { _: 'chatPhotoEmpty' }, date: 0, participants_count: 5, pFlags: { megagroup: true } },
    { _: 'channel', id: 200, title: 'Канал', photo: { _: 'chatPhotoEmpty' }, date: 0, participants_count: 1200, pFlags: { broadcast: true } },
    { _: 'channel', id: 300, title: 'Моя группа', photo: { _: 'chatPhotoEmpty' }, date: 0, participants_count: 3, pFlags: { megagroup: true, creator: true } },
    { _: 'channel', id: 400, title: 'Мой канал', photo: { _: 'chatPhotoEmpty' }, date: 0, participants_count: 3, pFlags: { broadcast: true, creator: true } },
    { _: 'channel', id: 500, title: 'Большая', photo: { _: 'chatPhotoEmpty' }, date: 0, participants_count: 101, pFlags: { megagroup: true } },
    { _: 'user', id: BOB, first_name: 'Боб', pFlags: {}, status: { _: 'userStatusOnline', expires: 2e9 } },
    { _: 'user', id: CAROL, first_name: 'Кэрол', pFlags: {}, status: { _: 'userStatusOffline', was_online: 1 } },
  ] }])
  resetChatFullMirror()
  ;(appImManager as unknown as { onlinesParticipants: Map<PeerId, unknown> }).onlinesParticipants.clear()
  channelParticipants.mockClear()
  useGroupCallStore.setState({ peerId: null, activeByChat: {} })
  useLivestreamStore.setState({ watchingPeerId: null, activeByChat: {} })
  rootScope.myId = ME
  useChatsStore.setState({ meId: ME, presence: {}, typing: {}, dialogs: [] })
  mediaSizes.activeScreen = ScreenSize.large
  document.body.classList.remove(LEFT_COLUMN_ACTIVE_CLASSNAME, RIGHT_COLUMN_ACTIVE_CLASSNAME)
})

afterEach(() => {
  topbars.forEach((topbar) => topbar.destroy())
  document.body.replaceChildren()
})

describe('ChatTopbar: заголовок и подпись по виду пира', () => {
  it('разметка tweb: .sidebar-header.topbar → .chat-info-container → кнопка «назад», .chat-info, .chat-utils', async() => {
    const topbar = await open(makeChat({ peerId: ALICE }))
    expect(topbar.container.className).toBe('sidebar-header topbar has-avatar')
    const info = q(topbar, '.chat-info-container')
    expect([...info.children].map((el) => el.classList[0])).toEqual(['btn-icon', 'chat-info', 'chat-utils'])
    expect(q(topbar, '.sidebar-close-button .back-unread-badge')).toBeTruthy()
    expect(q(topbar, '.chat-info > .person > .avatar.person-avatar')).toBeTruthy()
    expect(q(topbar, '.person > .content > .top > .user-title .peer-title').textContent).toBe('Алиса')
    expect(q(topbar, '.person > .content > .bottom > .info')).toBeTruthy()
    expect(q(topbar, '.topbar-floating-plates').classList.contains('hide')).toBe(true)
  })

  it('личка: «в сети» в span.online из chatsStore.presence', async() => {
    useChatsStore.setState({ presence: { [ALICE]: { _: 'userStatusOnline', expires: 2e9 } } })
    const topbar = await open(makeChat({ peerId: ALICE }))
    const subtitle = q(topbar, '.info')
    expect(subtitle.classList.contains('hide')).toBe(false)
    expect(subtitle.querySelector('.online')?.textContent).toBe('online')
  })

  it('личка: подпись переписывается, когда меняется присутствие, и набор вытесняет её', async() => {
    useChatsStore.setState({ presence: { [ALICE]: { _: 'userStatusRecently' } } })
    const topbar = await open(makeChat({ peerId: ALICE }))
    const subtitle = q(topbar, '.info')
    expect(subtitle.textContent).toBe('last seen recently')

    useChatsStore.setState({ presence: { [ALICE]: { _: 'userStatusOnline', expires: 2e9 } } })
    await vi.waitFor(() => expect(subtitle.querySelector('.online')?.textContent).toBe('online'))

    useChatsStore.setState({ typing: { [ALICE]: { [ALICE]: { action: { _: 'sendMessageTypingAction' }, at: Date.now() } } } })
    await vi.waitFor(() => expect(subtitle.querySelector('.peer-typing-container')).toBeTruthy())
  })

  it('бот: подпись «bot», набор не показывается', async() => {
    useChatsStore.setState({ typing: { [BOT]: { [BOT]: { action: { _: 'sendMessageTypingAction' }, at: Date.now() } } } })
    const topbar = await open(makeChat({ peerId: BOT }))
    expect(q(topbar, '.info').textContent).toBe('bot')
  })

  it('группа: «N members, M online» — онлайн «недавних» участников по присутствию и карточке', async() => {
    // Алиса — онлайн по `presence`, Боб — по `status` карточки, Кэрол — не в сети
    useChatsStore.setState({ presence: { [ALICE]: { _: 'userStatusOnline', expires: 2e9 } } })
    const topbar = await open(makeChat({ peerId: GROUP }))
    expect(q(topbar, '.user-title .peer-title').textContent).toBe('Группа')
    await vi.waitFor(() => expect(q(topbar, '.info').textContent).toBe('5 members, 2 online'))
    expect(channelParticipants).toHaveBeenCalledWith(GROUP, 0, 100)
  })

  it('группа: один онлайн не пишется (это я), страница участников кэшируется на 60 с', async() => {
    const topbar = await open(makeChat({ peerId: GROUP }))
    await vi.waitFor(() => expect(channelParticipants).toHaveBeenCalledTimes(1))
    expect(q(topbar, '.info').textContent).toBe('5 members')

    // второй показ — из кэша, без похода в сеть; онлайн пересчитан по свежему присутствию
    useChatsStore.setState({ presence: { [ALICE]: { _: 'userStatusOnline', expires: 2e9 }, [CAROL]: { _: 'userStatusOnline', expires: 2e9 } } })
    const again = await open(makeChat({ peerId: GROUP }))
    expect(q(again, '.info').textContent).toBe('5 members, 3 online')
    expect(channelParticipants).toHaveBeenCalledTimes(1)
  })

  it('группа больше 100 участников: «N online» не считается, участников не спрашиваем (Б-84)', async() => {
    const topbar = await open(makeChat({ peerId: BIG_GROUP }))
    expect(q(topbar, '.info').textContent).toBe('101 members')
    expect(channelParticipants).not.toHaveBeenCalled()
  })

  it('группа: «печатает» вытесняет подпись и называет печатающего, по концу набора подпись возвращается', async() => {
    const topbar = await open(makeChat({ peerId: GROUP }))
    const subtitle = q(topbar, '.info')
    await vi.waitFor(() => expect(channelParticipants).toHaveBeenCalledTimes(1))

    useChatsStore.setState({ typing: { [GROUP]: { [ALICE]: { action: { _: 'sendMessageTypingAction' }, at: Date.now() } } } })
    await vi.waitFor(() => expect(subtitle.querySelector('.peer-typing-container .peer-typing-text')).toBeTruthy())
    expect(subtitle.querySelector('.peer-typing-description')?.textContent).toBe('Алиса is typing')

    // `setAuto` → `setPeerStatus({needClear: false})`: подпись из кэша участников
    useChatsStore.setState({ typing: {} })
    await vi.waitFor(() => expect(subtitle.textContent).toBe('5 members'))
  })

  it('группа: шапку открыли, пока кто-то печатает, — «печатает» без похода за участниками', async() => {
    useChatsStore.setState({ typing: { [GROUP]: { [ALICE]: { action: { _: 'sendMessageTypingAction' }, at: Date.now() } } } })
    const topbar = await open(makeChat({ peerId: GROUP }))
    expect(q(topbar, '.info .peer-typing-description')?.textContent).toBe('Алиса is typing')
    expect(channelParticipants).not.toHaveBeenCalled()
  })

  it('канал: «N subscribers» с разбивкой по тысячам, онлайн не считается', async() => {
    const topbar = await open(makeChat({ peerId: CHANNEL }))
    expect(q(topbar, '.info').textContent).toBe('1 200 subscribers')
    expect(channelParticipants).not.toHaveBeenCalled()
  })

  it('«Избранное»: заголовок Saved Messages, подпись — счёт истории окна, пока его нет — Loading', async() => {
    const topbar = await open(makeChat({ peerId: ME }))
    expect(q(topbar, '.user-title').textContent).toBe('Saved Messages')
    const subtitle = q(topbar, '.info')
    expect(subtitle.textContent).toBe('Loading...')

    setMirrorHistoryCount(winKey(ME), 3)
    expect(subtitle.textContent).toBe('3 messages')
  })

  it('тред комментариев: без аватара и подписи, заголовок «N Comments» по счёту окна треда', async() => {
    setMirrorHistoryCount(winKey(CHANNEL, 50), 2)
    const topbar = await open(makeChat({ peerId: CHANNEL, threadId: 50, type: ChatType.Discussion }))
    expect(topbar.container.classList.contains('has-avatar')).toBe(false)
    expect(q(topbar, '.avatar')).toBeNull()
    expect(q(topbar, '.user-title').textContent).toBe('2 Comments')
    expect(q(topbar, '.info').classList.contains('hide')).toBe(true)

    setMirrorHistoryCount(winKey(CHANNEL, 50), 1)
    expect(q(topbar, '.user-title').textContent).toBe('1 Comment')
  })

  it('смена пира на том же топбаре меняет аватар и заголовок', async() => {
    const chat = makeChat({ peerId: ALICE })
    const topbar = await open(chat)
    const firstAvatar = q(topbar, '.avatar')

    chat.peerId = GROUP
    const callback = await topbar.finishPeerChange({ middleware: getMiddleware().get() })
    callback()
    expect(firstAvatar.isConnected).toBe(false)
    expect(q(topbar, '.avatar').dataset.peerId).toBe('' + GROUP)
    expect(q(topbar, '.user-title .peer-title').textContent).toBe('Группа')
    // участников ещё нет в кэше — `needClear`: подпись гаснет и приходит с ответом (tweb :3794-3800)
    await vi.waitFor(() => expect(q(topbar, '.info').textContent).toBe('5 members'))
  })

  it('бейдж «назад» — число незаглушённых чатов с непрочитанным', async() => {
    const topbar = await open(makeChat({ peerId: ALICE }))
    const badge = q(topbar, '.back-unread-badge')
    expect(badge.classList.contains('is-badge-empty')).toBe(true)

    useChatsStore.setState({ dialogs: [makeDialog({ peerId: ALICE, unread: 4 }), makeDialog({ peerId: GROUP, unread: 1 })] })
    expect(badge.textContent).toBe('2')
    expect(badge.classList.contains('is-badge-empty')).toBe(false)
  })
})

describe('ChatTopbar: кнопки звонка по правам (`verify*` `:340-415`)', () => {
  const btn = (topbar: ChatTopbar, n: number) => topbar.container.querySelector<HTMLElement>('.chat-utils')!.children[n] as HTMLElement
  const shown = (topbar: ChatTopbar) => [0, 1, 2].map((n) => !btn(topbar, n).classList.contains('hide'))

  it('кнопки в `.chat-utils` в порядке tweb: звонок, видеочат, меню эфира — все скрыты до проверки', async() => {
    const topbar = new ChatTopbar(makeChat({ peerId: ALICE }), sidebar as unknown as AppSidebarRight, managers)
    topbars.push(topbar)
    topbar.constructPeerHelpers()
    topbar.construct()
    const utils = q(topbar, '.chat-utils')
    expect(utils.children).toHaveLength(3)
    expect([...utils.children].every((el) => el.classList.contains('hide'))).toBe(true)
    expect(utils.children[2].classList.contains('btn-menu-toggle')).toBe(true)
  })

  it('личка: звонок — только если `userFull.phone_calls_available`; клик зовёт `appImManager.callUser`', async() => {
    const callUser = vi.spyOn(appImManager, 'callUser').mockResolvedValue()
    const topbar = await open(makeChat({ peerId: ALICE }))
    await vi.waitFor(() => expect(shown(topbar)).toEqual([false, false, false]))

    saveChatFull(ALICE, { _: 'userFull', id: ALICE, pFlags: { phone_calls_available: true } })
    await vi.waitFor(() => expect(shown(topbar)).toEqual([true, false, false]))

    btn(topbar, 0).click()
    expect(callUser).toHaveBeenCalledWith(ALICE, 'voice')
    callUser.mockRestore()
  })

  it('личка: звонки запрещены настройками — кнопки нет; бот без полной карточки — тоже', async() => {
    saveChatFull(ALICE, { _: 'userFull', id: ALICE, pFlags: {} })
    const topbar = await open(makeChat({ peerId: ALICE }))
    const bot = await open(makeChat({ peerId: BOT }))
    await Promise.resolve()
    expect(shown(topbar)).toEqual([false, false, false])
    expect(shown(bot)).toEqual([false, false, false])
  })

  it('группа, участник: видеочата нет — кнопки нет; идёт видеочат — «войти»; я уже в нём — снова нет', async() => {
    const joinGroupCall = vi.spyOn(appImManager, 'joinGroupCall').mockResolvedValue()
    const topbar = await open(makeChat({ peerId: GROUP }))
    await Promise.resolve()
    expect(shown(topbar)).toEqual([false, false, false])

    useGroupCallStore.setState({ activeByChat: { [GROUP]: [BOB] } })
    await vi.waitFor(() => expect(shown(topbar)).toEqual([false, true, false]))
    btn(topbar, 1).click()
    expect(joinGroupCall).toHaveBeenCalledWith(GROUP)

    useGroupCallStore.setState({ peerId: GROUP })
    await vi.waitFor(() => expect(shown(topbar)).toEqual([false, false, false]))
    joinGroupCall.mockRestore()
  })

  it('группа, создатель (`manage_call`): видеочат можно начать без идущего', async() => {
    const topbar = await open(makeChat({ peerId: MY_GROUP }))
    await vi.waitFor(() => expect(shown(topbar)).toEqual([false, true, false]))
  })

  it('канал, создатель: вместо кнопки — меню эфира; пока идёт эфир — ничего', async() => {
    const topbar = await open(makeChat({ peerId: MY_CHANNEL }))
    await vi.waitFor(() => expect(shown(topbar)).toEqual([false, false, true]))

    useLivestreamStore.setState({ activeByChat: { [MY_CHANNEL]: true } })
    await vi.waitFor(() => expect(shown(topbar)).toEqual([false, false, false]))
  })

  it('канал, подписчик: видеочат — «войти», эфир (`rtmp_stream`) — кнопки нет', async() => {
    const topbar = await open(makeChat({ peerId: CHANNEL }))
    await Promise.resolve()
    expect(shown(topbar)).toEqual([false, false, false])

    useGroupCallStore.setState({ activeByChat: { [CHANNEL]: [BOB] } })
    await vi.waitFor(() => expect(shown(topbar)).toEqual([false, true, false]))

    useLivestreamStore.setState({ activeByChat: { [CHANNEL]: true } })
    await vi.waitFor(() => expect(shown(topbar)).toEqual([false, false, false]))
  })

  it('тред комментариев: кнопок звонка нет', async() => {
    useGroupCallStore.setState({ activeByChat: { [CHANNEL]: [BOB] } })
    const topbar = await open(makeChat({ peerId: CHANNEL, threadId: 50, type: ChatType.Discussion }))
    await Promise.resolve()
    expect(shown(topbar)).toEqual([false, false, false])
  })
})

describe('ChatTopbar: клики', () => {
  it('клик по шапке открывает правую колонку', async() => {
    const topbar = await open(makeChat({ peerId: ALICE }))
    q(topbar, '.user-title').click()
    expect(sidebar.toggleSidebar).toHaveBeenCalledWith(true)
  })

  it('клик по аватару переключает колонку по классу body', async() => {
    const topbar = await open(makeChat({ peerId: ALICE }))
    document.body.classList.add(RIGHT_COLUMN_ACTIVE_CLASSNAME)
    q(topbar, '.avatar').click()
    expect(sidebar.toggleSidebar).toHaveBeenCalledWith(false)
  })

  it('«назад» зовёт chat.pop и колонку не трогает', async() => {
    const chat = makeChat({ peerId: ALICE })
    const topbar = await open(chat)
    q(topbar, '.sidebar-close-button').click()
    expect(chat.pop).toHaveBeenCalledTimes(1)
    expect(sidebar.toggleSidebar).not.toHaveBeenCalled()
  })

  it('medium с открытым левым: клик по шапке — тоже chat.pop', async() => {
    const chat = makeChat({ peerId: ALICE })
    const topbar = await open(chat)
    mediaSizes.activeScreen = ScreenSize.medium
    document.body.classList.add(LEFT_COLUMN_ACTIVE_CLASSNAME)
    q(topbar, '.user-title').click()
    expect(chat.pop).toHaveBeenCalledTimes(1)
    expect(sidebar.toggleSidebar).not.toHaveBeenCalled()
  })
})

describe('ChatTopbar: жизненный цикл', () => {
  it('cleanup без пира прячет шапку', async() => {
    const chat = makeChat({ peerId: ALICE })
    const topbar = await open(chat)
    expect(topbar.container.classList.contains('hide')).toBe(false)
    chat.peerId = 0 as PeerId
    topbar.cleanup()
    expect(topbar.container.classList.contains('hide')).toBe(true)
  })

  it('destroy снимает подписки: ни клик, ни присутствие больше ничего не меняют', async() => {
    useChatsStore.setState({ presence: { [ALICE]: { _: 'userStatusRecently' } } })
    const topbar = await open(makeChat({ peerId: ALICE }))
    const subtitle = q(topbar, '.info')
    const badge = q(topbar, '.back-unread-badge')
    topbar.destroy()
    topbars = []

    useChatsStore.setState({
      presence: { [ALICE]: { _: 'userStatusOnline', expires: 2e9 } },
      dialogs: [makeDialog({ peerId: ALICE, unread: 4 })],
    })
    await Promise.resolve()
    expect(subtitle.textContent).toBe('last seen recently')
    expect(badge.classList.contains('is-badge-empty')).toBe(true)

    q(topbar, '.user-title').click()
    expect(sidebar.toggleSidebar).not.toHaveBeenCalled()
  })
})
