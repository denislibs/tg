// Пины автокомплита строки ввода (П-6, Б-34; порт tweb `chat/input.ts::checkAutocomplete`
// и хелперов `chat/{mentions,commands,emoji}Helper.ts`): `@` в группе показывает
// участников и вставляет упоминание сущностью в UTF-16, `/` в чате с ботом — его команды
// (выбор отправляет команду), `:` — эмодзи (выбор заменяет запрос эмодзи с сущностью).
//
// happy-dom не умеет ни `execCommand`, ни `Selection.modify`, а вставка tweb идёт ровно ими
// (`insertRichTextAsHTML` → `insertHTML`, расширение выделения назад до набранного запроса).
// Здесь они подменены минимальными реализациями — проверяется наш конвейер «запрос →
// хелпер → вставка → сущности из DOM», а не браузерный редактор.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import EventListenerBase from '@helpers/eventListenerBase'
import { getMiddleware } from '@helpers/middleware'
import getRichValueWithCaret from '@helpers/dom/getRichValueWithCaret'
import { useChatsStore } from '@stores/chatsStore'
import { useSettingsStore } from '@/settings'
import { winKey } from '@core/history/messagesMirror'
import { makeDialog } from '@core/dialogs/testDialog'
import { applyPeerOps, resetPeerMirror } from '@core/peerCache'
import type { User } from '@core/peers/peer'
import ChatInput from './input'
import { ChatType } from './chatType'

const ME = 1
const ALICE = 2
const BOB = 3
const BOT = 4
const GROUP = -100

const users: User[] = [
  { _: 'user', id: ME, first_name: 'Я', pFlags: { self: true } },
  { _: 'user', id: ALICE, first_name: 'Алиса', pFlags: {} },
  { _: 'user', id: BOB, first_name: 'Боб', username: 'bob', pFlags: {} },
  { _: 'user', id: BOT, first_name: 'Демо', username: 'demobot', pFlags: { bot: true } },
] as User[]

function makeManagers() {
  return {
    messages: {
      getScheduledMessages: vi.fn(async() => []),
      scheduleMessage: vi.fn(async() => ({})),
      sendText: vi.fn(async(_args: Record<string, unknown>) => ({ ok: true })),
      editMessage: vi.fn(async() => ({})),
      forwardMessages: vi.fn(async() => []),
      getMessageByPeer: vi.fn(async() => undefined),
      reloadMessage: vi.fn(async() => undefined),
    },
    drafts: { save: vi.fn(async() => ({ _: 'draftMessageEmpty' })) },
    realtime: { sendTyping: vi.fn(async() => ({ ok: true })) },
    chats: {
      createPrivate: vi.fn(async(id: number) => id),
      getSendAs: vi.fn(async() => ({ _: 'channels.sendAsPeers', peers: [], chats: [], users: [] })),
    },
    dialogs: { refresh: vi.fn(async() => {}) },
    channels: { post: vi.fn(async() => ({})) },
    groups: {
      setMute: vi.fn(async() => {}),
      // ручка `GET /chats/{peer}/participants?filter=mentions&q=` — фильтр по имени и username (ILIKE)
      getParticipants: vi.fn(async({ filter }: { filter: { q?: string } }) => {
        const q = filter.q
        const members = [ME, ALICE, BOB].map((id) => users.find((u) => u.id === id)!)
          .filter((u) => !q || [u._ === 'user' ? u.first_name : '', u._ === 'user' ? u.username : ''].some((s) => s?.toLowerCase().includes(q.toLowerCase())))
        return {
          _: 'channels.channelParticipants',
          count: members.length,
          participants: members.map((u) => ({ _: 'channelParticipant', user_id: u.id, date: 0 })),
          chats: [],
          users: members,
        }
      }),
    },
    bots: {
      menuButton: vi.fn(async() => ({ text: '', url: '' })),
      commands: vi.fn(async() => [
        { command: 'start', description: 'Начать' },
        { command: 'help', description: 'Помощь' },
        { command: 'settings', description: 'Настройки' },
      ]),
      inline: vi.fn(async() => ({ results: [], placeholder: '' })),
    },
    stickers: { use: vi.fn(async() => {}), saveGif: vi.fn(async() => {}), searchByEmoji: vi.fn(async() => []) },
    peers: {
      fillMirror: vi.fn(async() => {}),
      getPeers: vi.fn(async(ids: number[]) => ids.map((id) => users.find((u) => u.id === id)!)),
      resolveUsername: vi.fn(async() => { throw new Error('USERNAME_NOT_OCCUPIED') }),
    },
  }
}

async function mountInput(peerId: PeerId) {
  useChatsStore.setState({ dialogs: [makeDialog({ peerId })], loaded: true })
  const managers = makeManagers()
  const appImManager = new EventListenerBase<{ peer_changing: (chat: unknown) => void }>()
  const container = document.createElement('div')
  const chat = {
    peerId,
    threadId: undefined as number | undefined,
    type: ChatType.Chat,
    container,
    messagesStorageKey: winKey(peerId),
    isBroadcast: false,
    isBot: peerId === BOT,
    isForum: false,
    animationGroup: 'chat-test',
    canSend: vi.fn(async() => true),
    updateChatInputHeight: vi.fn(),
    getMessage: () => undefined,
    setMessageId: vi.fn(),
    bubbles: { onGoDownClick: vi.fn(), getMiddleware: () => () => true },
    destroyMiddlewareHelper: getMiddleware(),
    selection: { isSelecting: false },
    managers,
    input: undefined as unknown as ChatInput,
  }

  const input = new ChatInput(chat as never, appImManager as never, managers as never, 'chat-input-main')
  chat.input = input
  input.construct()
  input.constructPeerHelpers()
  container.append(input.chatInput)
  document.body.append(container)

  const callback = await input.finishPeerChange({ peerId, middleware: () => true })
  callback()

  return { input, chat, managers }
}

/** Набрать текст в поле: DOM поля, каретка в конце, событие `input` — как при вводе. */
function type(input: ChatInput, text: string) {
  const field = input.messageInput
  field.focus()
  field.textContent = text
  const range = document.createRange()
  range.selectNodeContents(field)
  range.collapse(false)
  const selection = document.getSelection()!
  selection.removeAllRanges()
  selection.addRange(range)
  field.dispatchEvent(new Event('input', { bubbles: true }))
}

// happy-dom не объявляет `execCommand` — вставка разметки в точку выделения
function stubInsertHTML() {
  const exec = vi.fn((command: string, _showUI?: boolean, value?: string) => {
    if(command !== 'insertHTML') return false
    const selection = document.getSelection()!
    const range = selection.getRangeAt(0)
    const template = document.createElement('template')
    template.innerHTML = value!
    const last = template.content.lastChild
    range.deleteContents()
    range.insertNode(template.content)
    if(last) {
      range.setStartAfter(last)
      range.collapse(true)
    }

    return true
  })
  Object.defineProperty(document, 'execCommand', { configurable: true, writable: true, value: exec })
  return exec
}

// happy-dom не умеет `Selection.modify` — расширение назад на один символ (UTF-16) по
// текстовым узлам поля; позиция «между узлами» сводится к концу предыдущего текстового узла
function stubSelectionModify() {
  const proto = Object.getPrototypeOf(document.getSelection()!) as { modify?: unknown }
  const toText = (node: Node, offset: number): [Text, number] => {
    if(node.nodeType === Node.TEXT_NODE) return [node as Text, offset]
    let child: Node | null = node.childNodes[offset - 1] ?? null
    while(child && child.nodeType !== Node.TEXT_NODE) child = child.lastChild ?? child.previousSibling
    if(!child) throw new Error('no text before caret')
    return [child as Text, (child as Text).length]
  }
  const modify = vi.fn(function(this: Selection, alter: string, direction: string, granularity: string) {
    if(alter !== 'extend' || direction !== 'backward' || granularity !== 'character') throw new Error('unexpected modify')
    const range = this.getRangeAt(0)
    const [endNode, endOffset] = toText(range.endContainer, range.endOffset)
    const [startNode, startOffset] = toText(range.startContainer, range.startOffset)
    if(!startOffset) throw new Error('start of text node')
    const next = document.createRange()
    next.setStart(startNode, startOffset - 1)
    next.setEnd(endNode, endOffset)
    this.removeAllRanges()
    this.addRange(next)
  })
  Object.defineProperty(proto, 'modify', { configurable: true, writable: true, value: modify })
  return () => { delete proto.modify }
}

const flush = async(times = 5) => {
  for(let i = 0; i < times; ++i) await new Promise<void>((resolve) => setTimeout(resolve, 0))
}

let mounted: Awaited<ReturnType<typeof mountInput>> | undefined
let unstubModify: (() => void) | undefined

beforeEach(async() => {
  const { default: rootScope } = await import('@lib/rootScope')
  rootScope.myId = ME
  resetPeerMirror()
  applyPeerOps([{ op: 'upsert', peers: [
    ...users,
    { _: 'channel', id: 100, title: 'Группа', photo: { _: 'chatPhotoEmpty' }, date: 0, participants_count: 3, pFlags: { megagroup: true } },
  ] as never }])
  useSettingsStore.setState({ emojiSuggest: true, stickersSuggest: 'all' } as never)
  stubInsertHTML()
  unstubModify = stubSelectionModify()
})

afterEach(() => {
  mounted?.input.destroy()
  mounted?.chat.container.remove()
  mounted = undefined
  unstubModify?.()
  delete (document as { execCommand?: unknown }).execCommand
  useChatsStore.setState({ dialogs: [] })
  document.body.replaceChildren()
  vi.restoreAllMocks()
})

const helper = (input: ChatInput, className: string) => input.rowsWrapper.querySelector<HTMLElement>(`.autocomplete-helper.${className}`)!

describe('автокомплит: `@` — упоминания', () => {
  it('показывает участников группы (без себя) по запросу и вставляет упоминание сущностью UTF-16', async() => {
    mounted = await mountInput(GROUP)
    const { input, managers } = mounted

    // * эмодзи — суррогатная пара: смещение упоминания после неё обязано считаться в UTF-16
    type(input, '😀 @Ал')
    await flush()

    expect(managers.groups.getParticipants).toHaveBeenCalledWith({
      id: -GROUP,
      filter: { _: 'channelParticipantsMentions', q: 'Ал', top_msg_id: undefined },
      limit: 50,
      offset: 0,
    })
    const mentions = helper(input, 'mentions-helper')
    expect(mentions.classList.contains('is-visible')).toBe(true)
    const rows = [...mentions.querySelectorAll<HTMLElement>('.mentions-helper-list-element')]
    expect(rows.map((row) => +row.dataset.peerId!)).toEqual([ALICE])

    rows[0].click()
    await flush()

    const { value, entities } = getRichValueWithCaret(input.messageInput, true, false)
    expect(value).toBe('😀 Алиса ')
    expect(entities).toContainEqual({ _: 'messageEntityMentionName', offset: 3, length: 5, user_id: ALICE })
  })

  it('участник с username вставляется как `@username`', async() => {
    mounted = await mountInput(GROUP)
    const { input } = mounted

    type(input, '@bo')
    await flush()

    const row = helper(input, 'mentions-helper').querySelector<HTMLElement>('.mentions-helper-list-element')!
    expect(+row.dataset.peerId!).toBe(BOB)
    expect(row.querySelector('.mentions-helper-list-element-description')!.textContent).toBe('@bob')
    row.click()
    await flush()

    expect(getRichValueWithCaret(input.messageInput, true, false).value).toBe('@bob ')
  })

  it('пробел после запроса прячет подсказку', async() => {
    mounted = await mountInput(GROUP)
    const { input } = mounted

    type(input, '@Ал')
    await flush()
    expect(helper(input, 'mentions-helper').classList.contains('is-visible')).toBe(true)

    type(input, '@Ал текст')
    await flush()
    expect(helper(input, 'mentions-helper').classList.contains('forwards')).toBe(false)
  })
})

describe('автокомплит: `/` — команды бота', () => {
  it('в чате с ботом показывает отфильтрованные команды, выбор отправляет команду', async() => {
    mounted = await mountInput(BOT)
    const { input, managers } = mounted

    type(input, '/he')
    await flush()

    expect(managers.bots.commands).toHaveBeenCalledWith(BOT)
    const commands = helper(input, 'commands-helper')
    expect(commands.classList.contains('is-visible')).toBe(true)
    const names = [...commands.querySelectorAll('.commands-helper-list-element-name')].map((el) => el.textContent)
    expect(names).toEqual(['/help'])

    commands.querySelector<HTMLElement>('.commands-helper-list-element')!.click()
    await flush()

    expect(managers.messages.sendText).toHaveBeenCalledTimes(1)
    expect(managers.messages.sendText.mock.calls[0][0]).toMatchObject({ peerId: BOT, text: '/help' })
  })

  it('`/` не в начале строки и не в чате с ботом — без подсказки', async() => {
    mounted = await mountInput(GROUP)
    const { input, managers } = mounted

    type(input, '/st')
    await flush()
    expect(managers.bots.commands).not.toHaveBeenCalled()
  })
})

describe('автокомплит: `:` — эмодзи', () => {
  it('`:` показывает полоску эмодзи, выбор заменяет запрос эмодзи', async() => {
    mounted = await mountInput(GROUP)
    const { input } = mounted

    type(input, 'привет :')
    await flush()

    const emoji = helper(input, 'emoji-helper')
    expect(emoji.classList.contains('is-visible')).toBe(true)
    const items = [...emoji.querySelectorAll<HTMLElement>('.super-emoji')]
    expect(items.length).toBeGreaterThan(0)
    expect(items[0].dataset.emoji).toBe('😂')

    items[0].click()
    await flush()

    // * сущность эмодзи вставка рисует узлом (`wrapDraftText`), а в значение он читается
    // * обратно символом — `messageEntityEmoji` выводится из текста на отправке (`parseEntities`)
    expect(getRichValueWithCaret(input.messageInput, true, false).value).toBe('привет 😂')
    expect(input.messageInput.querySelector('.emoji, img')).not.toBeNull()
  })

  it('выключенная подсказка эмодзи (`emoji.suggest`) — без полоски', async() => {
    useSettingsStore.setState({ emojiSuggest: false } as never)
    mounted = await mountInput(GROUP)
    const { input } = mounted

    type(input, ':')
    await flush()
    expect(helper(input, 'emoji-helper').classList.contains('is-visible')).toBe(false)
  })
})

describe('автокомплит: `@бот запрос` — инлайн-бот', () => {
  it('выдача бота над полем, выбор отправляет статью и очищает поле', async() => {
    mounted = await mountInput(GROUP)
    const { input, managers } = mounted
    managers.peers.resolveUsername.mockImplementation(async() => users.find((u) => u.id === BOT)! as never)
    managers.bots.inline.mockImplementation(async() => ({
      results: [{ id: 'r1', title: 'Привет', description: 'описание', emoji: '👋', messageText: 'Привет от бота' }] as never,
      placeholder: '',
    }))

    type(input, '@demobot при')
    await flush(10)

    expect(managers.peers.resolveUsername).toHaveBeenCalledWith('demobot')
    expect(managers.bots.inline).toHaveBeenCalledWith(BOT, 'при')
    const inline = helper(input, 'inline-helper')
    expect(inline.classList.contains('is-visible')).toBe(true)
    const result = inline.querySelector<HTMLElement>('.inline-helper-result')!
    expect(result.querySelector('.inline-helper-result-title')!.textContent).toBe('Привет')

    result.click()
    await flush()

    expect(managers.messages.sendText).toHaveBeenCalledTimes(1)
    expect(managers.messages.sendText.mock.calls[0][0]).toMatchObject({ peerId: GROUP, text: 'Привет от бота' })
    expect(input.isInputEmpty()).toBe(true)
  })
})
