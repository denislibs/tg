// У ОКНА СООБЩЕНИЙ ОДИН ПИСАТЕЛЬ — ОПЕРАЦИИ.
//
// Пин сквозной: настоящий менеджер воркера (`newMessagesManager`) объявляет
// изменение веером `rt:message_op`, вееру подставлен `rootScope`, а на нём сидит
// настоящий проектор — единственный, кто пишет обе копии окна. Проверяется
// ЗЕРКАЛО (`core/history/messagesMirror.ts`), потому что именно из него рисует
// императивная лента (`components/chat/bubbles.ts`): факт, доехавший до
// zustand-стора, но не до зеркала, для ленты не существует.
//
// Почему именно так, а не «менеджер вернул ops»: проверка ops глазами теста
// пропускает ровно тот класс дефекта, ради которого задача и делалась —
// операция построена, но не объявлена (или объявлена не по тем окнам).
import { beforeEach, describe, expect, it, vi } from 'vitest'
import rootScope from '@lib/rootScope'
import { newMessagesManager } from '../../core/managers/messagesManager'
import type { RestClient } from '../../core/net/restClient'
import { generateMessageId, getServerMessageId } from '../../core/history/messageId'
import { makeRawMessage } from '../../core/messages/testMessage'
import { mirrorWindow, putMirrorPage, resetMessagesMirror } from '../../core/history/messagesMirror'
import { winKey, useMessagesStore } from '../../stores/messagesStore'
import { isChosen, myPaidStars } from '../../core/reactions/messageReactions'
import type { MessageReal, MyMessage, RawMessage } from '../../core/models'
import type { MessageMediaPoll, MessageMediaToDo } from '../../core/media/messageMedia'
import type { EditMessageEvt, GeoLiveUpdateEvt, ReactionEvt } from '../../core/realtime/events'
import type { Managers } from '../bootstrap'

import { registerStoreProjection } from './storeProjection'

const CHAT = 77
const ME = 1
const cid = generateMessageId

let registered = false
/** Проектор ставится один раз на процесс — как в приложении (realtimeBridge). */
function ensureProjection(): void {
  if (registered) return
  registerStoreProjection({} as unknown as Managers)
  registered = true
}

/** Сообщение окна в зеркале — то, что синхронно читает императивная лента. */
const inMirror = (id: number): MessageReal | undefined =>
  (mirrorWindow(winKey(CHAT)) ?? []).find((m) => m.id === id) as MessageReal | undefined

/** Чипы реакций так, как их видно в бабле. */
const chips = (id: number) =>
  (inMirror(id)?.reactions?.results ?? []).map((c) => ({
    emoji: c.reaction._ === 'reactionPaid' ? '⭐' : c.reaction.emoticon,
    count: c.count,
    mine: isChosen(c),
  }))

interface Fake {
  get: ReturnType<typeof vi.fn>
  post: ReturnType<typeof vi.fn>
  del: ReturnType<typeof vi.fn>
  patch: ReturnType<typeof vi.fn>
  put: ReturnType<typeof vi.fn>
}

function fakeRest(): Fake {
  return {
    get: vi.fn(async () => ({ messages: [] as RawMessage[], count: 0 })),
    post: vi.fn(async () => ({})),
    del: vi.fn(async () => ({})),
    patch: vi.fn(async () => ({})),
    put: vi.fn(async () => ({})),
  }
}

/** Страница истории чата: два сообщения, DESC — как отдаёт бэкенд. */
const page = () => ({
  messages: [3, 2].map((id) => makeRawMessage({ id, peerId: CHAT, fromId: 2, text: `m${id}`, createdAt: '2026-08-26T10:00:00Z' }) as RawMessage),
  count: 2,
})

/**
 * Собрать связку «владелец → веер → проектор → обе копии окна».
 *
 * `broadcast` подставлен `dispatchEventSingle`: это ТО ЖЕ, что делает вкладка,
 * приняв кадр из воркера (`realtimeBridge`), — обычный `dispatchEvent` уехал бы
 * обратно в воркер и закольцевался.
 */
/** Веер воркера, каким его видит вкладка. Имя события здесь — обычная строка
 *  (менеджер типизирован `broadcast(event: string, …)`), поэтому шина зовётся
 *  через приведение сигнатуры, а не через каталог. */
const emitToTab = (event: string, payload: unknown): void =>
  (rootScope.dispatchEventSingle as unknown as (n: string, p: unknown) => void)(event, payload)

async function setup() {
  ensureProjection()
  useMessagesStore.setState({ byKey: {} })
  resetMessagesMirror()

  const rest = fakeRest()
  rest.get.mockImplementation(async () => page())
  const mgr = newMessagesManager({
    rest: rest as unknown as RestClient,
    getMeId: () => ME,
    broadcast: (event, payload) => { emitToTab(event, payload) },
  })
  // Окно у ВЛАДЕЛЬЦА (SSOT + срез): без него `opWindowsFor` не найдёт ни одного
  // окна и операций не будет вовсе.
  const r = await mgr.getHistory({ peerId: CHAT, offsetId: 0, addOffset: 0, limit: 40 })
  // Окно у ВИТРИНЫ: страницу в зеркало кладёт сама лента (`putMirrorPage`), в
  // zustand-копию — React-лента. Дальше их правит только поток операций.
  putMirrorPage(winKey(CHAT), r.messages)
  useMessagesStore.getState().setWindow(winKey(CHAT), { msgs: r.messages, reachedTop: true, reachedBottom: true })
  return { mgr, rest }
}

describe('окно сообщений: своё действие доезжает до зеркала операцией', () => {
  beforeEach(() => { vi.restoreAllMocks() })

  // ГЛАВНЫЙ ПИН #1 (реакции). Клик по чипу в императивной ленте
  // (`chat/bubbles.ts::toggleReaction`) зовёт `managers.messages.react` — и
  // ничего больше. Без операции бабл не перерисовывался бы вовсе.
  it('react() кладёт мой чип в зеркало', async () => {
    const { mgr } = await setup()
    await mgr.react(CHAT, cid(2), '👍')
    expect(chips(cid(2))).toEqual([{ emoji: '👍', count: 1, mine: true }])
  })

  it('unreact() убирает мой чип из зеркала', async () => {
    const { mgr } = await setup()
    await mgr.react(CHAT, cid(2), '👍')
    await mgr.unreact(CHAT, cid(2), '👍')
    expect(inMirror(cid(2))?.reactions).toBeUndefined()
  })

  // Отказ сети откатывает обратной дельтой — и откат тоже обязан доехать,
  // иначе чип остаётся нажатым навсегда.
  it('ошибка сети откатывает чип в зеркале', async () => {
    const { mgr, rest } = await setup()
    rest.post.mockRejectedValueOnce(new Error('boom'))
    await expect(mgr.react(CHAT, cid(2), '👍')).rejects.toThrow('boom')
    expect(inMirror(cid(2))?.reactions).toBeUndefined()
  })

  // Живой кадр чужой реакции. Агрегат абсолютный и помечен `pFlags.min` — мой
  // `chosen_order` в нём отсутствует по построению, и сохраняет его ВЛАДЕЛЕЦ
  // (mergeReactions), до порождения операции. Порт формы оригинала:
  // tweb appReactionsManager.ts:895-901 объявляет абсолютный
  // `updateMessageReactions`, а tweb appMessagesManager.ts:7807-7810 применяет
  // его голым присваиванием `message.reactions = reactions`.
  it('cacheReaction(кадр) кладёт абсолютный агрегат в зеркало, сохраняя мой выбор', async () => {
    const { mgr } = await setup()
    await mgr.react(CHAT, cid(2), '👍')
    const evt: ReactionEvt = {
      _: 'updateMessageReactions',
      // Пир — КОНСТРУКТОР: у нас личный чат, поэтому `peerUser`. `peerChat`
      // здесь дал бы отрицательный ключ (`toPeerId(id, true)`) и промах по SSOT.
      peer: { _: 'peerUser', user_id: CHAT },
      msg_id: getServerMessageId(cid(2)),
      reactions: {
        _: 'messageReactions',
        results: [
          { _: 'reactionCount', reaction: { _: 'reactionEmoji', emoticon: '👍' }, count: 4 },
          { _: 'reactionCount', reaction: { _: 'reactionEmoji', emoticon: '❤️' }, count: 1 },
        ],
      },
    }
    const ops = mgr.cacheReaction(evt)
    rootScope.dispatchEventSingle('rt:message_op', { ops })
    expect(chips(cid(2))).toEqual([
      { emoji: '👍', count: 4, mine: true },
      { emoji: '❤️', count: 1, mine: false },
    ])
  })

  // Платная ⭐: свой вклад приезжает ТОЛЬКО ответом ручки (в кадре его нет и
  // быть не может), поэтому объявить окну изменение обязан этот путь.
  it('sendStarReaction() кладёт ⭐-чип и мой вклад в зеркало', async () => {
    const { mgr, rest } = await setup()
    rest.post.mockResolvedValueOnce({
      _: 'updates',
      updates: [{
        _: 'updateMessageReactions',
        peer: { _: 'peerUser', user_id: CHAT },
        msg_id: getServerMessageId(cid(2)),
        reactions: {
          _: 'messageReactions',
          results: [{ _: 'reactionCount', reaction: { _: 'reactionPaid' }, count: 25 }],
          top_reactors: [{ _: 'messageReactor', pFlags: { my: true }, count: 10 }],
        },
      }],
      users: [],
      chats: [],
    })
    await mgr.sendStarReaction(CHAT, cid(2), 10, false)
    expect(chips(cid(2))).toEqual([{ emoji: '⭐', count: 25, mine: false }])
    expect(myPaidStars(inMirror(cid(2))?.reactions)).toBe(10)
  })

  // ГЛАВНЫЙ ПИН #2 (удаление). Веер владельца НЕ исключает источник — вкладка,
  // нажавшая «удалить», получает свою же операцию и убирает бабл. Прежний
  // комментарий у `deleteMessage` утверждал обратное.
  it('deleteMessage() убирает сообщение из зеркала ТОЙ ЖЕ вкладки', async () => {
    const { mgr } = await setup()
    expect(inMirror(cid(2))).toBeDefined()
    await mgr.deleteMessage(CHAT, cid(2), true)
    expect(inMirror(cid(2))).toBeUndefined()
    expect((mirrorWindow(winKey(CHAT)) ?? []).map((m) => m.id)).toEqual([cid(3)])
  })

  it('cacheEdit(кадр) правит текст в зеркале и НЕ стирает обогащение окна', async () => {
    const { mgr } = await setup()
    // Обогащение окна, которого у SSOT воркера нет вовсе (локальное превью
    // слитого оптимистичного бабла) — patch обязан его пережить, replace бы стёр.
    const win = mirrorWindow(winKey(CHAT))!
    const withLocal = win.map((m) => (m.id === cid(2) ? { ...m, localUrl: 'blob:local-1' } as MyMessage : m))
    resetMessagesMirror()
    putMirrorPage(winKey(CHAT), withLocal)

    const evt: EditMessageEvt = {
      _: 'updateEditMessage',
      message: makeRawMessage({ id: getServerMessageId(cid(2)), peerId: CHAT, fromId: 2, text: 'изменено', editDate: 1_777_000_000 }),
    }
    rootScope.dispatchEventSingle('rt:message_op', { ops: mgr.cacheEdit(evt) })
    expect(inMirror(cid(2))?.message).toBe('изменено')
    expect(inMirror(cid(2))?.edit_date).toBe(1_777_000_000)
    expect(inMirror(cid(2))?.localUrl).toBe('blob:local-1')
  })

  // Кадр правки собирается БЕЗ ЗРИТЕЛЯ (backend frame.go:161-174 —
  // `messageContext(…, domain.NullPeerID)`), поэтому агрегат реакций в нём без
  // моего `chosen_order`. Патч правкой не имеет права его погасить.
  it('cacheEdit(кадр) не гасит мою реакцию снимком без зрителя', async () => {
    const { mgr } = await setup()
    await mgr.react(CHAT, cid(2), '👍')
    const evt: EditMessageEvt = {
      _: 'updateEditMessage',
      message: {
        ...makeRawMessage({ id: getServerMessageId(cid(2)), peerId: CHAT, fromId: 2, text: 'изменено' }),
        // снимок без зрителя: чип есть, «моя» нет
        reactions: { _: 'messageReactions', results: [{ _: 'reactionCount', reaction: { _: 'reactionEmoji', emoticon: '👍' }, count: 1 }] },
      },
    }
    rootScope.dispatchEventSingle('rt:message_op', { ops: mgr.cacheEdit(evt) })
    expect(inMirror(cid(2))?.message).toBe('изменено')
    expect(chips(cid(2))).toEqual([{ emoji: '👍', count: 1, mine: true }])
  })

  it('cacheGeoLive(кадр) правит координаты в зеркале', async () => {
    const { mgr } = await setup()
    const evt: GeoLiveUpdateEvt = {
      peer_id: CHAT,
      id: getServerMessageId(cid(3)),
      media: { _: 'messageMediaGeoLive', geo: { _: 'geoPoint', long: 30.5, lat: 50.4 }, period: 900 },
      edit_date: 1_777_000_500,
    }
    rootScope.dispatchEventSingle('rt:message_op', { ops: mgr.cacheGeoLive(evt) })
    const media = inMirror(cid(3))?.media
    expect(media?._).toBe('messageMediaGeoLive')
    expect(media?._ === 'messageMediaGeoLive' ? media.geo.lat : null).toBe(50.4)
    expect(inMirror(cid(3))?.edit_date).toBe(1_777_000_500)
  })

  it('setFactCheck()/removeFactCheck() правят «проверку фактов» в зеркале', async () => {
    const { mgr, rest } = await setup()
    // Ответ ручки несёт СООБЩЕНИЕ целиком, уже с прикреплённой проверкой.
    rest.post.mockResolvedValueOnce({
      ...makeRawMessage({ id: getServerMessageId(cid(3)), peerId: CHAT, fromId: 2, text: 'm3' }),
      factcheck: { _: 'factCheck', country: 'RU', text: { _: 'textWithEntities', text: 'спорно', entities: [] }, hash: 0 },
    })
    await mgr.setFactCheck(CHAT, cid(3), 'спорно')
    expect(inMirror(cid(3))?.factcheck?.text?.text).toBe('спорно')

    await mgr.removeFactCheck(CHAT, cid(3))
    expect(inMirror(cid(3))?.factcheck).toBeUndefined()
  })

  it('votePoll() кладёт мои итоги опроса в зеркало', async () => {
    const { mgr, rest } = await setup()
    const poll = (chosen: boolean): MessageMediaPoll => ({
      _: 'messageMediaPoll',
      poll: {
        _: 'poll', id: 42,
        question: { _: 'textWithEntities', text: 'q', entities: [] },
        answers: [{ _: 'pollAnswer', text: { _: 'textWithEntities', text: 'a', entities: [] }, option: 'AA==' }],
      },
      results: {
        _: 'pollResults', total_voters: 1,
        results: [{ _: 'pollAnswerVoters', option: 'AA==', voters: 1, ...(chosen ? { pFlags: { chosen: true as const } } : {}) }],
      },
    })
    // Опрос сначала должен появиться в окне — приходит правкой сообщения.
    rootScope.dispatchEventSingle('rt:message_op', {
      ops: mgr.cacheEdit({
        _: 'updateEditMessage',
        message: { ...makeRawMessage({ id: getServerMessageId(cid(3)), peerId: CHAT, fromId: 2, text: '' }), media: poll(false) },
      } as EditMessageEvt),
    })
    rest.post.mockResolvedValueOnce(poll(true))
    await mgr.votePoll(CHAT, 42, [0])
    const media = inMirror(cid(3))?.media
    expect(media?._ === 'messageMediaPoll' ? media.results.results?.[0].pFlags?.chosen : null).toBe(true)
  })

  it('toggleChecklistItem() кладёт отметку чек-листа в зеркало', async () => {
    const { mgr, rest } = await setup()
    const todo = (done: boolean): MessageMediaToDo => ({
      _: 'messageMediaToDo',
      todo: {
        _: 'todoList', id: 9,
        title: { _: 'textWithEntities', text: 't', entities: [] },
        list: [{ _: 'todoItem', id: 1, title: { _: 'textWithEntities', text: 'i1', entities: [] } }],
      },
      ...(done ? { completions: [{ _: 'todoCompletion', id: 1, completed_by: { _: 'peerUser', user_id: ME }, date: 1 }] } : {}),
    })
    rootScope.dispatchEventSingle('rt:message_op', {
      ops: mgr.cacheEdit({
        _: 'updateEditMessage',
        message: { ...makeRawMessage({ id: getServerMessageId(cid(3)), peerId: CHAT, fromId: 2, text: '' }), media: todo(false) },
      } as EditMessageEvt),
    })
    rest.post.mockResolvedValueOnce(todo(true))
    await mgr.toggleChecklistItem(CHAT, 9, 1)
    const media = inMirror(cid(3))?.media
    expect(media?._ === 'messageMediaToDo' ? media.completions?.length : null).toBe(1)
  })

  // Расшифровка голосового: бабл рисует ПАРАМЕТР сообщения (кэш приоритетнее
  // локального текста, `components/messages/Transcription.tsx:20-21`), поэтому
  // и объявлять её обязан владелец. Прежде она ложилась только в SSOT воркера.
  it('transcribe() кладёт расшифровку в зеркало', async () => {
    const { mgr, rest } = await setup()
    rest.post.mockResolvedValueOnce({ _: 'messages.transcribedAudio', text: 'привет' })
    await mgr.transcribe(CHAT, cid(3))
    expect(inMirror(cid(3))?.transcription).toBe('привет')
  })

  it('cacheViews() кладёт свежие просмотры в зеркало и молчит на неизменившихся', async () => {
    const { mgr } = await setup()
    const seen: unknown[] = []
    const off = (e: unknown) => { seen.push(e) }
    rootScope.addEventListener('rt:message_op', off as never)
    mgr.cacheViews(CHAT, new Map([[cid(2), 9200]]))
    expect(inMirror(cid(2))?.views).toBe(9200)
    expect(seen).toHaveLength(1)
    // То же число второй раз — не событие: лишний патч рвал бы ссылку сообщения.
    mgr.cacheViews(CHAT, new Map([[cid(2), 9200]]))
    expect(seen).toHaveLength(1)
    rootScope.removeEventListener('rt:message_op', off as never)
  })
})
