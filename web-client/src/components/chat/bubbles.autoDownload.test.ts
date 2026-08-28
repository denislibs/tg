// src/components/chat/bubbles.autoDownload.test.ts
//
// АВТОЗАГРУЗКА МЕДИА ПО НАСТРОЙКАМ ЧАТА — порт раздачи `this.chat.autoDownload`
// врапперам (tweb bubbles.ts:7901 альбом, :7919 фото, :8542/:8561 видео и
// кружок, :8597 документ). Сами пороги считает роль `Chat`
// (tweb chat.ts:1055 `useAutoDownloadSettings`, у нас `Chat.tsx` через
// `useChatAutoDownload`); лента их только ПЕРЕДАЁТ — это и пинится.
//
// Гейт у оригинала числовой и разный по виду медиа: у фото и видео значение
// сравнивается с нулём (`noAutoDownload = autoDownloadSize === 0`,
// wrappers/photo.ts:95, wrappers/video.ts:126), у документа — с размером файла
// (`autoDownloadSize >= doc.size`, wrappers/document.ts:419).
//
// Мокается ГРАНИЦА — владелец байтов (`managers.media`), как в
// `wrappers/photo.test.ts` и `chat/bubbles.actions.test.ts`.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import rootScope from '@lib/rootScope'
import { resetMessagesMirror } from '@core/history/messagesMirror'
import { resetPeerMirror } from '@core/peerCache'
import { clearChatPositions } from '@core/chat/chatPositions'
import { useSettingsStore } from '@/settings'
import { saveDocument, THUMB_TYPE_FULL, type DocumentAttribute, type MessageMedia } from '@core/media/messageMedia'
import { makeMessage } from '@core/messages/testMessage'
import type { MyMessage } from '@core/models'
import type { ChatAutoDownload } from '@core/hooks/useChatAutoDownload'
import type { HistoryResult } from '@core/managers/messagesManager'
import ChatBubbles, { type BubblesManagers, type ChatContext } from './bubbles'

const { downloadMediaURL } = vi.hoisted(() => ({
  downloadMediaURL: vi.fn(async (id: number) => `blob:${id}`),
}))
vi.mock('../../client/bootstrap', () => ({
  startClient: () => ({
    managers: {
      media: {
        downloadMediaURL,
        contentUrl: async (id: number) => `/api/media/${id}/content`,
        streamUrl: async (id: number) => `/api/media/${id}/stream`,
        tokenInfo: async () => ({ token: 'T', expiresAt: Date.now() + 900_000 }),
      },
    },
  }),
}))

const CHAT = 61
const ME = 1
/** Ровно то, что кладёт в настройки наш дефолт (`settings.tsx`) и tweb
 *  (`config/state.ts:433-441`): всё включено. */
const ALL: ChatAutoDownload = { photo: 1_048_576, video: 15_728_640, file: 3_145_728 }
const NONE: ChatAutoDownload = { photo: 0, video: 0, file: 0 }

const photoMedia = (id: number): MessageMedia => ({
  _: 'messageMediaPhoto',
  photo: { _: 'photo', id, sizes: [{ _: 'photoSize', type: THUMB_TYPE_FULL, w: 800, h: 600, size: 1024 }] },
})

const docMedia = (over: { id: number; mime: string; attributes?: DocumentAttribute[] }): MessageMedia => ({
  _: 'messageMediaDocument',
  document: saveDocument({
    _: 'document', id: over.id, mime_type: over.mime, size: 2048, attributes: over.attributes ?? [],
  }),
})

const videoMedia = (id: number) => docMedia({
  id,
  mime: 'video/mp4',
  attributes: [{ _: 'documentAttributeVideo', duration: 5, w: 640, h: 480 }],
})

const fileMedia = (id: number) => docMedia({ id, mime: 'application/pdf' })

const message = (id: number, media: MessageMedia): MyMessage =>
  makeMessage({ id, peerId: CHAT, fromId: 2, text: '', createdAt: '2026-08-20T10:00:00Z', media })

const managersWith = (messages: MyMessage[]): BubblesManagers => ({
  messages: {
    getHistory: vi.fn(async (): Promise<HistoryResult> => ({
      messages, count: messages.length, reachedTop: true, reachedBottom: true,
    })),
    getAround: vi.fn(async () => ({ messages, reachedTop: true, reachedBottom: true })),
    messageByDate: vi.fn(async () => null),
  },
  peers: { fillMirror: vi.fn(async () => {}) },
  dialogs: { getReadMaxSeqIfUnread: vi.fn(async () => 0), getHistoryMaxSeq: vi.fn(async () => 0) },
  realtime: { markRead: vi.fn(async () => ({ ok: true })) },
})

const chatContext = (autoDownload?: ChatAutoDownload): ChatContext => {
  const container = document.createElement('div')
  container.classList.add('chat')
  return {
    peerId: CHAT,
    messagesStorageKey: String(CHAT),
    container,
    bubblesViewport: document.createElement('div'),
    ...(autoDownload ? { autoDownload: () => autoDownload } : {}),
  }
}

async function settle(times = 6) {
  for (let i = 0; i < times; ++i) await new Promise((resolve) => setTimeout(resolve, 0))
}

let bubbles: ChatBubbles | undefined

beforeEach(() => {
  resetMessagesMirror()
  resetPeerMirror()
  clearChatPositions()
  rootScope.myId = ME
  downloadMediaURL.mockClear()
  useSettingsStore.setState({ reduceMotion: true })
  // Байты документа идут прямым fetch'ем (санкционированный путь для
  // не-картинок). Ответ, который НИКОГДА не приходит: проверяется решение
  // «начать качать», а не сама загрузка.
  vi.stubGlobal('fetch', () => new Promise(() => {}))
})

afterEach(() => {
  bubbles?.destroy()
  bubbles = undefined
  useSettingsStore.setState({ reduceMotion: false })
  vi.unstubAllGlobals()
})

/** `motion` — гейт `liteMode`: от него зависит `canAutoplay` видео
 *  (`wrappers/video.ts:285-291`), поэтому видео-кейсы открываются с ним. Ценой
 *  идёт «лестница» первой загрузки, которая здесь безвредна. */
async function openFeed(messages: MyMessage[], autoDownload?: ChatAutoDownload, motion = false) {
  if (motion) useSettingsStore.setState({ reduceMotion: false })
  const b = new ChatBubbles(chatContext(autoDownload), managersWith(messages))
  bubbles = b
  await (await b.setPeer())?.promise
  await settle()
  return b
}

const bubbleOf = (b: ChatBubbles, mid: number) =>
  b.chatInner.querySelector<HTMLElement>(`.bubble[data-mid="${mid}"]`)!

describe('ChatBubbles — автозагрузка медиа по настройкам чата', () => {
  it('фото: свод с нулём — к владельцу байтов не ходим, кольцо ручное', async () => {
    const b = await openFeed([message(1, photoMedia(101))], NONE)

    expect(downloadMediaURL).not.toHaveBeenCalled()
    const attachment = bubbleOf(b, 1).querySelector('.attachment')!
    expect(attachment.querySelector('.preloader-container')?.classList.contains('manual')).toBe(true)
  })

  it('фото: свод «всё включено» — байты берутся сами', async () => {
    await openFeed([message(1, photoMedia(102))], ALL)

    expect(downloadMediaURL).toHaveBeenCalled()
  })

  it('свода нет вовсе (хост его не передал) — качаем, как без гейта у tweb', async () => {
    // `autoDownload: undefined` у оригинала не запрещает ничего:
    // `noAutoDownload = autoDownloadSize === 0` при `undefined` ложно.
    await openFeed([message(1, photoMedia(103))])

    expect(downloadMediaURL).toHaveBeenCalled()
  })

  // Автоплей видео — та самая развилка, которую `autoDownload.video` и решает
  // (tweb video.ts:151-158): играющее само видео получает значок «без звука»,
  // не играющее — большую кнопку Play.
  it('видео: свод с нулём — автоплея нет, у бабла кнопка Play', async () => {
    const b = await openFeed([message(1, videoMedia(104))], NONE, true)

    const attachment = bubbleOf(b, 1).querySelector('.attachment')!
    expect(attachment.querySelector('.video-play')).not.toBeNull()
  })

  it('видео: свод «всё включено» — автоплей, кнопки Play нет', async () => {
    const b = await openFeed([message(1, videoMedia(105))], ALL, true)

    const attachment = bubbleOf(b, 1).querySelector('.attachment')!
    expect(attachment.querySelector('.video-play')).toBeNull()
    expect(attachment.querySelector('.video-time .video-time-icon')).not.toBeNull()
  })

  it('документ: порог сравнивается с РАЗМЕРОМ файла — 3 МБ покрывают 2 КБ, загрузка стартует сама', async () => {
    const b = await openFeed([message(1, fileMedia(106))], ALL)
    await settle()

    expect(bubbleOf(b, 1).querySelector('.document')?.classList.contains('downloading')).toBe(true)
  })

  it('документ: свод с нулём — только по клику', async () => {
    const b = await openFeed([message(1, fileMedia(107))], NONE)
    await settle()

    expect(bubbleOf(b, 1).querySelector('.document')?.classList.contains('downloading')).toBe(false)
  })

  it('альбом получает ВЕСЬ свод: нулевой — ни одна ячейка не идёт за байтами', async () => {
    const album = [
      makeMessage({ id: 1, peerId: CHAT, fromId: 2, text: '', createdAt: '2026-08-20T10:00:00Z', media: photoMedia(108), groupedId: 9 }),
      makeMessage({ id: 2, peerId: CHAT, fromId: 2, text: '', createdAt: '2026-08-20T10:00:00Z', media: photoMedia(109), groupedId: 9 }),
    ]
    const b = await openFeed(album, NONE)

    expect(bubbleOf(b, 1).querySelectorAll('.album-item')).toHaveLength(2)
    expect(downloadMediaURL).not.toHaveBeenCalled()
  })

  it('свод читается ЖИВЫМ на каждый рендер: смена настройки доезжает без пересборки ленты', async () => {
    // Порт `createEffect` у поля `chat.autoDownload` (tweb chat.ts:1053-1057):
    // настройка меняется, пока чат открыт, и следующий же бабл рисуется по ней.
    let current: ChatAutoDownload = NONE
    const b = new ChatBubbles(
      { ...chatContext(), autoDownload: () => current },
      managersWith([message(1, photoMedia(110))]),
    )
    bubbles = b
    await (await b.setPeer())?.promise
    await settle()
    expect(downloadMediaURL).not.toHaveBeenCalled()

    current = ALL
    rootScope.dispatchEventSingle('history_append', {
      storageKey: String(CHAT),
      message: message(2, photoMedia(111)),
    })
    await settle()

    expect(downloadMediaURL).toHaveBeenCalled()
  })
})
