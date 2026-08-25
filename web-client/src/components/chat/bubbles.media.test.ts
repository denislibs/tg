// Медиа в императивном бабле — порт медиа-switch tweb (bubbles.ts:7878-7935).
//
// Пин ровно на то, чего не хватало: врапперы были портированы и покрыты
// СВОИМИ тестами, но в ленту не заведены — сообщение с вложением рисовалось
// без вложения. Поэтому здесь проверяется СТЫКОВКА: лента создаёт
// `.attachment`, ставит классы бабла и стыка, а внутрь контейнера попадает то,
// что положил враппер.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetMessagesMirror } from '@core/history/messagesMirror'
import { resetPeerMirror } from '@core/peerCache'
import { saveDocument, THUMB_TYPE_FULL, type DocumentAttribute, type MessageMedia } from '@core/media/messageMedia'
import { makeMessage } from '@core/messages/testMessage'
import type { MyMessage } from '@core/models'
import type { HistoryResult } from '@core/managers/messagesManager'
import ChatBubbles, { type BubblesManagers, type ChatContext } from './bubbles'

const CHAT = 60

const chatContext = (): ChatContext => ({
  peerId: CHAT,
  messagesStorageKey: String(CHAT),
  container: document.createElement('div'),
  bubblesViewport: document.createElement('div'),
})

const managersWith = (messages: MyMessage[]): BubblesManagers => ({
  messages: { getHistory: vi.fn(async (): Promise<HistoryResult> => ({
    messages, count: messages.length, reachedTop: true, reachedBottom: true,
  })) },
  peers: { fillMirror: vi.fn(async () => {}) },
  dialogs: { getReadMaxSeqIfUnread: vi.fn(async () => 0), getHistoryMaxSeq: vi.fn(async () => 0) },
})

const photoMedia = (spoiler?: boolean): MessageMedia => ({
  _: 'messageMediaPhoto',
  photo: { _: 'photo', id: 11, sizes: [{ _: 'photoSize', type: THUMB_TYPE_FULL, w: 800, h: 600, size: 1024 }] },
  ...(spoiler ? { pFlags: { spoiler: true as const } } : {}),
})

const withPhoto = (over: { id: number; text?: string; spoiler?: boolean }): MyMessage =>
  makeMessage({
    peerId: CHAT, fromId: 2, id: over.id, text: over.text ?? '',
    createdAt: '2026-08-15T12:00:00Z', media: photoMedia(over.spoiler),
  })

const textOnly = (id: number): MyMessage =>
  makeMessage({ peerId: CHAT, fromId: 2, id, text: 'просто текст', createdAt: '2026-08-15T12:00:00Z' })

/** Документ-вложение: тип выводит `saveDocument` из атрибутов, как у оригинала
 *  (`doc.type` — `video` при `documentAttributeVideo`, `round` при
 *  `round_message`, `gif` при `documentAttributeAnimated`). */
const docMedia = (over: { mime: string; attributes: DocumentAttribute[] }): MessageMedia => ({
  _: 'messageMediaDocument',
  document: saveDocument({
    _: 'document', id: 22, mime_type: over.mime, size: 2048, attributes: over.attributes,
  }),
})

const withDoc = (id: number, media: MessageMedia): MyMessage =>
  makeMessage({ peerId: CHAT, fromId: 2, id, text: '', createdAt: '2026-08-15T12:00:00Z', media })

/** Дать очереди рендера и промисам враппера разобраться. */
async function settle() {
  for (let i = 0; i < 5; ++i) {
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
}

let bubbles: ChatBubbles | undefined
afterEach(() => { bubbles?.destroy(); bubbles = undefined })
beforeEach(() => { resetMessagesMirror(); resetPeerMirror() })

const bubbleOf = (b: ChatBubbles, mid: number) =>
  b.chatInner.querySelector<HTMLElement>(`.bubble[data-mid="${mid}"]`)!

describe('ChatBubbles — медиа в бабле', () => {
  it('фото заводит .attachment в бабл и класс photo', async () => {
    bubbles = new ChatBubbles(chatContext(), managersWith([withPhoto({ id: 1, text: 'подпись' })]))
    await bubbles.loadFirstHistory()
    await settle()

    const bubble = bubbleOf(bubbles, 1)
    expect(bubble.classList.contains('photo')).toBe(true)

    const attachment = bubble.querySelector('.attachment')
    expect(attachment).not.toBeNull()
    // Вложение стоит ПЕРЕД телом сообщения (tweb :9247-9268).
    expect(attachment!.nextElementSibling?.classList.contains('message')).toBe(true)
  })

  it('стык вложения с подписью обнуляет радиусы: no-brb у вложения, mt-shorter у текста', async () => {
    bubbles = new ChatBubbles(chatContext(), managersWith([withPhoto({ id: 1, text: 'подпись' })]))
    await bubbles.loadFirstHistory()
    await settle()

    const bubble = bubbleOf(bubbles, 1)
    expect(bubble.querySelector('.attachment')!.classList.contains('no-brb')).toBe(true)
    expect(bubble.querySelector('.message')!.classList.contains('mt-shorter')).toBe(true)
  })

  it('сообщение БЕЗ вложения вложения не получает', async () => {
    bubbles = new ChatBubbles(chatContext(), managersWith([textOnly(1)]))
    await bubbles.loadFirstHistory()
    await settle()

    const bubble = bubbleOf(bubbles, 1)
    expect(bubble.querySelector('.attachment')).toBeNull()
    expect(bubble.classList.contains('photo')).toBe(false)
  })

  it('спойлер кладёт крышку ПОВЕРХ вложения, а не вместо него', async () => {
    bubbles = new ChatBubbles(chatContext(), managersWith([withPhoto({ id: 1, spoiler: true })]))
    await bubbles.loadFirstHistory()
    await settle()

    const bubble = bubbleOf(bubbles, 1)
    const attachment = bubble.querySelector('.attachment')!
    // Крышку строит `wrapMediaSpoiler` из stripped-превью; его в фикстуре нет,
    // поэтому узла крышки не будет — но САМО вложение обязано остаться на
    // месте. Пин здесь на том, что ветка спойлера не подменяет и не удаляет
    // attachment (`isConnected` тут не годится: `chatInner` живёт вне
    // документа, пока лентой не владеет хост).
    expect(bubble.contains(attachment)).toBe(true)
    expect(attachment.parentElement?.classList.contains('bubble-content')).toBe(true)
  })

  // Ветка видео (tweb :8511-8587): класс бабла выбирается по `doc.type`, и
  // кружок отличается от обычного видео именно им — `round` против `video`.
  it('видео заводит .attachment и класс video', async () => {
    const media = docMedia({
      mime: 'video/mp4',
      attributes: [{ _: 'documentAttributeVideo', duration: 5, w: 640, h: 480 }],
    })
    bubbles = new ChatBubbles(chatContext(), managersWith([withDoc(1, media)]))
    await bubbles.loadFirstHistory()
    await settle()

    const bubble = bubbleOf(bubbles, 1)
    expect(bubble.classList.contains('video')).toBe(true)
    expect(bubble.classList.contains('round')).toBe(false)
    expect(bubble.querySelector('.attachment')).not.toBeNull()
  })

  it('кружок получает класс round, а не video (tweb :8530)', async () => {
    const media = docMedia({
      mime: 'video/mp4',
      attributes: [{ _: 'documentAttributeVideo', duration: 3, w: 384, h: 384, pFlags: { round_message: true } }],
    })
    bubbles = new ChatBubbles(chatContext(), managersWith([withDoc(1, media)]))
    await bubbles.loadFirstHistory()
    await settle()

    const bubble = bubbleOf(bubbles, 1)
    expect(bubble.classList.contains('round')).toBe(true)
    expect(bubble.classList.contains('video')).toBe(false)
  })

  it('gif идёт той же веткой, что видео', async () => {
    const media = docMedia({
      mime: 'video/mp4',
      attributes: [
        { _: 'documentAttributeAnimated' },
        { _: 'documentAttributeVideo', duration: 2, w: 320, h: 240 },
      ],
    })
    bubbles = new ChatBubbles(chatContext(), managersWith([withDoc(1, media)]))
    await bubbles.loadFirstHistory()
    await settle()

    expect(bubbleOf(bubbles, 1).classList.contains('video')).toBe(true)
  })

  // Ветка стикера (:8510) идёт ПЕРЕД видео: стикер — тоже документ, и без
  // проверки порядка он ушёл бы в видео-ветку с чужим набором классов.
  it('стикер получает свои классы, а не видео-ветку', async () => {
    const media = docMedia({
      mime: 'image/webp',
      attributes: [
        { _: 'documentAttributeSticker', alt: '🙂', stickerset: { _: 'inputStickerSetEmpty' } },
        { _: 'documentAttributeImageSize', w: 512, h: 512 },
      ],
    })
    bubbles = new ChatBubbles(chatContext(), managersWith([withDoc(1, media)]))
    await bubbles.loadFirstHistory()
    await settle()

    const bubble = bubbleOf(bubbles, 1)
    expect(bubble.classList.contains('sticker')).toBe(true)
    // Стикер — standalone-медиа: бабл без фона и паддингов (tweb :9660).
    expect(bubble.classList.contains('just-media')).toBe(true)
    expect(bubble.classList.contains('video')).toBe(false)
    expect(bubble.classList.contains('round')).toBe(false)
    expect(bubble.querySelector('.attachment')).not.toBeNull()
  })

  // Ветка документа (:8588-8646) — единственная, у которой узел встаёт В ТЕЛО
  // сообщения, а не в attachment (`noAttachmentDivNeeded` оригинала).
  it('документ встаёт в тело сообщения, а не в attachment', async () => {
    const media = docMedia({ mime: 'application/pdf', attributes: [{ _: 'documentAttributeFilename', file_name: 'смета.pdf' }] })
    bubbles = new ChatBubbles(chatContext(), managersWith([withDoc(1, media)]))
    await bubbles.loadFirstHistory()
    await settle()

    const bubble = bubbleOf(bubbles, 1)
    expect(bubble.querySelector('.attachment')).toBeNull()
    const messageDiv = bubble.querySelector('.message')!
    expect(messageDiv.querySelector('.document')).not.toBeNull()
    // Подложка бабла (tweb :8616-8618).
    expect(bubble.querySelector('.bubble-content-background')).not.toBeNull()
  })

  it('голосовое рисуется той же веткой — плеером, а не строкой файла', async () => {
    const media = docMedia({
      mime: 'audio/ogg',
      attributes: [{ _: 'documentAttributeAudio', duration: 4, pFlags: { voice: true } }],
    })
    bubbles = new ChatBubbles(chatContext(), managersWith([withDoc(1, media)]))
    await bubbles.loadFirstHistory()
    await settle()

    const messageDiv = bubbleOf(bubbles, 1).querySelector('.message')!
    expect(messageDiv.querySelector('audio-element')).not.toBeNull()
  })

  it('бокс стикера держит минимум бабла (tweb :6116-6117)', async () => {
    const media = docMedia({
      mime: 'image/webp',
      attributes: [
        { _: 'documentAttributeSticker', alt: '🙂', stickerset: { _: 'inputStickerSetEmpty' } },
        { _: 'documentAttributeImageSize', w: 512, h: 512 },
      ],
    })
    bubbles = new ChatBubbles(chatContext(), managersWith([withDoc(1, media)]))
    await bubbles.loadFirstHistory()
    await settle()

    const content = bubbleOf(bubbles, 1).querySelector<HTMLElement>('.bubble-content')!
    const attachment = bubbleOf(bubbles, 1).querySelector<HTMLElement>('.attachment')!
    expect(attachment.style.width).not.toBe('')
    expect(content.style.minWidth).toBe(attachment.style.width)
    expect(content.style.minHeight).toBe(attachment.style.height)
  })
})
