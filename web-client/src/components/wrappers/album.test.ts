// wrapAlbum — ванильный порт tweb `components/wrappers/album.ts`.
//
// Пиним то, что делает альбом альбомом, а не колонкой картинок:
//   • ОДИН общий контейнер с пиксельным боксом, ячейки внутри — в процентах;
//   • раскладка считается ПО РАЗМЕРАМ КАЖДОГО элемента (у нас элемент — своё
//     сообщение со своими mediaWidth/mediaHeight);
//   • на каждой ячейке свои data-mid/data-peer-id — по ним лента находит
//     сообщение под кликом/меню/выделением;
//   • дерево и классы совпадают с живым DOM tweb
//     (docs/tweb/dom/dumps/03-album-channel.json).
//
// Мокаем только границу владельца URL (managers.media.downloadMediaURL) —
// prepareAlbum, wrapPhoto, ensureMediaUrl и зеркало работают настоящие.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Message } from '@core/models'

const { downloadMediaURL } = vi.hoisted(() => ({
  downloadMediaURL: vi.fn<(id: number, opts?: { thumb?: boolean }) => Promise<string>>(),
}))
vi.mock('../../client/bootstrap', () => ({
  startClient: () => ({ managers: { media: { downloadMediaURL } } }),
}))

vi.mock('@helpers/blur', () => ({
  default: vi.fn((dataUri: string) => {
    const canvas = document.createElement('canvas')
    canvas.className = 'canvas-thumbnail'
    canvas.dataset.uri = dataUri
    return { canvas, promise: Promise.resolve() }
  }),
}))

let wrapAlbum: typeof import('./album').default

const flush = async () => {
  for (let i = 0; i < 3; ++i) await new Promise<void>((r) => { setTimeout(r, 0) })
}

let seq = 0
function msg(patch: Partial<Message> = {}): Message {
  ++seq
  return {
    id: 100 + seq,
    chatId: -42,
    seq,
    senderId: 1,
    type: 'photo',
    text: '',
    replyToId: null,
    mediaId: 1000 + seq,
    createdAt: '2026-08-16T00:00:00Z',
    threadRootId: null,
    groupedId: 'g1',
    mediaWidth: 1600,
    mediaHeight: 900,
    mediaBlur: 'AAECAwQ=',
    ...patch,
  }
}

beforeEach(async () => {
  vi.resetModules()
  seq = 0
  downloadMediaURL.mockReset()
  downloadMediaURL.mockImplementation((id) => Promise.resolve(`blob:${id}`))
  Object.defineProperty(HTMLImageElement.prototype, 'decode', {
    configurable: true, writable: true, value: () => Promise.resolve(),
  })
  wrapAlbum = (await import('./album')).default
})

afterEach(() => {
  document.body.replaceChildren()
})

const attachment = () => {
  const div = document.createElement('div')
  div.classList.add('attachment')
  return div
}

describe('wrapAlbum', () => {
  it('дерево и классы 1:1 с живым DOM tweb, один общий контейнер', async () => {
    const attachmentDiv = attachment()
    const messages = [msg(), msg(), msg()]

    wrapAlbum({ messages, attachmentDiv })
    await flush()

    expect(attachmentDiv.style.width).toMatch(/^\d+px$/)
    expect(attachmentDiv.style.height).toMatch(/^\d+px$/)
    expect(attachmentDiv.children).toHaveLength(3)

    for (const [idx, div] of [...attachmentDiv.children].entries()) {
      const item = div as HTMLElement
      expect(item.classList.contains('album-item')).toBe(true)
      expect(item.classList.contains('grouped-item')).toBe(true)
      expect(item.style.width).toMatch(/%$/)

      const media = item.firstElementChild as HTMLElement
      expect(media.classList.contains('album-item-media')).toBe(true)
      expect(media.classList.contains('media-container')).toBe(true)
      // ячейку размерами НЕ трогаем: бокс задан гридом (boxWidth/boxHeight = 0)
      expect(media.style.width).toBe('')
      expect(media.querySelector('img.media-photo')).toBeTruthy()
      expect(item.dataset.mid).toBe('' + messages[idx].id)
      expect(item.dataset.peerId).toBe('' + messages[idx].chatId)
    }
  })

  // Ядро: грид — производная от размеров ЭЛЕМЕНТОВ, а не константа.
  it('раскладка считается по размерам каждого элемента', () => {
    const wide = attachment()
    wrapAlbum({ messages: [msg(), msg()], attachmentDiv: wide })

    const tall = attachment()
    wrapAlbum({
      messages: [msg({ mediaWidth: 900, mediaHeight: 1600 }), msg({ mediaWidth: 900, mediaHeight: 1600 })],
      attachmentDiv: tall,
    })

    // две широких — друг под другом, две узких — рядом
    expect(parseFloat((wide.children[1] as HTMLElement).style.top)).toBeGreaterThan(45)
    expect(parseFloat((wide.children[1] as HTMLElement).style.left)).toBeCloseTo(0, 1)
    expect(parseFloat((tall.children[1] as HTMLElement).style.top)).toBeCloseTo(0, 1)
    expect(parseFloat((tall.children[1] as HTMLElement).style.left)).toBeGreaterThan(45)
  })

  it('каждый элемент грузит СВОЁ медиа (свой mediaId), а не медиа первого сообщения', async () => {
    const attachmentDiv = attachment()
    const messages = [msg(), msg(), msg()]

    wrapAlbum({ messages, attachmentDiv })
    await flush()

    expect(downloadMediaURL.mock.calls.map(([id]) => id)).toEqual(messages.map((m) => m.mediaId))
    const srcs = [...attachmentDiv.querySelectorAll('img.media-photo')].map((i) => (i as HTMLImageElement).src)
    expect(srcs).toEqual(messages.map((m) => `blob:${m.mediaId}`))
  })

  it('mediaHasThumb — качается уменьшенная версия', async () => {
    wrapAlbum({ messages: [msg({ mediaHasThumb: true })], attachmentDiv: attachment() })
    await flush()

    expect(downloadMediaURL).toHaveBeenCalledWith(1001, { thumb: true })
  })

  it('автозагрузка фото выключена — к владельцу не ходим', async () => {
    wrapAlbum({
      messages: [msg(), msg()],
      attachmentDiv: attachment(),
      autoDownload: { photo: 0, video: 0, file: 0 },
    })
    await flush()

    expect(downloadMediaURL).not.toHaveBeenCalled()
  })

  it('превью из сообщения появляется до сети', () => {
    const attachmentDiv = attachment()
    wrapAlbum({ messages: [msg(), msg()], attachmentDiv })

    expect(attachmentDiv.querySelectorAll('canvas.canvas-thumbnail.thumbnail.media-photo')).toHaveLength(2)
    expect(attachmentDiv.querySelector('img.media-photo')).toBeNull()
  })

  // Не-фото ячейку рисует wrapVideo (tweb album.ts:100-115) — теми же
  // аргументами: нулевой бокс (грид уже задал размер) и запрет автоплея.
  it('видео-элемент: ячейка рисуется wrapVideo — превью, таймкод и кнопка воспроизведения', async () => {
    const attachmentDiv = attachment()
    const messages = [
      msg(),
      msg({ type: 'video', mediaMime: 'video/mp4', mediaWidth: 900, mediaHeight: 1600, mediaDuration: 46 }),
    ]

    wrapAlbum({ messages, attachmentDiv })
    await flush()

    const videoItem = attachmentDiv.children[1] as HTMLElement
    expect(videoItem.dataset.mid).toBe('' + messages[1].id)
    const mediaDiv = videoItem.firstElementChild!
    expect(mediaDiv.classList.contains('album-item-media')).toBe(true)
    // элемент альбома автоплея не получает: таймкод + кнопка, самого <video> нет
    expect(mediaDiv.querySelector('span.video-time')!.firstChild!.nodeValue).toBe('0:46')
    expect(mediaDiv.querySelector('button.btn-circle.video-play.position-center')).toBeTruthy()
    expect(mediaDiv.querySelector('.video-time-icon')).toBeNull()
    expect(mediaDiv.querySelector('video')).toBeNull()
    // превью ячейки — stripped из самого сообщения (постера у медиа нет)
    expect(mediaDiv.querySelector('canvas.canvas-thumbnail.thumbnail.media-poster')).toBeTruthy()
    // геометрия посчитана по ВСЕМ элементам, включая видео
    expect(parseFloat(videoItem.style.width)).toBeGreaterThan(0)
  })

  it('видео-элемент с серверным постером качает уменьшенную версию, а не полный файл', async () => {
    const attachmentDiv = attachment()
    const messages = [msg({ type: 'video', mediaMime: 'video/mp4', mediaHasThumb: true })]

    wrapAlbum({ messages, attachmentDiv })
    await flush()

    expect(downloadMediaURL).toHaveBeenCalledWith(1001, { thumb: true })
  })

  // tweb album.ts:150-153 — готовый таймкод вызывающего. Нужен ячейке, которую
  // враппер не рисует (непроплаченное платное медиа): длительность знает только
  // вызывающий, и бейдж обязан появиться независимо от загрузки.
  it('videoTimes: готовый таймкод вызывающего кладётся в ячейку, включая неоплаченную', async () => {
    const attachmentDiv = attachment()
    const messages = [msg(), msg({ mediaId: null, paidMedia: { price: 5, locked: true } })]
    const badge = document.createElement('span')
    badge.classList.add('video-time')
    badge.textContent = '0:12'

    wrapAlbum({ messages, attachmentDiv, videoTimes: [undefined, badge] })
    await flush()

    expect(attachmentDiv.children[0].querySelector('.video-time')).toBeNull()
    expect(attachmentDiv.children[1].firstElementChild!.lastElementChild).toBe(badge)
  })
})
