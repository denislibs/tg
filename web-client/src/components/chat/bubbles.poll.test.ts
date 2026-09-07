// ОПРОС в императивной ленте — порт ветки `case 'messageMediaPoll'`
// (tweb bubbles.ts:8757-8814) и тела `bubbleParts/pollMessageContent/`.
//
// Пин ровно на то, чего не хватало: слой данных опроса был портирован целиком
// (`core/managers/messages/pollMethods.ts`, проводка кадра `poll_update`,
// пункты контекстного меню), а УЗЛА не было вовсе — `renderMedia` выходил на
// `getBubbleMedia` (вложение опроса не файл), и бабл схлопывался в нулевую
// высоту: наружу торчали только абсолютно спозиционированное время и кнопка
// пересылки. Поэтому здесь проверяется РЕЗУЛЬТАТ: что видно в DOM и что уходит
// на бэкенд, — а не форма вызова.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetMessagesMirror } from '@core/history/messagesMirror'
import { resetPeerMirror } from '@core/peerCache'
import { pollOptionKey, type MessageMediaPoll } from '@core/media/messageMedia'
import { makeMessage } from '@core/messages/testMessage'
import rootScope from '@lib/rootScope'
import type { MyMessage } from '@core/models'
import type { HistoryResult } from '@core/managers/messagesManager'
import ChatBubbles, { type BubblesManagers, type ChatContext } from './bubbles'

async function openFeed(feed: ChatBubbles) {
  await (await feed.setPeer())?.promise
}

/** Дать очереди рендера разобраться. */
async function settle() {
  for (let i = 0; i < 5; ++i) {
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
}

/**
 * Дождаться условия, которое наступает ЧЕРЕЗ АНИМАЦИЮ.
 *
 * Итоги, приехавшие ПОСЛЕ первой отрисовки, показываются не мгновенно: сперва
 * «летящая точка» пробегает путь до полоски (`PathDot`), и лишь потом на её
 * месте проявляется процент, досчитывая от прежнего значения
 * (`useAnimatedValueFromZero`, tweb PollOption.tsx:356-379). Это поведение
 * оригинала, а не наша задержка, поэтому тест его ждёт, а не отключает.
 */
async function waitFor(predicate: () => boolean, timeout = 3000) {
  const started = Date.now()
  while (!predicate()) {
    if (Date.now() - started > timeout) throw new Error('условие не наступило за ' + timeout + ' мс')
    await new Promise((resolve) => setTimeout(resolve, 16))
  }
}

const CHAT = 70

const chatContext = (): ChatContext => ({
  peerId: CHAT,
  messagesStorageKey: String(CHAT),
  container: document.createElement('div'),
  bubblesViewport: document.createElement('div'),
})

interface PollFixture {
  question?: string
  options?: string[]
  /** Голоса по вариантам; `undefined` — итогов нет вовсе. */
  voters?: number[]
  /** Индексы, отмеченные как МОЙ выбор (`pollAnswerVoters.pFlags.chosen`). */
  chosen?: number[]
  /** Индекс правильного ответа викторины (`…pFlags.correct`). */
  correct?: number
  totalVoters?: number
  quiz?: boolean
  multiple?: boolean
  publicVoters?: boolean
  closed?: boolean
}

/** Вложение опроса в форме схемы — ровно то, что кладёт на провод
 *  `domain.PollInfo.ToMedia` (`backend/internal/domain/mtpoll.go:180`). */
const pollMedia = (f: PollFixture = {}): MessageMediaPoll => {
  const options = f.options ?? ['Да', 'Нет', 'Не знаю']
  const voters = f.voters ?? options.map(() => 0)
  return {
    _: 'messageMediaPoll',
    poll: {
      _: 'poll',
      id: 500,
      pFlags: {
        ...(f.closed ? { closed: true as const } : {}),
        ...(f.publicVoters ? { public_voters: true as const } : {}),
        ...(f.multiple ? { multiple_choice: true as const } : {}),
        ...(f.quiz ? { quiz: true as const } : {}),
      },
      question: { _: 'textWithEntities', text: f.question ?? 'Любимый цвет?', entities: [] },
      answers: options.map((text, i) => ({
        _: 'pollAnswer' as const,
        text: { _: 'textWithEntities' as const, text, entities: [] },
        option: pollOptionKey(i),
      })),
    },
    results: {
      _: 'pollResults',
      total_voters: f.totalVoters ?? voters.reduce((a, b) => a + b, 0),
      results: options.map((_, i) => ({
        _: 'pollAnswerVoters' as const,
        option: pollOptionKey(i),
        voters: voters[i] ?? 0,
        pFlags: {
          ...(f.chosen?.includes(i) ? { chosen: true as const } : {}),
          ...(f.correct === i ? { correct: true as const } : {}),
        },
      })),
    },
  }
}

const pollMessage = (media: MessageMediaPoll, text = ''): MyMessage =>
  makeMessage({ peerId: CHAT, fromId: 2, id: 1, text, createdAt: '2026-08-15T12:00:00Z', media })

const managersWith = (
  messages: MyMessage[],
  over: Partial<BubblesManagers['messages']> = {},
): BubblesManagers => ({
  messages: {
    getHistory: vi.fn(async (): Promise<HistoryResult> => ({
      messages, count: messages.length, reachedTop: true, reachedBottom: true,
    })),
    getAround: vi.fn(async () => ({ messages, reachedTop: true, reachedBottom: true })),
    messageByDate: vi.fn(async () => null),
    ...over,
  },
  peers: { fillMirror: vi.fn(async () => {}) },
  dialogs: { getReadMaxSeqIfUnread: vi.fn(async () => 0), getHistoryMaxSeq: vi.fn(async () => 0) },
  realtime: { markRead: vi.fn(async () => ({ ok: true })) },
})

let bubbles: ChatBubbles | undefined
afterEach(() => { bubbles?.destroy(); bubbles = undefined })
beforeEach(() => { resetMessagesMirror(); resetPeerMirror(); vi.restoreAllMocks() })

const bubbleOf = (b: ChatBubbles, mid: number) =>
  b.chatInner.querySelector<HTMLElement>(`.bubble[data-mid="${mid}"]`)!

const pollOf = (b: ChatBubbles, mid = 1) =>
  bubbleOf(b, mid).querySelector<HTMLElement>('.poll-message-content')!

/** Кликабельная накладка варианта — то, по чему кликает пользователь
 *  (tweb PollOption.tsx:120-130: `.clickableArea` лежит поверх всей строки). */
const optionAreaOf = (b: ChatBubbles, idx: number) =>
  pollOf(b).querySelector<HTMLElement>(`[data-poll-option-idx="${idx}"]`)!
    .firstElementChild as HTMLElement

const footerOf = (b: ChatBubbles) =>
  pollOf(b).lastElementChild!.previousElementSibling!.firstElementChild as HTMLElement

const editTo = (message: MyMessage) => {
  rootScope.dispatchEventSingle('message_edit', {
    storageKey: String(CHAT), peerId: CHAT, mid: message.id, message,
  })
}

describe('ChatBubbles — опрос в ленте', () => {
  describe('отрисовка', () => {
    it('бабл опроса НЕ пустой: несёт .poll-message-content с вопросом и всеми вариантами', async () => {
      bubbles = new ChatBubbles(chatContext(), managersWith([pollMessage(pollMedia())]))
      await openFeed(bubbles)
      await settle()

      const bubble = bubbleOf(bubbles, 1)
      // Класс вида ставит `bubbleClasses` (tweb bubbles.ts:8811).
      expect(bubble.classList.contains('poll-message')).toBe(true)

      const poll = pollOf(bubbles)
      expect(poll).not.toBeNull()
      // Узел лежит В ТЕЛЕ и ПЕРВЫМ — `messageDiv.prepend(container)` (:8810).
      const messageDiv = bubble.querySelector<HTMLElement>('.message')!
      expect(poll.parentElement).toBe(messageDiv)
      expect(messageDiv.firstElementChild).toBe(poll)

      expect(poll.textContent).toContain('Любимый цвет?')
      const options = poll.querySelectorAll('[data-poll-option-idx]')
      expect(options).toHaveLength(3)
      expect(Array.from(options, (o) => o.textContent)).toEqual(
        expect.arrayContaining([expect.stringContaining('Да'), expect.stringContaining('Нет')]),
      )
      // Ровно тот дефект, ради которого задача: тело перестало быть пустым.
      // Высоты в happy-dom нет, поэтому пинуем её причину — наличие содержимого.
      expect(poll.childElementCount).toBeGreaterThan(0)
    })

    it('время стоит ВНУТРИ бабла, а не рядом с соседним сообщением', async () => {
      bubbles = new ChatBubbles(chatContext(), managersWith([pollMessage(pollMedia())]))
      await openFeed(bubbles)
      await settle()

      const bubble = bubbleOf(bubbles, 1)
      const time = bubble.querySelector<HTMLElement>('.time')!
      expect(time).not.toBeNull()
      expect(bubble.contains(time)).toBe(true)
      // Опрос — `mediaRequiresMessageDiv` (tweb :8759): тело не снимается,
      // значит и «плавающего» времени поверх медиа быть не должно.
      expect(bubble.classList.contains('is-message-empty')).toBe(false)
      expect(bubble.classList.contains('has-floating-time')).toBe(false)
    })

    it('текст сообщения рисуется описанием ВНУТРИ опроса и не дублируется телом', async () => {
      // tweb :8760 — `context.messageMessage = totalEntities = undefined`.
      const message = pollMessage(pollMedia(), 'Голосуем до пятницы')
      bubbles = new ChatBubbles(chatContext(), managersWith([message]))
      await openFeed(bubbles)
      await settle()

      const poll = pollOf(bubbles)
      expect(poll.textContent).toContain('Голосуем до пятницы')

      const messageDiv = bubbleOf(bubbles, 1).querySelector<HTMLElement>('.message')!
      const outsidePoll = Array.from(messageDiv.childNodes)
        .filter((n) => n !== poll)
        .map((n) => n.textContent ?? '')
        .join('')
      expect(outsidePoll).not.toContain('Голосуем до пятницы')
    })

    it('подзаголовок различает анонимный / публичный / викторину / закрытый', async () => {
      // Порт `PollType` (tweb parts.tsx:149-159): приоритет closed → quiz → public.
      const cases: [PollFixture, string][] = [
        [{}, 'Anonymous Poll'],
        [{ publicVoters: true }, 'Poll'],
        [{ quiz: true }, 'Anonymous Quiz'],
        [{ quiz: true, publicVoters: true }, 'Quiz'],
        // Закрытый перебивает всё, включая викторину.
        [{ closed: true, quiz: true }, 'Final Results'],
      ]

      for (const [fixture, expected] of cases) {
        const feed = new ChatBubbles(chatContext(), managersWith([pollMessage(pollMedia(fixture))]))
        await openFeed(feed)
        await settle()
        const subtitle = pollOf(feed).querySelector('.i18n')?.textContent
        expect(subtitle, JSON.stringify(fixture)).toBe(expected)
        feed.destroy()
      }
    })

    it('без голосов футер говорит «No votes yet», у закрытого — «No votes»', async () => {
      // Сверка ТОЧНАЯ, а не по вхождению: «No votes yet» содержит «No votes»,
      // и `toContain` пропустил бы стёртую ветку закрытого опроса.
      const open = new ChatBubbles(chatContext(), managersWith([pollMessage(pollMedia({ chosen: [0] }))]))
      await openFeed(open)
      await settle()
      expect(footerOf(open).textContent).toBe('No votes yet')
      open.destroy()

      const closed = new ChatBubbles(chatContext(), managersWith([pollMessage(pollMedia({ closed: true }))]))
      await openFeed(closed)
      await settle()
      expect(footerOf(closed).textContent).toBe('No votes')
      closed.destroy()
    })

    it('проголосовавший видит проценты, счётчик голосовавших и полоску результата', async () => {
      const media = pollMedia({ voters: [3, 1, 0], chosen: [0], totalVoters: 4 })
      bubbles = new ChatBubbles(chatContext(), managersWith([pollMessage(media)]))
      await openFeed(bubbles)
      await settle()

      const poll = pollOf(bubbles)
      // 3/4 и 1/4 — округление по наибольшим остаткам даёт ровно 75/25/0.
      expect(poll.textContent).toContain('75%')
      expect(poll.textContent).toContain('25%')
      // Счётчик — `Chat.Poll.MembersVoted` с числом уникальных проголосовавших.
      expect(footerOf(bubbles).textContent).toContain('4 members voted')
      // Полоска — узел с `--progress`, а не просто текст.
      const fills = poll.querySelectorAll<HTMLElement>('[style*="--progress"]')
      expect(fills.length).toBeGreaterThan(0)
    })

    it('викторина показывает «answered», а не «voted»', async () => {
      const media = pollMedia({ quiz: true, voters: [1, 0, 0], chosen: [0], correct: 1, totalVoters: 1 })
      bubbles = new ChatBubbles(chatContext(), managersWith([pollMessage(media)]))
      await openFeed(bubbles)
      await settle()

      expect(footerOf(bubbles).textContent).toContain('1 member answered')
      expect(footerOf(bubbles).textContent).not.toContain('voted')
    })

    it('до голосования футер зовёт выбрать вариант', async () => {
      bubbles = new ChatBubbles(chatContext(), managersWith([pollMessage(pollMedia())]))
      await openFeed(bubbles)
      await settle()

      expect(footerOf(bubbles).textContent).toContain('Select an option')
    })
  })

  describe('голосование', () => {
    it('клик по варианту одиночного опроса шлёт голос НОМЕРОМ варианта', async () => {
      const votePoll = vi.fn(async () => ({}))
      bubbles = new ChatBubbles(chatContext(), managersWith([pollMessage(pollMedia())], { votePoll }))
      await openFeed(bubbles)
      await settle()

      optionAreaOf(bubbles, 1).click()
      await settle()

      // Пир, идентификатор опроса и НОМЕР варианта — ровно то, что принимает
      // ручка `POST /polls/{id}/vote {options:[…]}`.
      expect(votePoll).toHaveBeenCalledTimes(1)
      expect(votePoll).toHaveBeenCalledWith(CHAT, 500, [1])
    })

    it('мультивыбор копит выбор и шлёт его ОДНИМ запросом по кнопке футера', async () => {
      const votePoll = vi.fn(async () => ({}))
      const media = pollMedia({ multiple: true })
      bubbles = new ChatBubbles(chatContext(), managersWith([pollMessage(media)], { votePoll }))
      await openFeed(bubbles)
      await settle()

      optionAreaOf(bubbles, 0).click()
      optionAreaOf(bubbles, 2).click()
      await settle()
      // Пока копим — на сервер ничего не ушло, а футер сменился на «Vote».
      expect(votePoll).not.toHaveBeenCalled()
      expect(footerOf(bubbles).textContent).toContain('Vote')

      footerOf(bubbles).click()
      await settle()
      expect(votePoll).toHaveBeenCalledTimes(1)
      expect(votePoll).toHaveBeenCalledWith(CHAT, 500, [0, 2])
    })

    it('повторный клик по варианту мультивыбора снимает его с выбора', async () => {
      const votePoll = vi.fn(async () => ({}))
      const media = pollMedia({ multiple: true })
      bubbles = new ChatBubbles(chatContext(), managersWith([pollMessage(media)], { votePoll }))
      await openFeed(bubbles)
      await settle()

      optionAreaOf(bubbles, 0).click()
      optionAreaOf(bubbles, 1).click()
      optionAreaOf(bubbles, 0).click()
      await settle()
      footerOf(bubbles).click()
      await settle()

      expect(votePoll).toHaveBeenCalledWith(CHAT, 500, [1])
    })

    it('в проголосованном опросе клик по варианту на сервер не идёт', async () => {
      const votePoll = vi.fn(async () => ({}))
      const media = pollMedia({ voters: [1, 0, 0], chosen: [0], totalVoters: 1 })
      bubbles = new ChatBubbles(chatContext(), managersWith([pollMessage(media)], { votePoll }))
      await openFeed(bubbles)
      await settle()

      optionAreaOf(bubbles, 2).click()
      await settle()
      expect(votePoll).not.toHaveBeenCalled()
    })

    it('в закрытом опросе клик по варианту на сервер не идёт', async () => {
      const votePoll = vi.fn(async () => ({}))
      const media = pollMedia({ closed: true })
      bubbles = new ChatBubbles(chatContext(), managersWith([pollMessage(media)], { votePoll }))
      await openFeed(bubbles)
      await settle()

      optionAreaOf(bubbles, 0).click()
      await settle()
      expect(votePoll).not.toHaveBeenCalled()
    })
  })

  describe('обновление итогов', () => {
    it('кадр poll_update (правка media) доезжает до узла: появляются проценты и счётчик', async () => {
      // Кадр `updateMessagePoll` воркер кладёт патчем `media`, зеркало объявляет
      // патч событием `message_edit` (см. `core/history/messagesMirror.ts:192`).
      const message = pollMessage(pollMedia())
      bubbles = new ChatBubbles(chatContext(), managersWith([message]))
      await openFeed(bubbles)
      await settle()
      expect(pollOf(bubbles).textContent).not.toContain('%')

      editTo({
        ...message,
        media: pollMedia({ voters: [2, 2, 0], chosen: [0], totalVoters: 4 }),
      } as MyMessage)
      await settle()

      // Счётчик не анимируется — он обязан быть на месте сразу.
      expect(footerOf(bubbles).textContent).toContain('4 members voted')

      // Процент проявляется после пробега «летящей точки» и досчёта значения.
      const feed = bubbles
      await waitFor(() => pollOf(feed).textContent!.includes('50%'))
      expect(pollOf(bubbles).textContent).toContain('50%')
    })

    it('правка НЕ пересобирает узел опроса — он живой (анимации идут от прежнего значения)', async () => {
      const message = pollMessage(pollMedia())
      bubbles = new ChatBubbles(chatContext(), managersWith([message]))
      await openFeed(bubbles)
      await settle()

      const before = pollOf(bubbles)
      const optionBefore = before.querySelector('[data-poll-option-idx="0"]')

      editTo({ ...message, media: pollMedia({ voters: [1, 0, 0], chosen: [0], totalVoters: 1 }) } as MyMessage)
      await settle()

      // Порт `updateLocalOnEdit` (tweb bubbles.ts:8793): узлы ТЕ ЖЕ.
      expect(pollOf(bubbles)).toBe(before)
      expect(before.querySelector('[data-poll-option-idx="0"]')).toBe(optionBefore)
      // И опрос по-прежнему один — правка его не продублировала.
      expect(bubbleOf(bubbles, 1).querySelectorAll('.poll-message-content')).toHaveLength(1)
    })

    it('правка не текста (реакция) не уносит тело опроса', async () => {
      // Тот же класс дефекта, что был у строки документа: `renderMessageContent`
      // сносит из тела всё, что не в `BODY_NOT_CONTENT`.
      const message = pollMessage(pollMedia())
      bubbles = new ChatBubbles(chatContext(), managersWith([message]))
      await openFeed(bubbles)
      await settle()

      editTo({
        ...message,
        reactions: {
          _: 'messageReactions',
          results: [{ _: 'reactionCount', reaction: { _: 'reactionEmoji', emoticon: '👍' }, count: 1 }],
        },
      } as MyMessage)
      await settle()

      expect(pollOf(bubbles)).not.toBeNull()
      expect(pollOf(bubbles).textContent).toContain('Любимый цвет?')
    })

    it('отзыв голоса возвращает опрос в состояние «до голосования»', async () => {
      const voted = pollMessage(pollMedia({ voters: [1, 0, 0], chosen: [0], totalVoters: 1 }))
      bubbles = new ChatBubbles(chatContext(), managersWith([voted]))
      await openFeed(bubbles)
      await settle()
      expect(pollOf(bubbles).textContent).toContain('100%')

      // Ручку отзыва зовёт контекстное меню (`votePoll(peer, id, [])`), а до
      // ленты результат приезжает той же правкой.
      editTo({ ...voted, media: pollMedia() } as MyMessage)
      await settle()

      expect(pollOf(bubbles).textContent).not.toContain('%')
      expect(footerOf(bubbles).textContent).toContain('Select an option')
    })
  })
})
