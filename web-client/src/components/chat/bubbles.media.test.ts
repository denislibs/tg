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
import rootScope from '@lib/rootScope'
import type { MessageReactions, MyMessage } from '@core/models'
import type { HistoryResult } from '@core/managers/messagesManager'
import * as viewer from '@components/mediaViewer/openMediaViewer'
import ChatBubbles, { makeFullMid, type BubblesManagers, type ChatContext } from './bubbles'

/** Открыть окно ленты и дождаться ОТРИСОВКИ. `setPeer` (как в оригинале)
 *  возвращает управление, едва отправив запрос: рендер и доводка живут во
 *  ВТОРОМ промисе результата — `{cached, promise}`, и ждёт его `Chat.setPeer`
 *  (tweb chat.ts:1119-1122). */
async function openFeed(feed: ChatBubbles) {
  await (await feed.setPeer())?.promise
}

const CHAT = 60

const chatContext = (): ChatContext => ({
  peerId: CHAT,
  messagesStorageKey: String(CHAT),
  container: document.createElement('div'),
  bubblesViewport: document.createElement('div'),
})

const managersWith = (messages: MyMessage[]): BubblesManagers => ({
  messages: {
    getHistory: vi.fn(async (): Promise<HistoryResult> => ({
      messages, count: messages.length, reachedTop: true, reachedBottom: true,
    })),
    // Прыжок к сообщению и календарь этот файл не проверяет, но обе ручки
    // обязательны в `BubblesManagers`: лента умеет и то и другое всегда.
    getAround: vi.fn(async () => ({ messages, reachedTop: true, reachedBottom: true })),
    messageByDate: vi.fn(async () => null),
  },
  peers: { fillMirror: vi.fn(async () => {}) },
  dialogs: { getReadMaxSeqIfUnread: vi.fn(async () => 0), getHistoryMaxSeq: vi.fn(async () => 0) },
  // Ручка отметки прочтения: наблюдатель непрочитанных живёт в самой ленте
  // (порт tweb bubbles.ts:2941-3012), поэтому она обязательна у КАЖДОГО стенда.
  realtime: { markRead: vi.fn(async () => ({ ok: true })) },
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
beforeEach(() => { resetMessagesMirror(); resetPeerMirror(); vi.restoreAllMocks() })

const bubbleOf = (b: ChatBubbles, mid: number) =>
  b.chatInner.querySelector<HTMLElement>(`.bubble[data-mid="${mid}"]`)!

describe('ChatBubbles — медиа в бабле', () => {
  it('фото заводит .attachment в бабл и класс photo', async () => {
    bubbles = new ChatBubbles(chatContext(), managersWith([withPhoto({ id: 1, text: 'подпись' })]))
    await openFeed(bubbles)
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
    await openFeed(bubbles)
    await settle()

    const bubble = bubbleOf(bubbles, 1)
    expect(bubble.querySelector('.attachment')!.classList.contains('no-brb')).toBe(true)
    expect(bubble.querySelector('.message')!.classList.contains('mt-shorter')).toBe(true)
  })

  it('сообщение БЕЗ вложения вложения не получает', async () => {
    bubbles = new ChatBubbles(chatContext(), managersWith([textOnly(1)]))
    await openFeed(bubbles)
    await settle()

    const bubble = bubbleOf(bubbles, 1)
    expect(bubble.querySelector('.attachment')).toBeNull()
    expect(bubble.classList.contains('photo')).toBe(false)
  })

  it('спойлер кладёт крышку ПОВЕРХ вложения, а не вместо него', async () => {
    bubbles = new ChatBubbles(chatContext(), managersWith([withPhoto({ id: 1, spoiler: true })]))
    await openFeed(bubbles)
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
    await openFeed(bubbles)
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
    await openFeed(bubbles)
    await settle()

    const bubble = bubbleOf(bubbles, 1)
    expect(bubble.classList.contains('round')).toBe(true)
    expect(bubble.classList.contains('video')).toBe(false)
  })

  it('gif идёт той же веткой, что видео', async () => {
    const media = docMedia({
      mime: 'video/mp4',
      // `documentAttributeAnimated` уточняет тип до `gif` только ПОСЛЕ
      // `documentAttributeVideo` — иначе последний перезапишет его обратно в
      // `video` (tweb appDocsManager.ts:161-218).
      attributes: [
        { _: 'documentAttributeVideo', duration: 2, w: 320, h: 240 },
        { _: 'documentAttributeAnimated' },
      ],
    })
    bubbles = new ChatBubbles(chatContext(), managersWith([withDoc(1, media)]))
    await openFeed(bubbles)
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
    await openFeed(bubbles)
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
    await openFeed(bubbles)
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
    await openFeed(bubbles)
    await settle()

    const messageDiv = bubbleOf(bubbles, 1).querySelector('.message')!
    expect(messageDiv.querySelector('audio-element')).not.toBeNull()
  })

  // Альбом: группа `grouped_id` рисуется ОДНИМ баблом (tweb :6600-6605), а
  // прочие её сообщения своих баблов не получают вовсе.
  describe('альбом', () => {
    const album = (ids: number[], groupedId = 900): MyMessage[] =>
      ids.map((id) => makeMessage({
        peerId: CHAT, fromId: 2, id, text: id === ids[0] ? 'подпись' : '',
        createdAt: '2026-08-15T12:00:00Z', media: photoMedia(), groupedId,
      }))

    it('группа из трёх сообщений даёт ОДИН бабл с is-album', async () => {
      bubbles = new ChatBubbles(chatContext(), managersWith(album([1, 2, 3])))
      await openFeed(bubbles)
      await settle()

      const rendered = bubbles.chatInner.querySelectorAll('.bubble:not(.service)')
      expect(rendered).toHaveLength(1)
      const bubble = rendered[0] as HTMLElement
      expect(bubble.classList.contains('is-album')).toBe(true)
      expect(bubble.classList.contains('is-grouped')).toBe(true)
      // Бабл принадлежит ГЛАВНОМУ сообщению — первому по номеру.
      expect(bubble.dataset.mid).toBe('1')
    })

    it('бабл альбома адресуется по номеру ЛЮБОГО сообщения группы', async () => {
      bubbles = new ChatBubbles(chatContext(), managersWith(album([1, 2, 3])))
      await openFeed(bubbles)
      await settle()

      const main = bubbles.getBubble(makeFullMid(CHAT, 1))
      expect(main).toBeDefined()
      // Правка и удаление приходят по СВОЕМУ номеру — они обязаны найти тот же
      // узел, иначе изменение уехало бы в пустоту.
      expect(bubbles.getBubble(makeFullMid(CHAT, 2))).toBe(main)
      expect(bubbles.getBubble(makeFullMid(CHAT, 3))).toBe(main)
    })

    it('maxBubbleMid — СТАРШИЙ номер группы (tweb :6608)', async () => {
      bubbles = new ChatBubbles(chatContext(), managersWith(album([1, 2, 3])))
      await openFeed(bubbles)
      await settle()

      const bubble = bubbles.chatInner.querySelector<HTMLElement>('.bubble:not(.service)')!
      expect(bubble.dataset.maxBubbleMid).toBe('3')
    })

    // Порядок прихода — НЕ гарантия: история идёт от новых к старым, поэтому
    // первым в очередь рендера попадает СТАРШЕЕ сообщение группы. Без явного
    // пропуска не-главных бабл достался бы ему, а не главному.
    it('бабл достаётся главному, даже если группа пришла от старших к младшим', async () => {
      const group = album([1, 2, 3])
      bubbles = new ChatBubbles(chatContext(), managersWith([...group].reverse()))
      await openFeed(bubbles)
      await settle()

      const rendered = bubbles.chatInner.querySelectorAll('.bubble:not(.service)')
      expect(rendered).toHaveLength(1)
      expect((rendered[0] as HTMLElement).dataset.mid).toBe('1')
    })

    it('группа из ОДНОГО сообщения альбомом не считается', async () => {
      bubbles = new ChatBubbles(chatContext(), managersWith(album([1])))
      await openFeed(bubbles)
      await settle()

      const bubble = bubbles.chatInner.querySelector<HTMLElement>('.bubble:not(.service)')!
      expect(bubble.classList.contains('is-album')).toBe(false)
      // Одиночное медиа группы — обычное фото (тот же гейт `length !== 1`).
      expect(bubble.classList.contains('photo')).toBe(true)
    })
  })

  // Клик по крышке спойлера — первая ветка `onBubblesClick`, которую можно
  // портировать: у оригинала она стоит ПЕРЕД именем автора (:3236 против
  // :3360), потому что крышка лежит поверх вложения.
  it('клик по крышке спойлера раскрывает её, а не уходит под неё', async () => {
    bubbles = new ChatBubbles(chatContext(), managersWith([withPhoto({ id: 1, spoiler: true })]))
    await openFeed(bubbles)
    await settle()

    const attachment = bubbleOf(bubbles, 1).querySelector('.attachment')!
    // Крышку в фикстуре строит не враппер (stripped-превью нет), а сам тест —
    // проверяется РОУТИНГ клика, а не сборка канвасов: она покрыта своим
    // тестом (`mediaSpoiler.test.ts`).
    const cover = document.createElement('div')
    cover.classList.add('media-spoiler-container')
    attachment.append(cover)

    // Контейнер ленты слушает делегатом — событие должно всплыть до него.
    document.body.append(bubbles.container)
    cover.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))

    // `toggleMediaSpoiler` помечает крышку раскрывающейся — либо классом
    // перехода, либо флагом анимации.
    expect(cover.classList.contains('is-revealing') || cover.dataset.isRevealing === 'true').toBe(true)
    bubbles.container.remove()
  })

  // Клик по вложению открывает медиавьювер (tweb :3479-3482
  // `checkTargetForMediaViewer`). Список для листания собирается ИЗ ОКНА —
  // вьювер листает уже загруженное, а не ходит за медиа отдельно.
  it('клик по фото открывает вьювер со списком медиа ОКНА', async () => {
    const opened = vi.fn()
    vi.spyOn(viewer, 'openMediaViewer').mockImplementation((args) => { opened(args); return undefined })

    bubbles = new ChatBubbles(chatContext(), managersWith([
      withPhoto({ id: 1 }), textOnly(2), withPhoto({ id: 3 }),
    ]))
    await openFeed(bubbles)
    await settle()

    document.body.append(bubbles.container)
    const attachment = bubbleOf(bubbles, 1).querySelector<HTMLElement>('.attachment')!
    attachment.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))

    expect(opened).toHaveBeenCalledTimes(1)
    const args = opened.mock.calls[0][0] as { items: unknown[]; index: number; reverse?: boolean }
    // В списке ровно два медиа-сообщения окна; текстовое между ними не в счёт.
    expect(args.items).toHaveLength(2)
    expect(args.index).toBe(0)
    // Порядок окна — по возрастанию номера (tweb :3843).
    expect(args.reverse).toBe(true)
    bubbles.container.remove()
  })

  it('клик по вложению документа вьювер НЕ открывает', async () => {
    const opened = vi.fn()
    vi.spyOn(viewer, 'openMediaViewer').mockImplementation((args) => { opened(args); return undefined })

    const media = docMedia({ mime: 'application/pdf', attributes: [{ _: 'documentAttributeFilename', file_name: 'смета.pdf' }] })
    bubbles = new ChatBubbles(chatContext(), managersWith([withDoc(1, media)]))
    await openFeed(bubbles)
    await settle()

    document.body.append(bubbles.container)
    // У документа вложения нет вовсе — строка живёт в теле сообщения, и
    // квалификацию просматриваемого медиа она не проходит.
    bubbleOf(bubbles, 1).querySelector<HTMLElement>('.document')
      ?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))

    expect(opened).not.toHaveBeenCalled()
    bubbles.container.remove()
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
    await openFeed(bubbles)
    await settle()

    const content = bubbleOf(bubbles, 1).querySelector<HTMLElement>('.bubble-content')!
    const attachment = bubbleOf(bubbles, 1).querySelector<HTMLElement>('.attachment')!
    expect(attachment.style.width).not.toBe('')
    expect(content.style.minWidth).toBe(attachment.style.width)
    expect(content.style.minHeight).toBe(attachment.style.height)
  })

  // ПРАВКА И МЕДИА В ТЕЛЕ. У документа узел стоит В ТЕЛЕ сообщения
  // (`noAttachmentDivNeeded`, tweb :8645), а не во вложении, — и потому
  // попадал под пересборку тела. `message_edit` у нас при этом воронка ЛЮБОГО
  // патча (`core/history/messagesMirror.ts:191-192`: реакция, `media_read`,
  // опрос), так что строка файла пропадала от чужого клика по реакции.
  //
  // Вложение (фото/видео) той же беды не знало — оно лежит рядом с телом,
  // поэтому здесь проверяется именно тело.
  describe('правка сообщения с документом', () => {
    const docFile = () => docMedia({
      mime: 'application/pdf',
      attributes: [{ _: 'documentAttributeFilename', file_name: 'смета.pdf' }],
    })

    const withCaption = (media: MessageMedia, over: { reactions?: MessageReactions } = {}): MyMessage => ({
      ...makeMessage({
        peerId: CHAT, fromId: 2, id: 1, text: 'подпись', createdAt: '2026-08-15T12:00:00Z', media,
      }),
      ...(over.reactions ? { reactions: over.reactions } : {}),
    } as MyMessage)

    const reactions: MessageReactions = {
      _: 'messageReactions',
      results: [{ _: 'reactionCount', reaction: { _: 'reactionEmoji', emoticon: '👍' }, count: 2 }],
    }

    const editTo = (message: MyMessage) => {
      rootScope.dispatchEventSingle('message_edit', {
        storageKey: String(CHAT), peerId: CHAT, mid: message.id, message,
      })
    }

    it('чужая реакция (патч, а не правка текста) не уносит строку документа и подпись', async () => {
      const media = docFile()
      bubbles = new ChatBubbles(chatContext(), managersWith([withCaption(media)]))
      await openFeed(bubbles)
      await settle()

      const messageDiv = bubbleOf(bubbles, 1).querySelector<HTMLElement>('.message')!
      const before = messageDiv.querySelector<HTMLElement>('.document')!
      expect(before).not.toBeNull()

      editTo(withCaption(media, { reactions }))

      const after = messageDiv.querySelector<HTMLElement>('.document')
      expect(after).not.toBeNull()
      // Узел ТОТ ЖЕ: он живой (кольцо загрузки, `ProgressivePreloader`), и
      // пересобирать его на каждый чужой клик нельзя.
      expect(after).toBe(before)
      expect(messageDiv.textContent).toContain('подпись')
      // Реакция — то, ради чего патч и приехал.
      expect(messageDiv.querySelectorAll('.reaction')).toHaveLength(1)
    })

    it('строка документа остаётся ПЕРЕД подписью, а время — в конце тела', async () => {
      const media = docFile()
      bubbles = new ChatBubbles(chatContext(), managersWith([withCaption(media)]))
      await openFeed(bubbles)
      await settle()

      editTo(withCaption(media))

      const messageDiv = bubbleOf(bubbles, 1).querySelector<HTMLElement>('.message')!
      expect(messageDiv.firstElementChild).toBe(messageDiv.querySelector('.document'))
      expect(messageDiv.lastElementChild).toBe(messageDiv.querySelector('.time'))
      // Подпись — между ними, и она ОДНА: правка не должна её дублировать.
      expect(messageDiv.textContent!.match(/подпись/g)).toHaveLength(1)
      // Подложка бабла (:8616-8618) тоже одна — её кладёт только рендер медиа.
      expect(bubbleOf(bubbles, 1).querySelectorAll('.bubble-content-background')).toHaveLength(1)
    })

    it('плеер голосового переживает правку тем же списком', async () => {
      const media = docMedia({
        mime: 'audio/ogg',
        attributes: [{ _: 'documentAttributeAudio', duration: 4, pFlags: { voice: true } }],
      })
      bubbles = new ChatBubbles(chatContext(), managersWith([withCaption(media)]))
      await openFeed(bubbles)
      await settle()

      const messageDiv = bubbleOf(bubbles, 1).querySelector<HTMLElement>('.message')!
      const before = messageDiv.querySelector<HTMLElement>('audio-element')!
      expect(before).not.toBeNull()

      editTo(withCaption(media, { reactions }))

      expect(messageDiv.querySelector('audio-element')).toBe(before)
      expect(messageDiv.textContent).toContain('подпись')
    })
  })
})
