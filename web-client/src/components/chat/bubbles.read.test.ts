// Отметка о прочтении — работа САМОЙ ленты (порт tweb bubbles.ts:2289-2295,
// :2914-2926, :2941-3012, :6433-6443, :7291-7307, :7638-7640).
//
// «Прочитано» у оригинала значит «увидено», и видимость бабла знает только тот,
// кто им владеет: лента ставит на каждый непрочитанный бабл наблюдатель
// пересечения и шлёт рубеж, когда бабл реально показался. Правило «прижат к
// низу — читаем всё» отвечает на другой вопрос — этот файл пинит именно
// наблюдателя.
//
// Пины:
//   (1) наблюдение ставится по ГОРИЗОНТУ прочтения: то, что ниже рубежа, не
//       наблюдается вовсе;
//   (2) пересечение отдаёт рубеж ручке `realtime.markRead` — той же, которой
//       сегодня отмечает чат React-лента;
//   (3) у ПОСТА КАНАЛА наблюдаемый узел — время, а не бабл (:7638-7640);
//   (4) низ окна загружен и увиденное дотянулось до него — рубеж поднимается до
//       последнего сообщения ЧАТА (:2958-2966);
//   (5) отметка ждёт фокуса окна (`idleController.getFocusPromise`, :2948);
//   (6) удаление бабла и `destroy()` снимают наблюдение.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import rootScope from '@lib/rootScope'
import { applyOpsToMirror, resetMessagesMirror } from '@core/history/messagesMirror'
import { resetPeerMirror } from '@core/peerCache'
import { makeMessage } from '@core/messages/testMessage'
import type { MyMessage } from '@core/models'
import type { HistoryResult } from '@core/managers/messagesManager'
import type ChatBubbles from './bubbles'
import { makeFullMid, type BubblesManagers } from './bubbles'
import { createTestChat, mountTestBubbles, type TestChatOptions } from './testChat'

async function openFeed(feed: ChatBubbles) {
  await (await feed.setPeer())?.promise
}

const CHAT = 91

/** Управляемый IntersectionObserver. Наблюдателей в ленте несколько
 *  (`StickyIntersector` заводит два своих в том же `constructPeerHelpers`),
 *  поэтому нужный ищется НЕ по порядку создания, а по узлу на учёте. */
class FakeIntersectionObserver {
  public static instances: FakeIntersectionObserver[] = []
  public targets: Element[] = []
  /** Счётчик, а не флаг: `cleanup()` внутри `setPeer` уже отключал этот
   *  наблюдатель один раз (порт tweb :4971-4980), поэтому «отключён ли» на
   *  момент `destroy()` истинно и без него. */
  public disconnects = 0
  constructor(public cb: (entries: unknown[], observer: unknown) => void, public options?: IntersectionObserverInit) {
    FakeIntersectionObserver.instances.push(this)
  }

  observe(el: Element) { this.targets.push(el) }
  unobserve(el: Element) { this.targets = this.targets.filter((t) => t !== el) }
  disconnect() { this.targets = []; ++this.disconnects }
  takeRecords() { return [] }
}

const observerOf = (el: Element) =>
  FakeIntersectionObserver.instances.find((o) => o.targets.includes(el))

/** Узел показался во вьюпорте. */
const intersect = (el: Element) => {
  observerOf(el)!.cb([{ target: el, isIntersecting: true }], null)
}

const chatContext = (over: TestChatOptions = {}) => createTestChat({ peerId: CHAT, ...over })

function managersWith(messages: MyMessage[]) {
  const markRead = vi.fn(async () => ({ ok: true }))
  const getReadMaxSeqIfUnread = vi.fn(async () => 0)
  const getHistoryMaxSeq = vi.fn(async () => 0)
  const getDialogReadState = vi.fn(async (): Promise<{ readInboxMaxSeq: number, unreadCount: number } | undefined> => undefined)
  const managers: BubblesManagers = {
    messages: {
      getHistory: vi.fn(async (): Promise<HistoryResult> => ({
        messages, count: messages.length, reachedTop: true, reachedBottom: true,
      })),
      getAround: vi.fn(async () => ({ messages, reachedTop: true, reachedBottom: true })),
      messageByDate: vi.fn(async () => null),
    },
    peers: { fillMirror: vi.fn(async () => {}) },
    dialogs: { getReadMaxSeqIfUnread, getHistoryMaxSeq, getDialogReadState },
    realtime: { markRead },
  }
  return Object.assign(managers, { markRead, getReadMaxSeqIfUnread, getHistoryMaxSeq, getDialogReadState })
}

/** Курсор прочтения диалога — и в форме «горизонт, если есть непрочитанное»
 *  (граница непрочитанных), и в форме самого курсора (гейт наблюдателя,
 *  tweb 79d6a8f95). Непрочитанное есть — обе формы совпадают. */
function setHorizon(managers: ReturnType<typeof managersWith>, readInboxMaxSeq: number) {
  managers.getReadMaxSeqIfUnread.mockResolvedValue(readInboxMaxSeq)
  managers.getDialogReadState.mockResolvedValue({ readInboxMaxSeq, unreadCount: 1 })
}

const msg = (id: number): MyMessage =>
  makeMessage({ peerId: CHAT, fromId: 2, id, text: `m${id}`, createdAt: '2026-08-15T12:00:00Z' })

async function settle() {
  for (let i = 0; i < 5; ++i) await new Promise((resolve) => setTimeout(resolve, 0))
}

let bubbles: ChatBubbles | undefined
afterEach(() => { bubbles?.destroy(); bubbles = undefined })
beforeEach(() => {
  resetMessagesMirror()
  resetPeerMirror()
  rootScope.myId = 1
  FakeIntersectionObserver.instances = []
  vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver)
  // Окно в фокусе: `idleController` — синглтон модуля, и стартует он
  // простаивающим. Пробуждаем его явно, чтобы гейт фокуса не «висел» здесь и
  // проверялся отдельным тестом.
  window.dispatchEvent(new Event('focus'))
})

const bubbleOf = (b: ChatBubbles, mid: number) =>
  b.chatInner.querySelector<HTMLElement>(`.bubble[data-mid="${mid}"]`)!

describe('ChatBubbles — наблюдатель непрочитанных', () => {
  // tweb 79d6a8f95: гейт спрашивал `getReadMaxSeqIfUnread`, который у
  // полностью прочитанного чата отвечает 0, — и `0 < mid` выполнялось для
  // каждого бабла: все получали лишний наблюдатель прочтения.
  it('в полностью прочитанном чате наблюдателей нет вовсе', async () => {
    const managers = managersWith([msg(11), msg(12), msg(13), msg(14)])
    managers.getDialogReadState.mockResolvedValue({ readInboxMaxSeq: 14, unreadCount: 0 })
    bubbles = mountTestBubbles(chatContext(), managers)
    await openFeed(bubbles)
    await settle()

    for (const mid of [11, 12, 13, 14]) expect(observerOf(bubbleOf(bubbles, mid))).toBeUndefined()
  })

  it('своё сообщение выше курсора не наблюдается: курсор входящих стоит ниже своих', async () => {
    const own = makeMessage({ peerId: CHAT, fromId: 1, out: true, id: 13, text: 'моё', createdAt: '2026-08-15T12:00:00Z' })
    const managers = managersWith([msg(11), msg(12), own])
    managers.getDialogReadState.mockResolvedValue({ readInboxMaxSeq: 12, unreadCount: 0 })
    bubbles = mountTestBubbles(chatContext(), managers)
    await openFeed(bubbles)
    await settle()

    expect(observerOf(bubbleOf(bubbles, 13))).toBeUndefined()
  })

  it('курсор неизвестен (диалога нет) — наблюдается всё, пропустить отметку нельзя', async () => {
    const managers = managersWith([msg(11), msg(12)])
    bubbles = mountTestBubbles(chatContext(), managers)
    await openFeed(bubbles)
    await settle()

    expect(observerOf(bubbleOf(bubbles, 11))).toBeDefined()
    expect(observerOf(bubbleOf(bubbles, 12))).toBeDefined()
  })

  it('наблюдаются только баблы НОВЕЕ горизонта прочтения', async () => {
    const managers = managersWith([msg(11), msg(12), msg(13), msg(14)])
    setHorizon(managers, 12)
    bubbles = mountTestBubbles(chatContext(), managers)
    await openFeed(bubbles)
    await settle()

    expect(observerOf(bubbleOf(bubbles, 11))).toBeUndefined()
    expect(observerOf(bubbleOf(bubbles, 12))).toBeUndefined()
    expect(observerOf(bubbleOf(bubbles, 13))).toBeDefined()
    expect(observerOf(bubbleOf(bubbles, 14))).toBeDefined()
  })

  it('показавшийся бабл отдаёт свой рубеж в realtime.markRead', async () => {
    const managers = managersWith([msg(11), msg(12), msg(13), msg(14)])
    setHorizon(managers, 12)
    // Низ окна «не сведён с концом истории» — иначе рубеж поднимется до
    // последнего сообщения чата (это отдельный тест ниже).
    managers.messages.getHistory = vi.fn(async (): Promise<HistoryResult> => ({
      messages: [msg(11), msg(12), msg(13), msg(14)], count: 4, reachedTop: true, reachedBottom: false,
    }))
    bubbles = mountTestBubbles(chatContext(), managers)
    await openFeed(bubbles)
    await settle()

    intersect(bubbleOf(bubbles, 13))
    await settle()

    expect(managers.markRead).toHaveBeenCalledTimes(1)
    expect(managers.markRead).toHaveBeenCalledWith({ peerId: CHAT, upToId: 13 })
  })

  it('увиденное дотянулось до низа загруженного окна — рубеж поднимается до последнего сообщения ЧАТА', async () => {
    const managers = managersWith([msg(11), msg(12)])
    setHorizon(managers, 10)
    managers.getHistoryMaxSeq.mockResolvedValue(99)
    bubbles = mountTestBubbles(chatContext(), managers)
    await openFeed(bubbles)
    await settle()

    intersect(bubbleOf(bubbles, 12))
    await settle()

    // tweb :2958-2966: пока лента внизу, прочитанным считается ВЕСЬ чат —
    // включая то, что ещё не отрисовано, иначе бейдж не гаснет до конца.
    expect(managers.markRead).toHaveBeenCalledWith({ peerId: CHAT, upToId: 99 })
  })

  it('рубеж накрывает и остальные наблюдаемые баблы — второго круга они не требуют', async () => {
    const managers = managersWith([msg(11), msg(12), msg(13)])
    setHorizon(managers, 10)
    managers.messages.getHistory = vi.fn(async (): Promise<HistoryResult> => ({
      messages: [msg(11), msg(12), msg(13)], count: 3, reachedTop: true, reachedBottom: false,
    }))
    bubbles = mountTestBubbles(chatContext(), managers)
    await openFeed(bubbles)
    await settle()

    intersect(bubbleOf(bubbles, 13))
    await settle()

    // tweb :2968-2972 — снятые с учёта 11 и 12 уже накрыты рубежом 13.
    expect(observerOf(bubbleOf(bubbles, 11))).toBeUndefined()
    expect(observerOf(bubbleOf(bubbles, 12))).toBeUndefined()
    expect(managers.markRead).toHaveBeenCalledTimes(1)
  })

  it('у поста канала читающий узел — ВРЕМЯ, а не бабл', async () => {
    // `views: 1` — не украшение фикстуры, а инвариант провода: пост канала
    // всегда приезжает со счётчиком, и он не бывает нулевым
    // (`domain.MessageReal.PostCounters`, порт `views: isBroadcast && 1`
    // из tweb appMessagesManager.ts:2930). Именно по нему лента ставит бабл
    // под наблюдение ради просмотров (:7672), поэтому без него тест проверял
    // бы пост, которого на проводе не бывает.
    const managers = managersWith([{ ...msg(11), views: 1 } as MyMessage])
    setHorizon(managers, 10)
    bubbles = mountTestBubbles(chatContext({ isBroadcast: true }), managers)
    await openFeed(bubbles)
    await settle()

    const bubble = bubbleOf(bubbles, 11)
    const time = bubble.querySelector<HTMLElement>('.time')!
    // tweb :7638-7640: пост бывает выше вьюпорта, и «увиден» он, только когда
    // пользователь домотал до его конца. Спрашивается ПОВЕДЕНИЕ, а не набор
    // наблюдаемых узлов: наблюдатель у ленты один на все её вопросы (порт
    // `SuperIntersectionObserver`), и сам бабл он тоже держит на учёте — ради
    // просмотров поста (:7685).
    intersect(bubble)
    await settle()
    expect(managers.markRead).not.toHaveBeenCalled()

    intersect(time)
    await settle()
    expect(managers.markRead).toHaveBeenCalledWith({ peerId: CHAT, upToId: 11 })
  })

  // Правка пересобирает конец тела бабла, а вместе с ним и узел времени. У
  // поста канала это НАБЛЮДАЕМЫЙ узел (:7638-7640), поэтому наблюдение обязано
  // переехать на новый: иначе правка (в нашей воронке — любой `patch`, включая
  // чужую реакцию) навсегда снимала бы пост с отметки прочтения.
  it('правка поста канала ПЕРЕВЕШИВАЕТ наблюдение на новое время', async () => {
    const managers = managersWith([msg(11)])
    setHorizon(managers, 10)
    bubbles = mountTestBubbles(chatContext({ isBroadcast: true }), managers)
    await openFeed(bubbles)
    await settle()

    const bubble = bubbleOf(bubbles, 11)
    const timeBefore = bubble.querySelector<HTMLElement>('.time')!

    rootScope.dispatchEventSingle('message_edit', {
      storageKey: String(CHAT), peerId: CHAT, mid: 11, message: msg(11),
    })

    const timeAfter = bubble.querySelector<HTMLElement>('.time')!
    expect(timeAfter).not.toBe(timeBefore)
    expect(observerOf(timeBefore)).toBeUndefined()
    expect(observerOf(timeAfter)).toBeDefined()

    // И рубеж переехал вместе с наблюдением — увиденное отмечается тем же номером.
    intersect(timeAfter)
    await settle()
    expect(managers.markRead).toHaveBeenCalledWith({ peerId: CHAT, upToId: 11 })
  })

  // Обратная сторона того же: узел, который наблюдатель уже отпустил, правка не
  // возвращает в непрочитанные.
  it('правка УЖЕ ПРОЧИТАННОГО поста наблюдение не заводит заново', async () => {
    const managers = managersWith([msg(11)])
    setHorizon(managers, 10)
    bubbles = mountTestBubbles(chatContext({ isBroadcast: true }), managers)
    await openFeed(bubbles)
    await settle()

    const bubble = bubbleOf(bubbles, 11)
    intersect(bubble.querySelector<HTMLElement>('.time')!)
    await settle()

    rootScope.dispatchEventSingle('message_edit', {
      storageKey: String(CHAT), peerId: CHAT, mid: 11, message: msg(11),
    })

    expect(observerOf(bubble.querySelector<HTMLElement>('.time')!)).toBeUndefined()
  })

  it('отметка ждёт фокуса окна', async () => {
    const managers = managersWith([msg(11), msg(12)])
    setHorizon(managers, 10)
    bubbles = mountTestBubbles(chatContext(), managers)
    await openFeed(bubbles)
    await settle()

    window.dispatchEvent(new Event('blur'))
    intersect(bubbleOf(bubbles, 12))
    await settle()
    // tweb :2948 `idleController.getFocusPromise().then(...)` — фоновая вкладка
    // чат прочитанным не отмечает.
    expect(managers.markRead).not.toHaveBeenCalled()

    window.dispatchEvent(new Event('focus'))
    await settle()
    expect(managers.markRead).toHaveBeenCalledTimes(1)
  })

  it('удаление бабла снимает наблюдение', async () => {
    const managers = managersWith([msg(11), msg(12)])
    setHorizon(managers, 10)
    bubbles = mountTestBubbles(chatContext(), managers)
    await openFeed(bubbles)
    await settle()

    const bubble = bubbleOf(bubbles, 12)
    expect(observerOf(bubble)).toBeDefined()

    bubbles.deleteMessagesByIds([makeFullMid(CHAT, 12)])
    expect(observerOf(bubble)).toBeUndefined()
  })

  it('destroy() отключает наблюдатель', async () => {
    const managers = managersWith([msg(11)])
    setHorizon(managers, 10)
    bubbles = mountTestBubbles(chatContext(), managers)
    await openFeed(bubbles)
    await settle()

    const observer = observerOf(bubbleOf(bubbles, 11))!
    const before = observer.disconnects
    bubbles.destroy()
    bubbles = undefined
    expect(observer.disconnects).toBe(before + 1)
    expect(observer.targets).toHaveLength(0)
  })
})

// Наблюдатель СОДЕРЖИМОГО — порт tweb `'content'` (bubbles.ts:2720-2726,
// :3405-3418, :7930/:8619-8631) в объёме непрочитанных реакций: моё сообщение
// с непрочитанной реакцией, показавшись, уходит в `messages.readMessages`.
describe('ChatBubbles — наблюдатель содержимого (непрочитанные реакции)', () => {
  const reactions = (unread: boolean) => ({
    _: 'messageReactions' as const,
    results: [{ _: 'reactionCount' as const, reaction: { _: 'reactionEmoji' as const, emoticon: '👍' }, count: 1 }],
    recent_reactions: [{
      _: 'messagePeerReaction' as const,
      ...(unread ? { pFlags: { unread: true as const } } : {}),
      peer_id: { _: 'peerUser' as const, user_id: 9 }, date: 0,
      reaction: { _: 'reactionEmoji' as const, emoticon: '👍' },
    }],
  })
  const own = (id: number, unread: boolean | null): MyMessage => ({
    ...makeMessage({ peerId: CHAT, fromId: 1, out: true, id, text: `моё ${id}`, createdAt: '2026-08-15T12:00:00Z' }),
    ...(unread === null ? {} : { reactions: reactions(unread) }),
  } as MyMessage)

  function withReadMessages(messages: MyMessage[]) {
    const managers = managersWith(messages)
    // Чат прочитан: наблюдатель ИСТОРИИ на своих не стоит вовсе, и всё, что
    // наблюдается, — это наблюдатель содержимого.
    managers.getDialogReadState.mockResolvedValue({ readInboxMaxSeq: 99, unreadCount: 0 })
    const readMessages = vi.fn(async () => {})
    managers.messages.readMessages = readMessages
    return Object.assign(managers, { readMessages })
  }

  it('показалось моё сообщение с непрочитанной реакцией — readMessages пачкой', async () => {
    const managers = withReadMessages([own(11, true)])
    bubbles = mountTestBubbles(chatContext(), managers)
    await openFeed(bubbles)
    await settle()

    const bubble = bubbleOf(bubbles, 11)
    expect(observerOf(bubble)).toBeDefined()
    intersect(bubble)
    await settle()

    expect(managers.readMessages).toHaveBeenCalledWith(CHAT, [11])
    // Наблюдение одноразовое (tweb :3346-3348).
    expect(observerOf(bubble)).toBeUndefined()
    expect(managers.markRead).not.toHaveBeenCalled()
  })

  it('без непрочитанной реакции содержимое не наблюдается', async () => {
    const managers = withReadMessages([own(11, false), own(12, null)])
    bubbles = mountTestBubbles(chatContext(), managers)
    await openFeed(bubbles)
    await settle()

    expect(observerOf(bubbleOf(bubbles, 11))).toBeUndefined()
    expect(observerOf(bubbleOf(bubbles, 12))).toBeUndefined()
  })

  // У нас кадр реакций доезжает до ленты правкой (`message_edit`) — тот же
  // путь, что tweb `messages_reactions` (:1543, :1578-1580).
  it('кадр с непрочитанной реакцией ставит уже отрисованный бабл под наблюдение', async () => {
    const managers = withReadMessages([own(11, null)])
    bubbles = mountTestBubbles(chatContext(), managers)
    await openFeed(bubbles)
    await settle()

    const bubble = bubbleOf(bubbles, 11)
    expect(observerOf(bubble)).toBeUndefined()

    // Через ЗЕРКАЛО, как в жизни: оно же объявит `message_edit`, а отбор
    // увиденного (`readUnreaded('content')`) читает сообщение оттуда.
    applyOpsToMirror([{ op: 'patch', key: String(CHAT), msgId: 11, fields: { reactions: reactions(true) } }])
    expect(observerOf(bubble)).toBeDefined()

    intersect(bubble)
    await settle()
    expect(managers.readMessages).toHaveBeenCalledWith(CHAT, [11])
  })

  it('удаление бабла снимает наблюдение содержимого', async () => {
    const managers = withReadMessages([own(11, true)])
    bubbles = mountTestBubbles(chatContext(), managers)
    await openFeed(bubbles)
    await settle()

    const bubble = bubbleOf(bubbles, 11)
    bubbles.deleteMessagesByIds([makeFullMid(CHAT, 11)])
    expect(observerOf(bubble)).toBeUndefined()
  })
})
