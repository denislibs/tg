// Шапка ПЕРЕСЛАННОГО бабла — порт ветки `isForward` блока имени (tweb
// bubbles.ts:10725-11019) и производных полей, которые tweb выводит при
// сохранении сообщения: `fwdFromId`, `savedFrom` и автор в «Избранном»
// (appMessagesManager.ts:7111-7158).
//
// Пин на дефект: Алиса пересылает сообщение Боба в «Избранное» — в шапке стояла
// «Алиса» (отправитель копии), а должен стоять Боб (автор оригинала). В обычном
// чате та же пересылка показывала просто имя вместо «Переслано от Боб».
//
// Сообщения проходят настоящую границу разбора (`mapMyMessage` с `meId`), а не
// собираются руками: автор в «Избранном» выводится именно там.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetMessagesMirror } from '@core/history/messagesMirror'
import { applyPeerOps, resetPeerMirror } from '@core/peerCache'
import { makeRawMessage } from '@core/messages/testMessage'
import { generateMessageId } from '@core/history/messageId'
import { mapMyMessage, type MessageFwdHeader, type MyMessage, type RawMessageReal } from '@core/models'
import { useSettingsStore } from '@/settings'
import rootScope from '@lib/rootScope'
import type { UserReal } from '@core/peers/peer'
import type { HistoryResult } from '@core/managers/messagesManager'
import type ChatBubbles from './bubbles'
import type { BubblesManagers } from './bubbles'
import { createTestChat, mountTestBubbles } from './testChat'

const ME = 1
const BOB = 2
const CHAT = 3 // личка с Карлом
const SOURCE_GROUP = 77

const setInnerPeer = vi.fn()

async function settle() {
  for (let i = 0; i < 5; ++i) {
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
}

const managersWith = (messages: MyMessage[]): BubblesManagers => ({
  messages: {
    getHistory: vi.fn(async (): Promise<HistoryResult> => ({
      messages, count: messages.length, reachedTop: true, reachedBottom: true,
    })),
    getAround: vi.fn(async () => ({ messages, reachedTop: true, reachedBottom: true })),
    messageByDate: vi.fn(async () => null),
  },
  peers: { fillMirror: vi.fn(async () => {}) },
  dialogs: { getReadMaxSeqIfUnread: vi.fn(async () => 0), getHistoryMaxSeq: vi.fn(async () => 0), getDialogReadState: vi.fn(async () => undefined) },
  realtime: { markRead: vi.fn(async () => ({ ok: true })) },
})

/** Моя пересылка в чат `peerId`: копия от меня, оригинал — по `fwd`. */
const forwarded = (peerId: PeerId, fwd: Omit<MessageFwdHeader, '_' | 'date'>, id = 5): MyMessage => mapMyMessage({
  ...makeRawMessage({ id, peerId, fromId: ME, out: true, text: 'привет', createdAt: '2026-08-15T12:00:00Z' }),
  fwd_from: { _: 'messageFwdHeader', date: 1_700_000_000, ...fwd },
} as RawMessageReal, ME)

let bubbles: ChatBubbles | undefined
afterEach(() => { bubbles?.destroy(); bubbles = undefined; document.body.replaceChildren() })
beforeEach(() => {
  resetMessagesMirror()
  resetPeerMirror()
  setInnerPeer.mockClear()
  rootScope.myId = ME
  useSettingsStore.setState({ liteMode: { ...useSettingsStore.getState().liteMode, all: true } })
  applyPeerOps([{ op: 'upsert', peers: [
    { _: 'user', id: ME, first_name: 'Алиса', pFlags: { self: true } } as UserReal,
    { _: 'user', id: BOB, first_name: 'Боб', pFlags: {} } as UserReal,
  ] }])
})

async function feedWith(peerId: PeerId, message: MyMessage) {
  // «Избранное» — `isLikeGroup` (tweb chat.ts `_isLikeGroup`: `peerId === myId`).
  const ctx = createTestChat({ peerId, isLikeGroup: peerId === ME, appImManager: { setInnerPeer } })
  document.body.append(ctx.container)
  const feed = mountTestBubbles(ctx, managersWith([message]))
  await (await feed.setPeer())?.promise
  await settle()
  return feed
}

const bubbleOf = (b: ChatBubbles, message: MyMessage) =>
  b.chatInner.querySelector<HTMLElement>(`.bubble[data-mid="${message.id}"]`)!

describe('ChatBubbles — шапка пересланного (tweb bubbles.ts:10746-10883)', () => {
  it('«Избранное»: имя — автор оригинала (Боб), цветное, без «Переслано от» и без класса forwarded', async () => {
    const message = forwarded(ME, { from_id: { _: 'peerUser', user_id: BOB } })
    // Граница разбора: автор в «Избранном» — автор оригинала (tweb :7130).
    expect(message.fromId).toBe(BOB)
    bubbles = await feedWith(ME, message)

    const bubble = bubbleOf(bubbles, message)
    const name = bubble.querySelector<HTMLElement>('.bubble-content > .name')!
    expect(name.classList.contains('colored-name')).toBe(true)
    const title = name.querySelector<HTMLElement>('.peer-title')!
    expect(title.textContent).toBe('Боб')
    expect(title.dataset.peerId).toBe(String(BOB))
    expect(name.querySelector('.bubble-name-forwarded')).toBeNull()
    expect(bubble.classList.contains('forwarded')).toBe(false)
    // Пересылка рисуется слева (`isOutMessage`), и аватарка серии — тоже Боба.
    expect(bubble.classList.contains('is-in')).toBe(true)
    const avatar = bubbles.chatInner.querySelector<HTMLElement>('.bubbles-group-avatar')
    expect(avatar?.dataset.peerId).toBe(String(BOB))
  })

  it('обычный чат: «Forwarded from» + аватарка 20px + имя автора оригинала', async () => {
    const message = forwarded(CHAT, { from_id: { _: 'peerUser', user_id: BOB } })
    bubbles = await feedWith(CHAT, message)

    const bubble = bubbleOf(bubbles, message)
    expect(bubble.classList.contains('forwarded')).toBe(true)
    expect(bubble.classList.contains('must-have-name')).toBe(true)
    expect(bubble.classList.contains('hide-name')).toBe(false)

    const span = bubble.querySelector<HTMLElement>('.name .bubble-name-forwarded')!
    expect(span.textContent).toContain('Forwarded from')
    expect(span.querySelector('br.hide-ol')).not.toBeNull()
    const avatar = span.querySelector<HTMLElement>('.bubble-name-forwarded-avatar')!
    expect(avatar.classList.contains('avatar-20')).toBe(true)
    expect(avatar.dataset.peerId).toBe(String(BOB))
    const title = span.querySelector<HTMLElement>('.peer-title')!
    expect(title.textContent).toBe('Боб')
    expect(title.dataset.peerId).toBe(String(BOB))
  })

  it('скрытая атрибуция: имя строкой из from_name, hidden-profile, без аватарки', async () => {
    const message = forwarded(CHAT, { from_name: 'Тайный' })
    bubbles = await feedWith(CHAT, message)

    const bubble = bubbleOf(bubbles, message)
    expect(bubble.classList.contains('hidden-profile')).toBe(true)
    const title = bubble.querySelector<HTMLElement>('.bubble-name-forwarded .peer-title')!
    expect(title.textContent).toBe('Тайный')
    expect(title.classList.contains('text-normal')).toBe(true)
    expect(bubble.querySelector('.bubble-name-forwarded-avatar')).toBeNull()
  })

  it('адрес оригинала (saved_from_peer): кнопка «к оригиналу» сбоку, клик по имени ведёт туда же', async () => {
    const message = forwarded(CHAT, {
      from_id: { _: 'peerUser', user_id: BOB },
      saved_from_peer: { _: 'peerChannel', channel_id: SOURCE_GROUP },
      saved_from_msg_id: 40,
    })
    // tweb :7143-7149 — адрес в клиентском пространстве номеров.
    const savedFrom = `${-SOURCE_GROUP}_${generateMessageId(40)}`
    expect(message._ === 'message' && message.savedFrom).toBe(savedFrom)
    bubbles = await feedWith(CHAT, message)

    const bubble = bubbleOf(bubbles, message)
    expect(bubble.querySelector('.bubble-beside-button.goto-original')).not.toBeNull()
    expect(bubble.dataset.savedFrom).toBe(savedFrom)

    bubble.querySelector<HTMLElement>('.bubble-name-forwarded .peer-title')!.click()
    expect(setInnerPeer).toHaveBeenCalledWith({ peerId: -SOURCE_GROUP, lastMsgId: generateMessageId(40) })
  })
})
