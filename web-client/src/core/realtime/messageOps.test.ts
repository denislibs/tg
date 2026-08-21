// Каталог операций над окном сообщений (Stage 1B.2, Task 2). applyOp — чистая
// функция над массивом Message: та же семантика дедупа/слияния, что и
// applyIncoming в messagesStore.ts (см. messagesStore.threadRouting.test.ts и
// messagesStore.tentativeSeq.test.ts на сторону стора), но без Zustand — чтобы
// проектор и будущий Solid-остров могли переиграть операцию без стора.
import { describe, expect, it } from 'vitest'
import { applyOp, type MessageOp } from './messageOps'
import type { MessageReal, MyMessage } from '../models'
import { pollOptionKey, type MessageMedia, type MessageMediaPoll } from '../media/messageMedia'
import { makeMessage } from '../messages/testMessage'
import { generateTempMessageId } from '../history/messageId'

const CHAT = 30
const ME = 1
const OTHER = 2

/** Чисел стало ОДНО: адрес и порядок это один и тот же `id` (решение Р1). */
function msg(id: number, extra?: Partial<MessageReal>): MessageReal {
  return { ...makeMessage({ id, peerId: CHAT, fromId: ME, text: `m${id}`, date: 1_750_000_000 }), ...extra }
}

// Неподтверждённый оптимистичный бабл: random_id есть И номер назначен КЛИЕНТОМ
// (дробный — `core/history/messageId.ts`). Прежде признаком был отрицательный
// id; теперь бабл стоит ПОСЛЕ последнего сообщения, как и его будущее эхо.
function optimisticBubble(afterId: number, randomId: string): MyMessage {
  return msg(generateTempMessageId(afterId), { random_id: randomId })
}

const KEY = String(CHAT)

/** Сузить до обычного сообщения: у пилюли ни текста, ни опроса нет вовсе. */
const real = (m: MyMessage): MessageReal => m as MessageReal

describe('applyOp', () => {
  it('insert нового сообщения → добавлено, порядок по возрастанию seq', () => {
    const base = [msg(101), msg(103)]
    const op: MessageOp = { op: 'insert', key: KEY, msg: msg(102) }
    const next = applyOp(base, op)
    expect(next.map((m) => m.id)).toEqual([101, 102, 103])
  })

  // Что ломается: если бы insert не матчил по clientId (а слепо добавлял бы
  // входящее рядом), в списке остались бы ДВА элемента — оптимистичный бабл и
  // серверное эхо — вместо слияния в один.
  it('insert сообщения, чей clientId совпал с неподтверждённым баблом → бабл заменён, один элемент, clientId сохранён', () => {
    const bubble = optimisticBubble(1, 'c1')
    const echo = msg(900, { random_id: 'c1' })
    const next = applyOp([bubble], { op: 'insert', key: KEY, msg: echo })
    expect(next).toHaveLength(1)
    expect(next[0].id).toBe(900)
    expect(next[0].random_id).toBe('c1')
  })

  // Что ломается: без проверки "id уже есть" повторное применение эха (ack
  // пришёл раньше, эхо — дубликат по id) добавило бы дубль-бабл на экран.
  it('insert сообщения, чей id уже есть (ack-then-echo) → дубля нет, список не изменился', () => {
    const base = [msg(900, { random_id: 'c1' })]
    const echo = msg(900, { random_id: 'c1' }) // то же серверное сообщение приходит повторно
    const next = applyOp(base, { op: 'insert', key: KEY, msg: echo })
    expect(next).toHaveLength(1)
    expect(next[0].id).toBe(900)
  })

  // Инвариант, починенный в 1B.1: чужое входящее с тем же seq, что и
  // tentativeSeq бабла, но БЕЗ совпадения clientId — не вытесняет бабл.
  it('insert сообщения с тем же seq, что у бабла, но БЕЗ совпадения clientId → оба остаются', () => {
    const bubble = optimisticBubble(1, 'c-opt')
    const foreign = msg(501, { fromId: OTHER })
    const next = applyOp([bubble], { op: 'insert', key: KEY, msg: foreign })
    expect(next).toHaveLength(2)
    expect(next.some((m) => m.random_id === 'c-opt')).toBe(true)
    expect(next.some((m) => m.id === 501)).toBe(true)
  })

  it('replace существующего → заменено, позиция по seq сохранена', () => {
    const base = [msg(1, { message: 'a' }), msg(2, { message: 'b' }), msg(3, { message: 'c' })]
    const next = applyOp(base, { op: 'replace', key: KEY, msg: msg(2, { message: 'edited' }) })
    expect(next.map((m) => m.id)).toEqual([1, 2, 3])
    expect(real(next[1]).message).toBe('edited')
    expect(real(next[0]).message).toBe('a')
    expect(real(next[2]).message).toBe('c')
  })

  it('replace отсутствующего → список не изменился (no-op)', () => {
    const base = [msg(1)]
    const next = applyOp(base, { op: 'replace', key: KEY, msg: msg(999) })
    expect(next).toEqual(base)
    expect(next).toBe(base) // ссылка сохранена — no-op, не «пересборка с тем же содержимым»
  })

  it('remove существующего по msgId → удалено', () => {
    const base = [msg(1), msg(2), msg(3)]
    const next = applyOp(base, { op: 'remove', key: KEY, msgId: 2 })
    expect(next.map((m) => m.id)).toEqual([1, 3])
  })

  // Важно для мемоизации: если бы remove на отсутствующем id всё равно строил
  // новый массив (например, через filter без предварительной проверки), любой
  // подписчик, мемоизированный по ссылке на msgs, перерисовался бы впустую.
  it('remove отсутствующего → no-op, та же ссылка на массив', () => {
    const base = [msg(1)]
    const next = applyOp(base, { op: 'remove', key: KEY, msgId: 999 })
    expect(next).toBe(base)
  })

  // patch: точечное слияние полей поверх существующего сообщения (Stage 1B.3) —
  // в отличие от replace НЕ подменяет весь объект, поэтому не может стереть
  // обогащение витрины, которого нет в fields (см. docs/research/
  // 2026-08-10-message-enrichments.md, §2) — localUrl/replyTo/clientId и т.п.
  // остаются нетронутыми, если patch их не перечисляет.
  it('patch существующего → перечисленные поля слились, остальные целы, позиция по seq сохранена', () => {
    const base = [
      msg(1, { message: 'a' }),
      msg(2, { message: 'b', localUrl: 'blob:keep-me' }),
      msg(3, { message: 'c' }),
    ]
    const next = applyOp(base, { op: 'patch', key: KEY, msgId: 2, fields: { message: 'edited', edit_date: 1_750_000_300 } })
    expect(next.map((m) => m.id)).toEqual([1, 2, 3])
    expect(real(next[1]).message).toBe('edited')
    expect(real(next[1]).edit_date).toBe(1_750_000_300)
    // поле, не перечисленное в fields, не тронуто (тест ловит регрессию до replace-семантики)
    expect(real(next[1]).localUrl).toBe('blob:keep-me')
    // соседи не задеты
    expect(real(next[0]).message).toBe('a')
    expect(real(next[2]).message).toBe('c')
  })

  it('patch отсутствующего сообщения → no-op, та же ссылка на массив', () => {
    const base = [msg(1)]
    const next = applyOp(base, { op: 'patch', key: KEY, msgId: 999, fields: { message: 'nope' } })
    expect(next).toBe(base)
  })

  // Патч, не меняющий значений (те же поля, те же значения): та же ссылка на
  // массив — согласовано с прецедентом applyReaction/patchViews в
  // messagesStore.ts (сравнение перед записью, см. отчёт Task 2), чтобы
  // идемпотентный реплей (catch-up/дубль кадра) не дёргал лишний ре-рендер.
  it('patch, не меняющий значений → no-op, та же ссылка на массив (нет лишнего ре-рендера)', () => {
    const base = [msg(1, { message: 'a', edit_date: 1_750_000_000 })]
    const next = applyOp(base, { op: 'patch', key: KEY, msgId: 1, fields: { message: 'a', edit_date: 1_750_000_000 } })
    expect(next).toBe(base)
  })

  // Частичное совпадение — если хоть одно поле реально меняется, применяем и
  // строим новый массив (иначе половина патча молча потерялась бы).
  it('patch, где часть полей совпадает, а часть меняется → применено целиком, новая ссылка', () => {
    const base = [msg(1, { message: 'a', edit_date: 1_750_000_000 })]
    const next = applyOp(base, { op: 'patch', key: KEY, msgId: 1, fields: { message: 'a', edit_date: 1_750_000_300 } })
    expect(next).not.toBe(base)
    expect(real(next[0]).edit_date).toBe(1_750_000_300)
  })

  // Task 4 (Stage 1B.3): у ОПРОСА внутри вложения лежит пер-зрительский выбор
  // (`pollAnswerVoters.pFlags.chosen`), которого общий кадр не несёт: сервер
  // собирает итоги для «зрителя 0» (`publishPollUpdate`). Поэтому patch обязан
  // подставить выбор из ТЕКУЩЕГО сообщения окна. Это ГЛАВНЫЙ ПИН задачи: он
  // обязан краснеть, если patch стал бы обычным shallow-merge — вложение
  // заменилось бы целиком и выбор окна стёрся.
  //
  // У РОЗЫГРЫША такого слияния больше нет вовсе: участие уехало из вложения в
  // отдельную ручку, локального состояния во вложении не осталось.
  const answer = (i: number, voters: number, chosen?: boolean) => ({
    _: 'pollAnswerVoters' as const,
    option: pollOptionKey(i),
    voters,
    ...(chosen ? { pFlags: { chosen: true as const } } : {}),
  })
  const pollMedia = (results: ReturnType<typeof answer>[], totalVoters: number): MessageMediaPoll => ({
    _: 'messageMediaPoll',
    poll: {
      _: 'poll',
      id: 5,
      question: { _: 'textWithEntities', text: 'q', entities: [] },
      answers: [0, 1].map((i) => ({
        _: 'pollAnswer' as const,
        text: { _: 'textWithEntities' as const, text: i ? 'b' : 'a', entities: [] },
        option: pollOptionKey(i),
      })),
    },
    results: { _: 'pollResults', total_voters: totalVoters, results },
  })

  it('patch итогов опроса → счётчики обновились, выбор ОКНА сохранён', () => {
    const base = [msg(1, { media: pollMedia([answer(0, 1, true), answer(1, 0)], 1) })]
    // Кадр несёт новые счётчики (кто-то ещё проголосовал) и НИ ОДНОГО chosen.
    const incoming = pollMedia([answer(0, 1), answer(1, 1)], 2)
    const next = applyOp(base, { op: 'patch', key: KEY, msgId: 1, fields: { media: incoming } })
    const media = real(next[0]).media
    expect(media?._ === 'messageMediaPoll' && media.results.total_voters).toBe(2)
    expect(media?._ === 'messageMediaPoll' && media.results.results?.map((r) => r.voters)).toEqual([1, 1])
    // выбор ЭТОГО окна — на месте, а не затёрт значением из операции
    expect(media?._ === 'messageMediaPoll' && media.results.results?.[0].pFlags?.chosen).toBe(true)
    expect(media?._ === 'messageMediaPoll' && media.results.results?.[1].pFlags?.chosen).toBeUndefined()
  })

  it('окно ещё не знает выбора — берётся то, что пришло в операции', () => {
    const base = [msg(1, { media: pollMedia([answer(0, 1), answer(1, 0)], 1) })]
    const incoming = pollMedia([answer(0, 1), answer(1, 1, true)], 2)
    const next = applyOp(base, { op: 'patch', key: KEY, msgId: 1, fields: { media: incoming } })
    const media = real(next[0]).media
    expect(media?._ === 'messageMediaPoll' && media.results.results?.[1].pFlags?.chosen).toBe(true)
  })

  it('patch розыгрыша заменяет вложение ЦЕЛИКОМ — сохранять внутри нечего', () => {
    const active: MessageMedia = {
      _: 'messageMediaGiveaway', id: 9, channels: [CHAT], quantity: 1, months: 3, until_date: 0,
    }
    const results: MessageMedia = {
      _: 'messageMediaGiveawayResults', id: 9, channel_id: CHAT, launch_msg_id: 1,
      winners_count: 1, unclaimed_count: 0, winners: [77], months: 3, until_date: 0,
    }
    const next = applyOp([msg(1, { media: active })], { op: 'patch', key: KEY, msgId: 1, fields: { media: results } })
    expect(real(next[0]).media).toEqual(results)
  })
})
