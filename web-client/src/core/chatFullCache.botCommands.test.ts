// Ф-6, f6-bots: кадр updateBotCommands кладёт команды в ЗАКЭШИРОВАННУЮ полную
// карточку и не заставляет её перечитывать — порт tweb
// `appProfileManager.onUpdateBotCommands` (:1560-1569) и `applyBotCommands`
// (:425-456): у бота — `userFull.bot_info`, у группы — запись вектора
// `channelFull.bot_info` с тем же `user_id`.
import { beforeEach, describe, expect, it } from 'vitest'
import {
  applyBotCommands,
  beginPeerFullFetch,
  endPeerFullFetch,
  cachedPeerFull,
  chatFullMirrorVersion,
  resetChatFullMirror,
  saveChatFull,
  subscribeChatFullMirror,
} from './chatFullCache'
import type { BotInfo, ChannelFull, UserFull } from './peers/peer'

const cmd = (command: string) => ({ _: 'botCommand' as const, command, description: command + ' d' })
const info = (userId: number | undefined, ...commands: string[]): BotInfo =>
  ({ _: 'botInfo', ...(userId ? { user_id: userId } : {}), commands: commands.map(cmd) })

const botFull = (id: number, bi: BotInfo | undefined): UserFull => ({ _: 'userFull', id, ...(bi ? { bot_info: bi } : {}) })
const groupFull = (id: number, ...bots: BotInfo[]): ChannelFull => ({
  _: 'channelFull', id, about: '', read_inbox_max_id: 0, read_outbox_max_id: 0, unread_count: 0, chat_photo: null,
  bot_info: bots,
})

const names = (peerId: PeerId, botId?: number): string[] => {
  const full = cachedPeerFull(peerId)
  const bi = full?._ === 'userFull' ? full.bot_info : full?._ === 'channelFull' ? full.bot_info?.find((b) => b.user_id === botId) : undefined
  return (bi?.commands ?? []).map((c) => c.command)
}

beforeEach(() => { resetChatFullMirror() })

describe('applyBotCommands: патч закэшированной карточки', () => {
  it('бот: заменяет команды его bot_info и будит подписчиков', () => {
    saveChatFull(9, botFull(9, info(9, 'start')))
    let woken = 0
    const stop = subscribeChatFullMirror(() => { woken++ })

    applyBotCommands(9, 9, [cmd('help'), cmd('about')])

    expect(names(9)).toEqual(['help', 'about'])
    expect(woken).toBe(1)
    stop()
  })

  it('bot_info без user_id: бот — сам пир карточки (fallbackBotId оригинала)', () => {
    saveChatFull(9, botFull(9, info(undefined, 'start')))
    applyBotCommands(9, 9, [cmd('new')])
    expect(names(9)).toEqual(['new'])
  })

  it('группа: меняется только запись нужного бота', () => {
    saveChatFull(-5, groupFull(5, info(77, 'a'), info(88, 'b')))
    applyBotCommands(-5, 88, [cmd('b2')])
    expect(names(-5, 77)).toEqual(['a'])
    expect(names(-5, 88)).toEqual(['b2'])
  })

  it('чужой бот и отсутствие карточки ничего не трогают и не будят', () => {
    saveChatFull(9, botFull(9, info(9, 'start')))
    let woken = 0
    const stop = subscribeChatFullMirror(() => { woken++ })
    applyBotCommands(9, 10, [cmd('x')]) // bot_id другой
    applyBotCommands(12, 12, [cmd('x')]) // карточки нет
    expect(names(9)).toEqual(['start'])
    expect(cachedPeerFull(12)).toBeUndefined()
    expect(woken).toBe(0)
    stop()
  })

  it('те же команды повторно (живой кадр и журнал) — идемпотентно, без пробуждения', () => {
    saveChatFull(9, botFull(9, info(9, 'start')))
    applyBotCommands(9, 9, [cmd('x')])
    const v = chatFullMirrorVersion()
    applyBotCommands(9, 9, [cmd('x')])
    expect(chatFullMirrorVersion()).toBe(v)
  })
})

describe('applyBotCommands: кадр во время похода за карточкой', () => {
  it('ответ, начатый ДО кадра, получает команды кадра (устаревший ответ не откатывает)', () => {
    const ticket = beginPeerFullFetch(9)
    applyBotCommands(9, 9, [cmd('fresh')]) // кадр пришёл, пока ответ в пути
    saveChatFull(9, botFull(9, info(9, 'stale')), ticket)
    expect(names(9)).toEqual(['fresh'])
  })

  it('ответ, начатый ПОСЛЕ кадра, уже содержит его — кадр поверх не ложится', () => {
    applyBotCommands(9, 9, [cmd('old_frame')])
    const ticket = beginPeerFullFetch(9)
    saveChatFull(9, botFull(9, info(9, 'server_now')), ticket)
    expect(names(9)).toEqual(['server_now'])
  })

  it('кадр для группы тоже дописывается в запоздавший ответ', () => {
    const ticket = beginPeerFullFetch(-5)
    applyBotCommands(-5, 77, [cmd('fresh')])
    saveChatFull(-5, groupFull(5, info(77, 'stale'), info(88, 'b')), ticket)
    expect(names(-5, 77)).toEqual(['fresh'])
    expect(names(-5, 88)).toEqual(['b'])
  })
})

describe('applyBotCommands: кадры без похода не копятся', () => {
  it('кадр, пришедший во время похода, который провалился, не ложится в следующий ответ', () => {
    const failed = beginPeerFullFetch(9)
    applyBotCommands(9, 9, [cmd('frame')])
    endPeerFullFetch(9, failed) // сеть отказала

    const ticket = beginPeerFullFetch(9)
    saveChatFull(9, botFull(9, info(9, 'server_now')), ticket)
    expect(names(9)).toEqual(['server_now'])
  })

  it('кадр без похода в пути не запоминается вовсе: ответ, начатый позже, остаётся как пришёл', () => {
    applyBotCommands(9, 9, [cmd('frame')])
    const ticket = beginPeerFullFetch(9)
    saveChatFull(9, botFull(9, info(9, 'server_now')), ticket)
    expect(names(9)).toEqual(['server_now'])
  })
})
