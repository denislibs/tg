// Ф-6, f6-bots: подсказка команд по «/» читает команды из ПОЛНОЙ карточки пира
// (`userFull.bot_info` у бота, `channelFull.bot_info` у группы) — порт tweb
// `commandsHelper.ts:47-63` + `processPeerFullForCommands.ts:4-12`. В группе у
// команды стоит суффикс `@username` бота (`:24-29`). Кадр updateBotCommands
// меняет подсказку без повторного запроса карточки.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { applyPeerOps, resetPeerMirror } from '@core/peerCache'
import { applyBotCommands, resetChatFullMirror, saveChatFull } from '@core/chatFullCache'
import type { BotInfo, ChannelFull, UserFull } from '@core/peers/peer'
import type { Managers } from '@/client/bootstrap'
import AutocompleteHelperController from './autocompleteHelperController'
import CommandsHelper from './commandsHelper'
import processPeerFullForCommands from './processPeerFullForCommands'
import type ChatInput from './input'

const BOT = 77
const GROUP = -5

const cmd = (command: string) => ({ _: 'botCommand' as const, command, description: command + ' d' })
const info = (...commands: string[]): BotInfo => ({ _: 'botInfo', user_id: BOT, commands: commands.map(cmd) })
const groupFull = (...bots: BotInfo[]): ChannelFull => ({
  _: 'channelFull', id: 5, about: '', read_inbox_max_id: 0, read_outbox_max_id: 0, unread_count: 0, chat_photo: null,
  bot_info: bots,
})
const botFull = (...commands: string[]): UserFull => ({ _: 'userFull', id: BOT, bot_info: info(...commands) })

function setup(chatPeerId: number) {
  // Сеть не должна звучать вовсе: карточка лежит в зеркале.
  const managers = {
    privacy: { profile: vi.fn(async () => { throw new Error('профиль перечитан') }) },
    groups: { card: vi.fn(async () => { throw new Error('карточка перечитана') }) },
  } as unknown as Managers
  const messageInput = document.createElement('div')
  const sendMessage = vi.fn()
  const chatInput = {
    chat: { peerId: chatPeerId },
    messageInput,
    getReadyToSend: (cb: () => void) => { cb(); return true },
    sendMessage,
  } as unknown as ChatInput
  const helper = new CommandsHelper(document.body, new AutocompleteHelperController(), chatInput, managers)
  const render = vi.spyOn(helper, 'render').mockImplementation(() => {})
  const shown = () => (render.mock.calls[render.mock.calls.length - 1]?.[0] ?? []).map((c: { name?: string }) => c.name)
  return { helper, managers, render, shown, messageInput, sendMessage }
}

beforeEach(() => {
  applyPeerOps([{ op: 'upsert', peers: [
    { _: 'user', id: BOT, first_name: 'Бот', username: 'cmd_bot', pFlags: { bot: true } },
    { _: 'channel', id: 5, title: 'Группа', photo: { _: 'chatPhotoEmpty' }, date: 0, pFlags: { megagroup: true } },
    { _: 'channel', id: 6, title: 'Канал', photo: { _: 'chatPhotoEmpty' }, date: 0, pFlags: { broadcast: true } },
    { _: 'user', id: 8, first_name: 'Человек', pFlags: {} },
  ] }])
})

afterEach(() => {
  resetPeerMirror()
  resetChatFullMirror()
  document.body.replaceChildren()
})

describe('CommandsHelper.checkQuery: команды из карточки', () => {
  it('группа с ботом: «/» показывает команды ботов из channelFull.bot_info', async () => {
    saveChatFull(GROUP, groupFull(info('start', 'help')))
    const { helper, shown, managers } = setup(GROUP)

    expect(await helper.checkQuery('/', GROUP)).toBe(true)
    await vi.waitFor(() => expect(shown()).toEqual(['/start', '/help']))
    expect(managers.groups.card).not.toHaveBeenCalled()
  })

  it('запрос «/he» фильтрует команды по вхождению', async () => {
    saveChatFull(GROUP, groupFull(info('start', 'help')))
    const { helper, shown } = setup(GROUP)
    await helper.checkQuery('/he', GROUP)
    await vi.waitFor(() => expect(shown()).toEqual(['/help']))
  })

  it('личка с ботом: команды из userFull.bot_info', async () => {
    saveChatFull(BOT, botFull('start'))
    const { helper, shown } = setup(BOT)
    expect(await helper.checkQuery('/', BOT)).toBe(true)
    await vi.waitFor(() => expect(shown()).toEqual(['/start']))
  })

  it('не бот и не группа (человек, канал-вещание) — подсказки нет, карточку не читаем', async () => {
    const { helper, managers } = setup(8)
    expect(await helper.checkQuery('/', 8)).toBe(false)
    expect(await helper.checkQuery('/', -6)).toBe(false)
    expect(managers.privacy.profile).not.toHaveBeenCalled()
  })

  it('кадр updateBotCommands меняет подсказку без запроса карточки', async () => {
    saveChatFull(GROUP, groupFull(info('start')))
    const { helper, shown, managers } = setup(GROUP)
    await helper.checkQuery('/', GROUP)
    await vi.waitFor(() => expect(shown()).toEqual(['/start']))

    applyBotCommands(GROUP, BOT, [cmd('fresh')]) // то, что делает событие воркера bot_commands

    await helper.checkQuery('/', GROUP)
    await vi.waitFor(() => expect(shown()).toEqual(['/fresh']))
    expect(managers.groups.card).not.toHaveBeenCalled()
    expect(managers.privacy.profile).not.toHaveBeenCalled()
  })
})

describe('CommandsHelper: выбор команды', () => {
  const pick = (helper: CommandsHelper, name: string) => {
    const target = document.createElement('div')
    target.dataset.peerId = '' + BOT
    const nameEl = document.createElement('div')
    nameEl.className = 'autocomplete-peer-helper-list-element-name'
    nameEl.textContent = name
    target.append(nameEl)
    return (helper as unknown as { onSelect: (t: Element) => unknown }).onSelect(target)
  }

  it('в группе к команде дописывается @username бота и она уходит', () => {
    const { helper, messageInput, sendMessage } = setup(GROUP)
    pick(helper, '/start')
    expect(messageInput.textContent).toBe('/start@cmd_bot')
    expect(sendMessage).toHaveBeenCalledWith(true)
  })

  it('в личке с ботом суффикса нет', () => {
    const { helper, messageInput } = setup(BOT)
    pick(helper, '/start')
    expect(messageInput.textContent).toBe('/start')
  })
})

describe('processPeerFullForCommands: ChatFull | UserFull', () => {
  it('принимает userFull с одним bot_info и channelFull с вектором', () => {
    const user = processPeerFullForCommands(BOT, botFull('a'))
    expect(user.map((c) => c.name)).toEqual(['/a'])
    expect(user[0].peerId).toBe(BOT)

    const group = processPeerFullForCommands(GROUP, groupFull(info('b'), { _: 'botInfo', user_id: 88, commands: [cmd('c')] }))
    expect(group.map((c) => [c.name, c.peerId])).toEqual([['/b', BOT], ['/c', 88]])
  })

  it('карточка без bot_info и без commands — пустой список', () => {
    expect(processPeerFullForCommands(8, { _: 'userFull', id: 8 })).toEqual([])
    expect(processPeerFullForCommands(GROUP, groupFull({ _: 'botInfo', user_id: BOT }))).toEqual([])
  })
})
