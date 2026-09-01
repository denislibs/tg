// Плейсхолдер ПУСТОГО ЧАТА — порт tweb `checkIfEmptyPlaceholderNeeded`
// (bubbles.ts:11302-11316) + `renderEmptyPlaceholder` (:10466).
//
// Пины:
//   (1) пустой личный чат, куда можно писать, → карточка `greeting` с
//       заголовком, подписью и местом под стикер (:10839-10850, :10516-10600);
//   (2) «Избранное» → карточка `saved` с четырьмя буллетами (:10837,
//       :10510-10515);
//   (3) остальное (группа) → `noMessages` (:10856);
//   (4) непустой чат карточки не получает — единственный гейт `!getRenderedLength()`;
//   (5) карточка живёт в `.bubbles`, а не в окне, и не пересчитывается второй раз;
//   (6) тап по стикеру ОТПРАВЛЯЕТ его (:10586-10589);
//   (7) строки карточки — УЗЛЫ ЯДРА, а не текст (задача #122).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import I18n from '@lib/langPack'
import { applyLang } from '@/test/lang'
import rootScope from '@lib/rootScope'
import { resetMessagesMirror } from '@core/history/messagesMirror'
import { resetPeerMirror } from '@core/peerCache'
import { clearChatPositions } from '@core/chat/chatPositions'
import { useSettingsStore } from '@/settings'
import { makeMessage } from '@core/messages/testMessage'
import type { MyMessage } from '@core/models'
import type { MyDocument } from '@core/media/messageMedia'
import type { HistoryResult } from '@core/managers/messagesManager'
import ChatBubbles, { type BubblesManagers, type ChatContext } from './bubbles'

const ME = 1
const FRIEND = 8
const GROUP = -20

const GREETING: MyDocument = { id: 555, type: 'sticker', w: 512, h: 512 } as MyDocument

const chatContext = (peerId: number, over: Partial<ChatContext> = {}): ChatContext => ({
  peerId,
  messagesStorageKey: String(peerId),
  container: document.createElement('div'),
  bubblesViewport: document.createElement('div'),
  ...over,
})

function managersWith(messages: MyMessage[], stickers?: BubblesManagers['stickers']) {
  const managers: BubblesManagers = {
    messages: {
      getHistory: vi.fn(async (): Promise<HistoryResult> =>
        ({ messages, count: messages.length, reachedTop: true, reachedBottom: true })),
      getAround: vi.fn(async () => ({ messages, reachedTop: true, reachedBottom: true })),
      messageByDate: vi.fn(async () => null),
    },
    peers: { fillMirror: vi.fn(async () => {}) },
    dialogs: { getReadMaxSeqIfUnread: vi.fn(async () => 0), getHistoryMaxSeq: vi.fn(async () => 0) },
    realtime: { markRead: vi.fn(async () => ({ ok: true })) },
    ...(stickers ? { stickers } : {}),
  }
  return managers
}

async function settle() {
  for(let i = 0; i < 5; ++i) await new Promise((resolve) => setTimeout(resolve, 0))
}

const placeholder = (feed: ChatBubbles) =>
  feed.container.querySelector<HTMLElement>('.empty-bubble-placeholder')

let bubbles: ChatBubbles | undefined
afterEach(() => { bubbles?.destroy(); bubbles = undefined })
beforeEach(() => {
  resetMessagesMirror()
  resetPeerMirror()
  clearChatPositions()
  useSettingsStore.setState({ reduceMotion: true })
  rootScope.myId = ME
})

describe('ChatBubbles — плейсхолдер пустого чата', () => {
  it('личный чат, куда можно писать, → приветствие со стикером', async () => {
    const searchByEmoji = vi.fn(async () => [GREETING])
    bubbles = new ChatBubbles(
      chatContext(FRIEND, { canSend: () => true }),
      managersWith([], { searchByEmoji }),
    )
    await (await bubbles.setPeer())?.promise
    await settle()

    const node = placeholder(bubbles)!
    expect(node).not.toBeNull()
    expect(node.classList.contains('empty-bubble-placeholder-greeting')).toBe(true)
    // Каркас служебного бабла + карточка (`has-service-description`).
    expect(node.className).toContain('bubble service')
    expect(node.classList.contains('has-service-description')).toBe(true)
    const msgDiv = node.querySelector('.bubble-content-wrapper > .bubble-content > .service-msg')!
    expect(msgDiv.querySelector('.empty-bubble-placeholder-title')!.textContent).toBe('No messages here yet...')
    expect(msgDiv.querySelector('.empty-bubble-placeholder-subtitle')!.textContent)
      .toBe('Send a message or tap the greeting below.')
    expect(msgDiv.querySelector('.empty-bubble-placeholder-sticker')).not.toBeNull()
    expect(searchByEmoji).toHaveBeenCalledWith('👋')
  })

  it('«Избранное» → своя карточка с четырьмя буллетами', async () => {
    bubbles = new ChatBubbles(chatContext(ME, { canSend: () => true }), managersWith([]))
    await (await bubbles.setPeer())?.promise
    await settle()

    const node = placeholder(bubbles)!
    expect(node.classList.contains('empty-bubble-placeholder-saved')).toBe(true)
    expect(node.querySelector('.empty-bubble-placeholder-title')!.textContent).toBe('Your cloud storage')
    expect(node.querySelectorAll('.empty-bubble-placeholder-list-item')).toHaveLength(4)
    expect(node.querySelectorAll('.empty-bubble-placeholder-list-bullet')).toHaveLength(4)
    // Стикера у этой ветки нет — он только у приветствия.
    expect(node.querySelector('.empty-bubble-placeholder-sticker')).toBeNull()
  })

  it('группа → последняя ветка цепочки', async () => {
    bubbles = new ChatBubbles(chatContext(GROUP, { canSend: () => true }), managersWith([]))
    await (await bubbles.setPeer())?.promise
    await settle()

    const node = placeholder(bubbles)!
    expect(node.classList.contains('empty-bubble-placeholder-noMessages')).toBe(true)
    // Одинокий заголовок карточкой не становится (tweb :10738 — `elements.length > 1`).
    expect(node.classList.contains('has-service-description')).toBe(false)
  })

  it('непустой чат карточки не получает', async () => {
    const message = makeMessage({ peerId: FRIEND, fromId: FRIEND, id: 1, text: 'привет', createdAt: '2026-08-15T12:00:00Z' })
    bubbles = new ChatBubbles(chatContext(FRIEND, { canSend: () => true }), managersWith([message]))
    await (await bubbles.setPeer())?.promise
    await settle()

    expect(placeholder(bubbles)).toBeNull()
  })

  it('карточка одна, и живёт она в `.bubbles`, а не в окне', async () => {
    bubbles = new ChatBubbles(chatContext(FRIEND, { canSend: () => true }), managersWith([]))
    await (await bubbles.setPeer())?.promise
    await settle()
    // Ещё один прогон обоих краёв не должен породить вторую карточку.
    await (await bubbles.setPeer())?.promise
    await settle()

    expect(bubbles.container.querySelectorAll('.empty-bubble-placeholder')).toHaveLength(1)
    expect(bubbles.chatInner.querySelector('.empty-bubble-placeholder')).toBeNull()
  })

  it('тап по стикеру приветствия отправляет его', async () => {
    const sendSticker = vi.fn()
    bubbles = new ChatBubbles(
      chatContext(FRIEND, { canSend: () => true, sendSticker }),
      managersWith([], { searchByEmoji: vi.fn(async () => [GREETING]) }),
    )
    await (await bubbles.setPeer())?.promise
    await settle()

    placeholder(bubbles)!.querySelector<HTMLElement>('.empty-bubble-placeholder-sticker')!.click()
    expect(sendSticker).toHaveBeenCalledWith(GREETING)
  })

  // ── ПИН ЗАДАЧИ #122 ────────────────────────────────────────────────────────
  //
  // Строки карточки собирались своим `span` с классом `i18n` и текстом внутри.
  // Класс был подделкой: узла в `weakMap` нет, `applyLangPack` обходит `.i18n`
  // и такой узел молча пропускает (`lib/langPack.ts:568-572`). Для ванильного
  // узла это не шум, а ЗАСТЫВШИЙ ТЕКСТ — своей перерисовки, в отличие от React,
  // у него не бывает, а карточка живёт ровно столько, сколько чат пуст.
  //
  // Проверяется не текст (он был верным и с дефектом), а то, ЧЕМ строка
  // является: узлом ядра, который ядро может переписать.
  it('строки карточки — узлы ядра и следуют за языком', async () => {
    bubbles = new ChatBubbles(chatContext(ME, { canSend: () => true }), managersWith([]))
    await (await bubbles.setPeer())?.promise
    await settle()

    const node = placeholder(bubbles)!
    const title = node.querySelector<HTMLElement>('.empty-bubble-placeholder-title')!
    expect(I18n.weakMap.get(title)).toBeDefined()
    // Буллеты — тоже: там узел ядра приклеен ПОСЛЕ значка «•».
    const items = node.querySelectorAll<HTMLElement>('.empty-bubble-placeholder-list-item')
    for (const item of items) expect(I18n.weakMap.get(item.lastElementChild as HTMLElement)).toBeDefined()

    expect(title.textContent).toBe('Your cloud storage')

    // Карточка в документе — ядро находит узлы обходом, как в бою.
    document.body.append(bubbles.container)
    await applyLang('ru')
    expect(title.textContent).toBe('Ваше облачное хранилище')

    await applyLang('en')
    bubbles.container.remove()
  })
})
