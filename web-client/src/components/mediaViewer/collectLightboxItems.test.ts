// Тесты сбора items вьювера из окна сообщений (Task 16) — чистая логика
// бывшего useLightbox: фильтрация фото/видео (+секретные E2E того же вида),
// порядок окна, single-item фолбэк (сервисное фото), gif-детект и duration,
// секретная ветка (url мимо конвейера downloadMediaURL).
import { describe, expect, it, vi } from 'vitest'
import type { Message } from '@core/models'
import { collectLightboxItems, messageToViewerItem, type LightboxCtx } from './collectLightboxItems'

const { getSecretMediaUrl, peekSecretMediaUrl } = vi.hoisted(() => ({
  getSecretMediaUrl: vi.fn(async () => 'blob:decrypted'),
  peekSecretMediaUrl: vi.fn<(id: number) => string | undefined>(() => undefined),
}))

// Кэш расшифровки секретных медиа — фейк: peek управляется per-тестом
vi.mock('@core/secret/mediaCache', () => ({ getSecretMediaUrl, peekSecretMediaUrl }))

const msg = (over: Partial<Message>): Message => ({
  id: 1,
  chatId: 5,
  seq: 1,
  senderId: 10,
  type: 'photo',
  text: '',
  replyToId: null,
  mediaId: null,
  createdAt: '2026-08-01T10:00:00Z',
  threadRootId: null,
  ...over,
})

const ctx: LightboxCtx = {
  meId: 42,
  meName: 'Я Сам',
  peers: new Map([[10, { displayName: 'Алиса', avatarPreview: 'AVPREV' }]]),
  chatName: 'Чат',
  lang: 'ru',
}

describe('collectLightboxItems: фильтрация окна', () => {
  it('фото+видео в порядке окна; текст/голос/документ мимо; индекс — по mediaId', () => {
    const msgs = [
      msg({ id: 1, seq: 1, type: 'photo', mediaId: 101 }),
      msg({ id: 2, seq: 2, type: 'text', text: 'привет' }),
      msg({ id: 3, seq: 3, type: 'video', mediaId: 103 }),
      msg({ id: 4, seq: 4, type: 'voice', mediaId: 104 }),
      msg({ id: 5, seq: 5, type: 'document', mediaId: 105 }),
      msg({ id: 6, seq: 6, type: 'photo', mediaId: 106 }),
    ]
    const { items, index } = collectLightboxItems({ msgs, mediaId: 103, ctx })
    expect(items.map((i) => i.media.mediaId)).toEqual([101, 103, 106])
    expect(items.map((i) => i.mid)).toEqual([1, 3, 6])
    expect(items.map((i) => i.seq)).toEqual([1, 3, 6].map((id) => msgs.find((m) => m.id === id)!.seq))
    expect(index).toBe(1)
    expect(items[1].media.kind).toBe('video')
  })

  it('секретные E2E-медиа вида фото/видео включаются (type в сторе — encrypted)', () => {
    const msgs = [
      msg({ id: 1, type: 'photo', mediaId: 101 }),
      msg({
        id: 2, type: 'encrypted', mediaId: 202,
        secretMedia: { mediaId: 202, keyB64: 'k', ivB64: 'iv', name: 'p.jpg', mime: 'image/jpeg', size: 1, mediaType: 'photo' },
      }),
    ]
    const { items, index } = collectLightboxItems({ msgs, mediaId: 202, ctx })
    expect(items).toHaveLength(2)
    expect(index).toBe(1)
    expect(items[1].media.kind).toBe('photo')
  })

  it('single-item фолбэк: медиа сервисного сообщения (не в ленте фото/видео) → одиночный просмотр', () => {
    const msgs = [
      msg({ id: 1, type: 'photo', mediaId: 101 }),
      msg({ id: 2, type: 'service', mediaId: 500, text: 'Фото группы обновлено' }),
    ]
    const { items, index } = collectLightboxItems({ msgs, mediaId: 500, ctx })
    expect(items).toHaveLength(1)
    expect(index).toBe(0)
    expect(items[0].media.mediaId).toBe(500)
    expect(items[0].media.kind).toBe('photo')
  })

  it('элементы соседей — из findElement; не отрендеренные остаются null', () => {
    const el = document.createElement('div')
    const msgs = [
      msg({ id: 1, type: 'photo', mediaId: 101 }),
      msg({ id: 2, type: 'photo', mediaId: 102 }),
    ]
    const { items } = collectLightboxItems({
      msgs, mediaId: 101, ctx,
      findElement: (m) => (m.id === 1 ? el : null),
    })
    expect(items[0].element).toBe(el)
    expect(items[1].element).toBeNull()
  })
})

describe('messageToViewerItem: gif-детект и честная duration (критерий бабла, core/gifs.ts)', () => {
  it('tenor-mp4 → gif: true; duration мапится из меты', () => {
    const it1 = messageToViewerItem(msg({ type: 'video', mediaId: 1, mediaMime: 'video/mp4', mediaName: 'tenor_dance.mp4', mediaDuration: 3 }), ctx)
    expect(it1.media.gif).toBe(true)
    expect(it1.media.duration).toBe(3)
  })

  it('обычное именованное видео → gif не ставится, duration доезжает (иначе loop у всех)', () => {
    const it1 = messageToViewerItem(msg({ type: 'video', mediaId: 1, mediaMime: 'video/mp4', mediaName: 'movie.mp4', mediaDuration: 95 }), ctx)
    expect(it1.media.gif).toBeUndefined()
    expect(it1.media.duration).toBe(95)
  })

  it('безымянный mp4 с duration 0 — gif (наш бэк не считает длительность, см. isGifLike)', () => {
    const it1 = messageToViewerItem(msg({ type: 'video', mediaId: 1, mediaMime: 'video/mp4', mediaName: undefined, mediaDuration: 0 }), ctx)
    expect(it1.media.gif).toBe(true)
  })
})

describe('messageToViewerItem: секретная ветка (E2E) — мимо конвейера', () => {
  const secret = (id: number) => msg({
    id, type: 'encrypted', mediaId: id,
    secretMedia: { mediaId: id, keyB64: 'kk', ivB64: 'ii', name: 's.jpg', mime: 'image/jpeg', size: 9, mediaType: 'photo' },
  })

  it('уже расшифрованное (peek) → url готовой строкой (она же ghost-подложка)', () => {
    peekSecretMediaUrl.mockReturnValueOnce('blob:already')
    const item = messageToViewerItem(secret(7), ctx)
    expect(item.media.url).toBe('blob:already')
  })

  it('не расшифрованное → ленивый резолвер, зовущий getSecretMediaUrl с ключами; конвейер не участвует', async () => {
    peekSecretMediaUrl.mockReturnValueOnce(undefined)
    const item = messageToViewerItem(secret(8), ctx)
    expect(typeof item.media.url).toBe('function')
    expect(getSecretMediaUrl).not.toHaveBeenCalled() // лениво: до показа не качаем
    const url = await (item.media.url as () => Promise<string>)()
    expect(url).toBe('blob:decrypted')
    expect(getSecretMediaUrl).toHaveBeenCalledWith(8, 'kk', 'ii', 'image/jpeg')
  })
})

describe('messageToViewerItem: автор', () => {
  it('своё — meName, чужое — из peers (+avatarPreview), фолбэк — имя чата', () => {
    expect(messageToViewerItem(msg({ senderId: 42, type: 'photo', mediaId: 1 }), ctx).author.name).toBe('Я Сам')
    const alien = messageToViewerItem(msg({ senderId: 10, type: 'photo', mediaId: 1 }), ctx)
    expect(alien.author.name).toBe('Алиса')
    expect(alien.author.avatarPreview).toBe('AVPREV')
    expect(messageToViewerItem(msg({ senderId: 77, type: 'photo', mediaId: 1 }), ctx).author.name).toBe('Чат')
  })

  it('подпись — текст сообщения + entities', () => {
    const item = messageToViewerItem(msg({ type: 'photo', mediaId: 1, text: 'подпись', entities: [{ type: 'bold', offset: 0, length: 7 }] }), ctx)
    expect(item.caption).toBe('подпись')
    expect(item.captionEntities).toEqual([{ type: 'bold', offset: 0, length: 7 }])
  })
})
