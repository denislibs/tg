// Тесты сбора items вьювера из окна сообщений (Task 16) — чистая логика
// бывшего useLightbox: фильтрация фото/видео (+секретные E2E того же вида),
// порядок окна, single-item фолбэк (сервисное фото), gif-детект и duration,
// секретная ветка (url мимо конвейера downloadMediaURL).
import { describe, expect, it, vi } from 'vitest'
import type { MessageReal, MyMessage } from '@core/models'
import { generateMessageId } from '@core/history/messageId'
import { makeMessage, makeServiceMessage } from '@core/messages/testMessage'
import { saveDocument, THUMB_TYPE_FULL, type MessageMedia } from '@core/media/messageMedia'
import { collectLightboxItems, messageToViewerItem, type LightboxCtx } from './collectLightboxItems'
import type { Chat, User } from '@core/peers/peer'

const { getSecretMediaUrl, peekSecretMediaUrl } = vi.hoisted(() => ({
  getSecretMediaUrl: vi.fn(async () => 'blob:decrypted'),
  peekSecretMediaUrl: vi.fn<(id: number) => string | undefined>(() => undefined),
}))

// Кэш расшифровки секретных медиа — фейк: peek управляется per-тестом
vi.mock('@core/secret/mediaCache', () => ({ getSecretMediaUrl, peekSecretMediaUrl }))

/** Вложение-фотография в форме оригинала: лестница с одной ступенью `w`. */
const photoMedia = (id: number, w = 640, h = 480): MessageMedia => ({
  _: 'messageMediaPhoto',
  photo: { _: 'photo', id, sizes: [{ _: 'photoSize', type: THUMB_TYPE_FULL, w, h, size: 1 }] },
})

/** Вложение-документ: атрибуты те же, что кладёт бэк, тип выводит saveDocument. */
const docMedia = (id: number, mime: string, attrs: Parameters<typeof saveDocument>[0]['attributes']): MessageMedia => ({
  _: 'messageMediaDocument',
  document: saveDocument({ _: 'document', id, mime_type: mime, size: 1, attributes: attrs }),
})

const videoMedia = (id: number, duration: number, animated = false): MessageMedia =>
  docMedia(id, 'video/mp4', [
    { _: 'documentAttributeVideo', duration, w: 320, h: 240 },
    ...(animated ? [{ _: 'documentAttributeAnimated' as const }] : []),
  ])

/** Номер в КЛИЕНТСКОМ пространстве. Вид медиа больше НЕ едет полем `type`:
 *  его выводит само вложение (`media._` + `document.type`), поэтому фикстура
 *  задаёт вложение, а не подпись к нему. */
const cid = generateMessageId

const msg = (over: Partial<MessageReal> = {}): MessageReal => ({
  ...makeMessage({ id: cid(1), peerId: -5, fromId: 10, date: 1_785_924_000 }),
  ...over,
})

const ctx: LightboxCtx = {
  meId: 42,
  meName: 'Я Сам',
  // Карточка пира — КОНСТРУКТОР схемы: имя собирает клиент из first/last_name,
  // превью аватарки лежит в `photo.stripped_thumb`.
  peers: new Map<PeerId, User | Chat>([
    [10, { _: 'user', id: 10, first_name: 'Алиса', photo: { _: 'userProfilePhoto', photo_id: 7, stripped_thumb: 'AVPREV' } }],
  ]),
  chatName: 'Чат',
  lang: 'ru',
}

describe('collectLightboxItems: фильтрация окна', () => {
  it('фото+видео в порядке окна; текст/голос/документ мимо; индекс — по id файла', () => {
    const msgs: MyMessage[] = [
      msg({ id: cid(1), media: photoMedia(101) }),
      msg({ id: cid(2), message: 'привет' }),
      msg({ id: cid(3), media: videoMedia(103, 95) }),
      msg({ id: cid(4), media: docMedia(104, 'audio/ogg', [{ _: 'documentAttributeAudio', pFlags: { voice: true }, duration: 3 }]) }),
      msg({ id: cid(5), media: docMedia(105, 'application/pdf', [{ _: 'documentAttributeFilename', file_name: 'a.pdf' }]) }),
      msg({ id: cid(6), media: photoMedia(106) }),
    ]
    const { items, index } = collectLightboxItems({ msgs, mediaId: 103, ctx })
    expect(items.map((i) => i.media.mediaId)).toEqual([101, 103, 106])
    expect(items.map((i) => i.mid)).toEqual([cid(1), cid(3), cid(6)])
    expect(index).toBe(1)
    expect(items[1].media.kind).toBe('video')
  })

  it('секретные E2E-медиа вида фото/видео включаются (вид — в secretMedia)', () => {
    const msgs: MyMessage[] = [
      msg({ id: cid(1), media: photoMedia(101) }),
      msg({
        id: cid(2), enc_body: 'cipher', media: photoMedia(202),
        secretMedia: { mediaId: 202, keyB64: 'k', ivB64: 'iv', name: 'p.jpg', mime: 'image/jpeg', size: 1, mediaType: 'photo' },
      }),
    ]
    const { items, index } = collectLightboxItems({ msgs, mediaId: 202, ctx })
    expect(items).toHaveLength(2)
    expect(index).toBe(1)
    expect(items[1].media.kind).toBe('photo')
  })

  it('single-item фолбэк: медиа сервисного сообщения (не в ленте фото/видео) → одиночный просмотр', () => {
    const msgs: MyMessage[] = [
      msg({ id: cid(1), media: photoMedia(101) }),
      // Пилюля смены фото группы: фото едет ВНУТРИ действия, вложения у
      // сообщения нет — окно его не видит, и вьювер уходит в одиночный фолбэк.
      makeServiceMessage({
        id: cid(2), peerId: -5, fromId: 10,
        action: { _: 'messageActionChatEditPhoto', photo: { _: 'photo', id: 500, sizes: [] } },
      }),
    ]
    const { items, index } = collectLightboxItems({ msgs, mediaId: 500, ctx })
    expect(items).toHaveLength(1)
    expect(index).toBe(0)
    expect(items[0].media.mediaId).toBe(500)
    expect(items[0].media.kind).toBe('photo')
  })

  it('элементы соседей — из findElement; не отрендеренные остаются null', () => {
    const el = document.createElement('div')
    const msgs: MyMessage[] = [
      msg({ id: cid(1), media: photoMedia(101) }),
      msg({ id: cid(2), media: photoMedia(102) }),
    ]
    const { items } = collectLightboxItems({
      msgs, mediaId: 101, ctx,
      findElement: (m) => (m.id === cid(1) ? el : null),
    })
    expect(items[0].element).toBe(el)
    expect(items[1].element).toBeNull()
  })
})

// tweb base.ts:2360/2479 — вид медиа и «гифка ли это» вьювер берёт У САМОГО
// медиа (`doc.type`), а тип документа выводится из `documentAttributeAnimated`
// (`saveDocument`). Что ломается без этого: гифка получает плеер и play-диск
// вместо автоплей-цикла, а обычное видео — наоборот.
describe('messageToViewerItem: вид, gif и duration — из документа', () => {
  it('documentAttributeAnimated → gif: true; duration — из атрибута видео', () => {
    const it1 = messageToViewerItem(msg({ media: videoMedia(1, 3, true) }), ctx)
    expect(it1.media.kind).toBe('video')
    expect(it1.media.gif).toBe(true)
    expect(it1.media.duration).toBe(3)
  })

  it('без атрибута animated — обычное видео: gif не ставится, duration доезжает', () => {
    const it1 = messageToViewerItem(msg({ media: videoMedia(1, 95) }), ctx)
    expect(it1.media.gif).toBeUndefined()
    expect(it1.media.duration).toBe(95)
  })

  // Имя файла на вид медиа больше не влияет: `tenor.mp4` без атрибута —
  // обычное видео (раньше эвристика имени объявляла его гифкой).
  it('имя файла не делает видео гифкой', () => {
    const media = docMedia(1, 'video/mp4', [
      { _: 'documentAttributeVideo', duration: 0, w: 320, h: 240 },
      { _: 'documentAttributeFilename', file_name: 'tenor_dance.mp4' },
    ])
    expect(messageToViewerItem(msg({ media }), ctx).media.gif).toBeUndefined()
  })

  it('image/gif — гифка по mime (saveDocument: doc.type === gif)', () => {
    const media = docMedia(1, 'image/gif', [{ _: 'documentAttributeFilename', file_name: 'cat.gif' }])
    const item = messageToViewerItem(msg({ media }), ctx)
    expect(item.media.gif).toBe(true)
    // mime не video/*, но doc.type === 'gif' — tweb ведёт такое видео-веткой
    expect(item.media.kind).toBe('video')
  })

  // Размеры и stripped-подложка — тоже из модели: у фотографии это верхняя
  // ступень лестницы и ступень `photoStrippedSize`, а не отдельные поля.
  it('размеры — из лестницы фото, blurPreview — из photoStrippedSize', () => {
    const media: MessageMedia = {
      _: 'messageMediaPhoto',
      photo: {
        _: 'photo',
        id: 1,
        sizes: [
          { _: 'photoStrippedSize', type: 'i', bytes: 'BLUR' },
          { _: 'photoSize', type: THUMB_TYPE_FULL, w: 800, h: 600, size: 10 },
        ],
      },
    }
    const item = messageToViewerItem(msg({ media }), ctx)
    expect(item.media.width).toBe(800)
    expect(item.media.height).toBe(600)
    expect(item.media.blurPreview).toBe('BLUR')
  })
})

describe('messageToViewerItem: секретная ветка (E2E) — мимо конвейера', () => {
  const secret = (id: number) => msg({
    id: cid(id), enc_body: 'cipher', media: photoMedia(id),
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
    expect(messageToViewerItem(msg({ fromId: 42, media: photoMedia(1) }), ctx).author.name).toBe('Я Сам')
    const alien = messageToViewerItem(msg({ fromId: 10, media: photoMedia(1) }), ctx)
    expect(alien.author.name).toBe('Алиса')
    expect(alien.author.avatarPreview).toBe('AVPREV')
    expect(messageToViewerItem(msg({ fromId: 77, media: photoMedia(1) }), ctx).author.name).toBe('Чат')
  })

  it('подпись — текст сообщения + entities', () => {
    const item = messageToViewerItem(msg({ media: photoMedia(1), message: 'подпись', entities: [{ _: 'messageEntityBold', offset: 0, length: 7 }] }), ctx)
    expect(item.caption).toBe('подпись')
    expect(item.captionEntities).toEqual([{ _: 'messageEntityBold', offset: 0, length: 7 }])
  })
})
