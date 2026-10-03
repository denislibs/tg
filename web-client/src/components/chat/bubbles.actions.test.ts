// ДЕЙСТВИЯ САМОГО БАБЛА, вернувшиеся в ленту после сноса React-ленты.
//
// Три предмета, у каждого свой владелец в оригинале:
//   • ОТМЕНА ОТДАЧИ ФАЙЛА — кольцо с крестиком на неотправленном бабле
//     (tweb wrappers/photo.ts:238-239 + preloader.ts:144-158). Лента отвечает
//     за одно: дать врапперу ОТМЕНЯЕМЫЙ промис отдачи (`uploadPromiseFor`) —
//     ровно то, что у оригинала отдаёт `appDownloadManager.getUpload(
//     uploadingFileName)`;
//   • ТОЧКА «НЕ ПРОСЛУШАНО» у голосового и кружка — её гейт `media_unread`
//     лента обязана донести до враппера (tweb bubbles.ts кладёт в него весь
//     `Message.message`, а наши врапперы берут срез);
//   • ПЕРЕЗВОН по баблу лога звонка — ветка `bubble-call` в делегированном
//     обработчике (tweb bubbles.ts:3617-3633) и место вызова бабла
//     (:10067-10083; сам бабл — `wrappers/callBubble.ts`, свой тест рядом).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetMessagesMirror } from '@core/history/messagesMirror'
import { resetPeerMirror } from '@core/peerCache'
import { saveDocument, THUMB_TYPE_FULL, type DocumentAttribute, type MessageMedia } from '@core/media/messageMedia'
import { makeMessage, makeServiceMessage } from '@core/messages/testMessage'
import { generateTempMessageId } from '@core/history/messageId'
import rootScope from '@lib/rootScope'
import type { MyMessage } from '@core/models'
import type { HistoryResult } from '@core/managers/messagesManager'
import { mediaPlayback } from '@core/audio/mediaPlaybackController'
import type ChatBubbles from './bubbles'
import type { BubblesManagers } from './bubbles'
import { createTestChat, mountTestBubbles } from './testChat'

// Отметка «просмотрено/прослушано» уходит в воркер; мокается ГРАНИЦА — сама
// ручка, как и остальные менеджеры этого стенда.
const { markMediaPlayed } = vi.hoisted(() => ({ markMediaPlayed: vi.fn() }))
vi.mock('@core/mediaRead', () => ({ markMediaPlayed }))

// Кружок заводит элемент в контроллере коллекции, а тот идёт за байтами через
// воркер (`startClient`) — в тестовой среде `Worker` не существует. Мокается та
// же граница, что в `wrappers/video.test.ts`: только `managers.media`.
vi.mock('../../client/bootstrap', () => ({
  startClient: () => ({
    managers: {
      media: {
        downloadMediaURL: async (id: number) => `blob:${id}`,
        contentUrl: async (id: number) => `/api/media/${id}/content`,
        streamUrl: async (id: number) => `/api/media/${id}/stream`,
        tokenInfo: async () => ({ token: 'T', expiresAt: Date.now() + 900_000 }),
      },
    },
  }),
}))

async function openFeed(feed: ChatBubbles) {
  await (await feed.setPeer())?.promise
}

/** Дать очереди рендера и промисам враппера разобраться. */
async function settle() {
  for (let i = 0; i < 5; ++i) {
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
}

const CHAT = 77

const cancelPending = vi.fn(async () => ({ ok: true }))
const callUser = vi.fn()

const chatContext = () => createTestChat({ peerId: CHAT, appImManager: { callUser } })

const managersWith = (messages: MyMessage[]): BubblesManagers => ({
  messages: {
    getHistory: vi.fn(async (): Promise<HistoryResult> => ({
      messages, count: messages.length, reachedTop: true, reachedBottom: true,
    })),
    getAround: vi.fn(async () => ({ messages, reachedTop: true, reachedBottom: true })),
    messageByDate: vi.fn(async () => null),
    cancelPending,
  },
  peers: { fillMirror: vi.fn(async () => {}) },
  dialogs: { getReadMaxSeqIfUnread: vi.fn(async () => 0), getHistoryMaxSeq: vi.fn(async () => 0), getDialogReadState: vi.fn(async () => undefined) },
  realtime: { markRead: vi.fn(async () => ({ ok: true })) },
})

const photoMedia = (): MessageMedia => ({
  _: 'messageMediaPhoto',
  photo: { _: 'photo', id: 11, sizes: [{ _: 'photoSize', type: THUMB_TYPE_FULL, w: 800, h: 600, size: 1024 }] },
})

/** `id` разный у каждого кейса НАРОЧНО: коллекция плеера модульная и переживает
 *  кейс, поэтому одинаковый id вернул бы из `getMedia` элемент предыдущего
 *  теста — и отрицательная проверка прошла бы вхолостую. */
const docMedia = (over: { id?: number; mime: string; attributes: DocumentAttribute[] }): MessageMedia => ({
  _: 'messageMediaDocument',
  document: saveDocument({
    _: 'document', id: over.id ?? 22, mime_type: over.mime, size: 2048, attributes: over.attributes,
  }),
})

/** Неотправленный бабл: ДРОБНЫЙ номер (`isLocalMessageId`) + `random_id` —
 *  ровно те два признака, по которым лента узнаёт «файл ещё отдаётся». */
const pendingPhoto = (clientMsgId: string, over: { failed?: boolean } = {}): MyMessage =>
  makeMessage({
    peerId: CHAT, fromId: 1, id: generateTempMessageId(10), out: true, text: '',
    createdAt: '2026-08-20T10:00:00Z', media: photoMedia(), randomId: clientMsgId,
    ...(over.failed ? { failed: true } : {}),
  })

const roundDoc = (id?: number) => docMedia({
  id,
  mime: 'video/mp4',
  attributes: [{ _: 'documentAttributeVideo', duration: 3, w: 384, h: 384, pFlags: { round_message: true } }],
})

const voiceDoc = () => docMedia({
  mime: 'audio/ogg',
  attributes: [{ _: 'documentAttributeAudio', duration: 4, pFlags: { voice: true } }],
})

const callMessage = (over: {
  id: number
  out?: boolean
  video?: boolean
  duration?: number
  reason?: 'phoneCallDiscardReasonBusy' | 'phoneCallDiscardReasonMissed' | 'phoneCallDiscardReasonHangup'
}): MyMessage =>
  makeServiceMessage({
    peerId: CHAT, fromId: over.out ? 1 : CHAT, id: over.id, out: over.out,
    createdAt: '2026-08-20T10:00:00Z',
    action: {
      _: 'messageActionPhoneCall',
      ...(over.video ? { pFlags: { video: true as const } } : {}),
      ...(over.duration !== undefined ? { duration: over.duration } : {}),
      ...(over.reason ? { reason: { _: over.reason } } : {}),
    },
  })

let bubbles: ChatBubbles | undefined
afterEach(() => { bubbles?.destroy(); bubbles = undefined })
beforeEach(() => {
  resetMessagesMirror()
  resetPeerMirror()
  // «Моё» сообщение — `fromId === rootScope.myId` (`isOurMessage`,
  // `core/models.ts:458`); от него же зависит сторона бабла и, значит, заголовок
  // лога звонка.
  rootScope.myId = 1
  cancelPending.mockClear()
  callUser.mockClear()
  markMediaPlayed.mockClear()
})

const bubbleOf = (b: ChatBubbles, mid: number) =>
  b.chatInner.querySelector<HTMLElement>(`.bubble[data-mid="${mid}"]`)!

// ─── отмена отдачи файла ────────────────────────────────────────────────────

describe('ChatBubbles — отмена отдачи файла с бабла', () => {
  it('у неотправленного медиа-бабла кольцо ОТМЕНЯЕМОЕ: клик по нему рвёт отправку', async () => {
    const message = pendingPhoto('c-1')
    bubbles = mountTestBubbles(chatContext(), managersWith([message]))
    await openFeed(bubbles)
    await settle()

    const attachment = bubbleOf(bubbles, message.id).querySelector('.attachment')!
    const preloader = attachment.querySelector<HTMLElement>('.preloader-container')
    expect(preloader).not.toBeNull()
    // Крестик — признак `cancelable`-кольца (preloader.ts:108-124). Именно он
    // отличает «отдаётся, можно отменить» от «скачивается».
    expect(preloader!.querySelector('.preloader-close')).not.toBeNull()

    preloader!.dispatchEvent(new MouseEvent('click', { bubbles: true }))

    // Адрес отмены — `clientMsgId` (`random_id` сообщения), а не номер бабла:
    // серверного номера у него ещё нет.
    expect(cancelPending).toHaveBeenCalledWith({ clientMsgId: 'c-1' })
  })

  it('кадр media:upload_progress двигает кольцо, а done его снимает', async () => {
    const message = pendingPhoto('c-2')
    bubbles = mountTestBubbles(chatContext(), managersWith([message]))
    await openFeed(bubbles)
    await settle()

    const attachment = bubbleOf(bubbles, message.id).querySelector('.attachment')!
    const circle = attachment.querySelector<SVGCircleElement>('.preloader-path-new')!
    // Промис отдачи «свежий» — дуга ещё не двигалась.
    expect(circle.style.strokeDasharray).toBe('')

    rootScope.dispatchEvent('media:upload_progress', { id: 'c-2', loaded: 5, total: 10 })
    // Половина отданных байт — половина дуги (`setProgress`, preloader.ts:299).
    expect(circle.style.strokeDasharray).toBe('74.91236877441406, 149.82473754882812')

    // `done` разрешает промис — кольцо доводится до 100% и уходит. Уход
    // отложенный: `attachPromise` ждёт три четверти времени перехода дуги
    // (preloader.ts:191-201), а `detach` снимает узел уже по концу собственного
    // перехода — отсюда ожидание живым временем.
    rootScope.dispatchEvent('media:upload_progress', { id: 'c-2', loaded: 10, total: 10, done: true })
    await new Promise((resolve) => setTimeout(resolve, 600))
    expect(attachment.querySelector('.preloader-container')).toBeNull()
  })

  it('у альбома отдача СВОЯ у каждой ячейки: крестик отменяет именно её', async () => {
    // tweb album.ts:97 — `uploadingFileName?.[idx]`: фотографии альбома уходят
    // по одной, и у каждой ячейки свой промис.
    const first = makeMessage({
      peerId: CHAT, fromId: 1, id: generateTempMessageId(10), out: true, text: '',
      createdAt: '2026-08-20T10:00:00Z', media: photoMedia(), randomId: 'a-1', groupedId: 9,
    })
    const second = makeMessage({
      peerId: CHAT, fromId: 1, id: generateTempMessageId(first.id), out: true, text: '',
      createdAt: '2026-08-20T10:00:00Z', media: photoMedia(), randomId: 'a-2', groupedId: 9,
    })
    bubbles = mountTestBubbles(chatContext(), managersWith([first, second]))
    await openFeed(bubbles)
    await settle()

    const attachment = bubbleOf(bubbles, first.id).querySelector('.attachment')!
    const cells = attachment.querySelectorAll<HTMLElement>('.album-item')
    expect(cells.length).toBe(2)

    cells[1].querySelector<HTMLElement>('.preloader-container')!
      .dispatchEvent(new MouseEvent('click', { bubbles: true }))

    expect(cancelPending).toHaveBeenCalledWith({ clientMsgId: 'a-2' })
  })

  it('у ОТПРАВЛЕННОГО медиа-бабла отменять нечего: клик по кольцу отправку не рвёт', async () => {
    // Кольцо у скачивания тоже `cancelable` (оно отменяет ЗАГРУЗКУ), поэтому
    // отличие не в разметке, а в том, к чему привязан промис: у отправленного
    // сообщения отдачи нет вовсе — `uploadPromiseFor` возвращает `undefined`.
    const sent = makeMessage({
      peerId: CHAT, fromId: 1, id: 5, out: true, text: '',
      createdAt: '2026-08-20T10:00:00Z', media: photoMedia(),
    })
    bubbles = mountTestBubbles(chatContext(), managersWith([sent]))
    await openFeed(bubbles)
    await settle()

    bubbleOf(bubbles, 5).querySelector('.attachment')!
      .querySelectorAll<HTMLElement>('.preloader-container')
      .forEach((node) => node.dispatchEvent(new MouseEvent('click', { bubbles: true })))

    expect(cancelPending).not.toHaveBeenCalled()
  })

  it('у УПАВШЕЙ отправки отдавать уже нечего: клик по кольцу отмену не зовёт', async () => {
    const failed = pendingPhoto('c-3', { failed: true })
    bubbles = mountTestBubbles(chatContext(), managersWith([failed]))
    await openFeed(bubbles)
    await settle()

    bubbleOf(bubbles, failed.id).querySelector('.attachment')!
      .querySelectorAll<HTMLElement>('.preloader-container')
      .forEach((node) => node.dispatchEvent(new MouseEvent('click', { bubbles: true })))

    expect(cancelPending).not.toHaveBeenCalled()
  })
})

// ─── точка «не прослушано» ──────────────────────────────────────────────────

describe('ChatBubbles — «прослушано» у голосового и кружка', () => {
  it('чужой непрослушанный кружок получает is-unread', async () => {
    const message = makeMessage({
      peerId: CHAT, fromId: CHAT, id: 3, text: '',
      createdAt: '2026-08-20T10:00:00Z', media: roundDoc(), mediaUnread: true,
    })
    bubbles = mountTestBubbles(chatContext(), managersWith([message]))
    await openFeed(bubbles)
    await settle()

    const round = bubbleOf(bubbles, 3).querySelector<HTMLElement>('.media-round')!
    expect(round.classList.contains('is-unread')).toBe(true)
    // Адрес узла — по нему его находит глобальный слушатель прочтения медиа
    // (`components/audio.ts`, порт tweb audio.ts:47-54).
    expect(round.dataset.mid).toBe('3')
    expect(round.dataset.peerId).toBe(String(CHAT))
  })

  it('уже прослушанный кружок точки не получает', async () => {
    const message = makeMessage({
      peerId: CHAT, fromId: CHAT, id: 3, text: '',
      createdAt: '2026-08-20T10:00:00Z', media: roundDoc(),
    })
    bubbles = mountTestBubbles(chatContext(), managersWith([message]))
    await openFeed(bubbles)
    await settle()

    expect(bubbleOf(bubbles, 3).querySelector('.media-round')!.classList.contains('is-unread')).toBe(false)
  })

  it('чужое непрослушанное голосовое получает is-unread', async () => {
    const message = makeMessage({
      peerId: CHAT, fromId: CHAT, id: 4, text: '',
      createdAt: '2026-08-20T10:00:00Z', media: voiceDoc(), mediaUnread: true,
    })
    bubbles = mountTestBubbles(chatContext(), managersWith([message]))
    await openFeed(bubbles)
    await settle()

    const audio = bubbleOf(bubbles, 4).querySelector<HTMLElement>('audio-element')!
    expect(audio.classList.contains('is-unread')).toBe(true)
  })

  it('СВОЁ голосовое едет в узел исходящим: точка у него значит «ещё не слушали»', async () => {
    // tweb audio.ts:571 ставит точку по одному лишь `media_unread` — и у своего
    // голосового тоже: там она значит «собеседник ещё не слушал». Гасить её
    // не нам, и `out` — ровно тот гейт, который это решает
    // (`markPlayed`, `components/audio.ts:543`; у оригинала на его месте
    // `message.fromId !== rootScope.myId`, appMediaPlaybackController.ts:452).
    const message = makeMessage({
      peerId: CHAT, fromId: 1, id: 6, out: true, text: '',
      createdAt: '2026-08-20T10:00:00Z', media: voiceDoc(), mediaUnread: true,
    })
    bubbles = mountTestBubbles(chatContext(), managersWith([message]))
    await openFeed(bubbles)
    await settle()

    const audio = bubbleOf(bubbles, 6).querySelector<HTMLElement>('audio-element')!
    expect(audio.dataset.mid).toBe('6')
    expect(audio.classList.contains('is-unread')).toBe(true)
    // Признак, по которому узел узнаёт «это моё» (`wrapVoiceMessage`,
    // `components/audio.ts:165`): без него `markPlayed` погасил бы СВОЮ точку.
    expect(audio.classList.contains('is-out')).toBe(true)
  })

  it('первое движение времени ЧУЖОГО кружка шлёт отметку «просмотрено»', async () => {
    const message = makeMessage({
      peerId: CHAT, fromId: CHAT, id: 7, text: '',
      createdAt: '2026-08-20T10:00:00Z', media: roundDoc(220), mediaUnread: true,
    })
    bubbles = mountTestBubbles(chatContext(), managersWith([message]))
    await openFeed(bubbles)
    await settle()

    // Элемент со звуком принадлежит СООБЩЕНИЮ и живёт в контроллере коллекции —
    // на нём же висит одноразовый `timeupdate` оригинала.
    const media = mediaPlayback.getMedia(220)!
    media.dispatchEvent(new Event('timeupdate'))

    expect(markMediaPlayed).toHaveBeenCalledWith(CHAT, 7)
  })

  it('СВОЙ кружок отметку «просмотрено» не шлёт', async () => {
    const message = makeMessage({
      peerId: CHAT, fromId: 1, id: 7, out: true, text: '',
      createdAt: '2026-08-20T10:00:00Z', media: roundDoc(221), mediaUnread: true,
    })
    bubbles = mountTestBubbles(chatContext(), managersWith([message]))
    await openFeed(bubbles)
    await settle()

    const media = mediaPlayback.getMedia(221)
    expect(media).toBeTruthy() // иначе проверка ниже прошла бы вхолостую
    media!.dispatchEvent(new Event('timeupdate'))

    expect(markMediaPlayed).not.toHaveBeenCalled()
  })
})

// ─── бабл звонка и перезвон ─────────────────────────────────────────────────

describe('ChatBubbles — лог звонка', () => {
  it('исходящий видеозвонок: .bubble-call с data-type=video внутри тела', async () => {
    const message = callMessage({ id: 8, out: true, video: true, duration: 65, reason: 'phoneCallDiscardReasonHangup' })
    bubbles = mountTestBubbles(chatContext(), managersWith([message]))
    await openFeed(bubbles)
    await settle()

    const bubble = bubbleOf(bubbles, 8)
    // Пилюлей звонок НЕ рисуется (tweb подменяет действие медиа `messageMediaCall`).
    expect(bubble.classList.contains('service')).toBe(false)
    expect(bubble.classList.contains('call-message')).toBe(true)

    const call = bubble.querySelector<HTMLElement>('.bubble-call')!
    expect(call.dataset.type).toBe('video')
    // Узел лежит В ТЕЛЕ сообщения (tweb :10080), вложения у ветки нет.
    expect(call.parentElement?.classList.contains('message')).toBe(true)
    expect(bubble.querySelector('.attachment')).toBeNull()

    expect(call.querySelector('.bubble-call-title')!.textContent).toBe('Outgoing Video Call')
    const status = call.querySelector<HTMLElement>('.bubble-call-status')!
    expect(status.textContent).toContain('1 minute, 5 seconds')
    expect(call.querySelector('.bubble-call-arrow-green')).not.toBeNull()
  })

  it('у бабла звонка НЕТ блока времени: время печатает строка статуса (tweb `noMessageInfo`)', async () => {
    const message = callMessage({ id: 12, out: true, duration: 3, reason: 'phoneCallDiscardReasonHangup' })
    bubbles = mountTestBubbles(chatContext(), managersWith([message]))
    await openFeed(bubbles)
    await settle()

    const bubble = bubbleOf(bubbles, 12)
    expect(bubble.querySelector('.time')).toBeNull()
    expect(bubble.querySelector('.clearfix')).toBeNull()
    expect(bubble.querySelector('.bubble-call-status')!.textContent).toMatch(/^\d{1,2}:\d{2}/)
  })

  it('отменённый исходящий у звонящего — «Cancelled Call», красная стрелка, только время', async () => {
    const message = callMessage({ id: 9, out: true, reason: 'phoneCallDiscardReasonMissed' })
    bubbles = mountTestBubbles(chatContext(), managersWith([message]))
    await openFeed(bubbles)
    await settle()

    const call = bubbleOf(bubbles, 9).querySelector<HTMLElement>('.bubble-call')!
    expect(call.dataset.type).toBe('voice')
    expect(call.querySelector('.bubble-call-title')!.textContent).toBe('Cancelled Call')
    expect(call.querySelector('.bubble-call-status')!.textContent).toMatch(/^\d{1,2}:\d{2}( [AP]M)?$/)
    expect(call.querySelector('.bubble-call-arrow-red')).not.toBeNull()
  })

  it('отклонённый — у адресата «Declined Call»', async () => {
    const message = callMessage({ id: 13, reason: 'phoneCallDiscardReasonBusy' })
    bubbles = mountTestBubbles(chatContext(), managersWith([message]))
    await openFeed(bubbles)
    await settle()

    expect(bubbleOf(bubbles, 13).querySelector('.bubble-call-title')!.textContent).toBe('Declined Call')
  })

  it('клик по баблу звонка перезванивает ТЕМ ЖЕ типом, что лежит на узле', async () => {
    const message = callMessage({ id: 10, out: true, video: true, duration: 12 })
    bubbles = mountTestBubbles(chatContext(), managersWith([message]))
    await openFeed(bubbles)
    await settle()

    const title = bubbleOf(bubbles, 10).querySelector<HTMLElement>('.bubble-call-title')!
    title.dispatchEvent(new MouseEvent('click', { bubbles: true }))

    expect(callUser).toHaveBeenCalledWith(CHAT, 'video')
  })

  it('клик по обычному баблу перезвон не запускает', async () => {
    const plain = makeMessage({ peerId: CHAT, fromId: CHAT, id: 11, text: 'привет', createdAt: '2026-08-20T10:00:00Z' })
    bubbles = mountTestBubbles(chatContext(), managersWith([plain]))
    await openFeed(bubbles)
    await settle()

    bubbleOf(bubbles, 11).querySelector<HTMLElement>('.message')!
      .dispatchEvent(new MouseEvent('click', { bubbles: true }))

    expect(callUser).not.toHaveBeenCalled()
  })
})
