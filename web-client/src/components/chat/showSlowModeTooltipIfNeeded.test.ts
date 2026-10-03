// Ветки порта tweb `ChatInput.showSlowModeTooltipIfNeeded` (`input.ts:4005-4069`):
// кто останавливает отправку и какой подсказкой. Карточки — настоящие зеркала
// (`core/peerCache.ts`, `core/chatFullCache.ts`), подсказка — настоящая (`tooltip.solid.tsx`).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Managers } from '@/client/bootstrap'
import { applyPeerOps, resetPeerMirror } from '@core/peerCache'
import { resetChatFullMirror, saveChatFull } from '@core/chatFullCache'
import type { ChannelFull } from '@core/peers/peer'
import showSlowModeTooltipIfNeeded from './showSlowModeTooltipIfNeeded'

const CHAT_ID = 300
const PEER_ID: PeerId = -CHAT_ID

function putChannel(slowmode: boolean) {
  applyPeerOps([{ op: 'upsert', peers: [{
    _: 'channel', id: CHAT_ID, title: 'Группа', photo: { _: 'chatPhotoEmpty' }, date: 0,
    pFlags: { megagroup: true, ...(slowmode ? { slowmode_enabled: true as const } : {}) },
  }] }])
}

function putChannelFull(nextSendDate?: number) {
  const full: ChannelFull = {
    _: 'channelFull', id: CHAT_ID, about: '', read_inbox_max_id: 0, read_outbox_max_id: 0,
    unread_count: 0, chat_photo: null, slowmode_seconds: 60, slowmode_next_send_date: nextSendDate,
  }
  saveChatFull(PEER_ID, full)
}

let hasOutgoing = false
const managers = { messages: { hasOutgoingMessage: vi.fn(async() => hasOutgoing) } } as unknown as Managers

let element: HTMLElement
beforeEach(() => {
  hasOutgoing = false
  const container = document.createElement('div')
  element = document.createElement('button')
  container.append(element)
  document.body.append(container)
})

afterEach(() => {
  document.body.replaceChildren()
  resetPeerMirror()
  resetChatFullMirror()
  vi.clearAllMocks()
  vi.useRealTimers()
})

const tooltipText = () => document.querySelector('.tooltip .tooltip-text')?.textContent

describe('showSlowModeTooltipIfNeeded — ветки tweb input.ts:4005-4069', () => {
  it('личный чат — не останавливает (peerId.isUser())', async() => {
    expect(await showSlowModeTooltipIfNeeded({ peerId: 5, managers, element, textOverflow: true })).toBe(false)
    expect(document.querySelector('.tooltip')).toBeNull()
  })

  it('медленный режим выключен (или карточки нет) — не останавливает', async() => {
    expect(await showSlowModeTooltipIfNeeded({ peerId: PEER_ID, managers, element, textOverflow: true })).toBe(false)
    putChannel(false)
    expect(await showSlowModeTooltipIfNeeded({ peerId: PEER_ID, managers, element, textOverflow: true })).toBe(false)
    expect(document.querySelector('.tooltip')).toBeNull()
  })

  it('слишком длинный текст — SlowmodeSendErrorTooLong', async() => {
    putChannel(true)
    expect(await showSlowModeTooltipIfNeeded({ peerId: PEER_ID, managers, element, textOverflow: true, sendingFew: true })).toBe(true)
    expect(tooltipText()).toContain('This text is too long to send as one message.')
  })

  it('несколько сообщений сразу — SlowmodeSendError', async() => {
    putChannel(true)
    expect(await showSlowModeTooltipIfNeeded({ peerId: PEER_ID, managers, element, sendingFew: true })).toBe(true)
    expect(tooltipText()).toBe('Slow Mode is active. You can\'t send more than one message at once.')
    expect(managers.messages.hasOutgoingMessage).not.toHaveBeenCalled()
  })

  it('у пира есть неотправленное — SlowmodeSendError (hasOutgoingMessage)', async() => {
    putChannel(true)
    hasOutgoing = true
    expect(await showSlowModeTooltipIfNeeded({ peerId: PEER_ID, managers, element })).toBe(true)
    expect(managers.messages.hasOutgoingMessage).toHaveBeenCalledWith(PEER_ID)
    expect(tooltipText()).toBe('Slow Mode is active. You can\'t send more than one message at once.')
  })

  it('срок следующей отправки не задан (бэкенд его не производит) — не останавливает', async() => {
    putChannel(true)
    putChannelFull(undefined)
    expect(await showSlowModeTooltipIfNeeded({ peerId: PEER_ID, managers, element })).toBe(false)
    expect(document.querySelector('.tooltip')).toBeNull()
  })

  it('срок в будущем — SlowModeHint с живым остатком', async() => {
    putChannel(true)
    putChannelFull((Date.now() / 1000 | 0) + 30)
    expect(await showSlowModeTooltipIfNeeded({ peerId: PEER_ID, managers, element })).toBe(true)
    expect(tooltipText()).toMatch(/^Slow Mode is active\. You can send\s*your next message in (29|30) seconds\.$/)
  })

  it('эмодзи-дропдаун держится открытым, пока видна подсказка (setIgnoreMouseOut)', async() => {
    putChannel(true)
    const emoticonsDropdown = { setIgnoreMouseOut: vi.fn() }
    await showSlowModeTooltipIfNeeded({ peerId: PEER_ID, managers, element, sendingFew: true, emoticonsDropdown })
    expect(emoticonsDropdown.setIgnoreMouseOut).toHaveBeenCalledWith('tooltip', true)
  })
})
