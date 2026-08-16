// src/components/chat/bubbleGroups.test.ts
//
// Группировка баблов в серии (`BubbleGroups`, порт tweb `chat/bubbleGroups.ts`).
// Пины:
//   (1) каждое правило разрыва серии по отдельности — автор, календарный день,
//       разрыв больше 121 с, сервисное сообщение, направление (in/out);
//   (2) ИНКРЕМЕНТАЛЬНОСТЬ: стоимость добавления сообщения не зависит от размера
//       окна (число сверок `canItemsBeGrouped` на окне из 40 и из 10 совпадает),
//       трогается ровно одна группа и ровно два бабла;
//   (3) `is-group-first`/`is-group-last` переезжают на соседа и при вставке, и
//       при удалении — из начала, из середины, из конца серии;
//   (4) удаление разделителя двух серий сливает их обратно в одну;
//   (5) прилипающий аватар серии — ОДИН узел на группу;
//   (6) `getItemByBubble` отдаёт то, чем пользуется обработчик `history_update`
//       (`mid` + `group`), и переживает `changeBubbleMessage`.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getMiddleware, type Middleware, type MiddlewareHelper } from '@helpers/middleware'
import type { Message } from '@core/models'
import BubbleGroups, {
  STICKY_OFFSET,
  type BubbleGroupsHost,
  type DateContainer,
  type GroupAvatar,
} from './bubbleGroups'

const CHAT = 50
const DAY = '2026-08-15'
const NEXT_DAY = '2026-08-16'

/** `createdAt` из «времени суток» — тесту важны только разрывы между ними. */
const at = (time: string, day = DAY) => `${day}T${time}Z`

let nextSeq = 0
function msg(over: Partial<Message> = {}): Message {
  const seq = over.seq ?? ++nextSeq
  return {
    id: over.id ?? seq,
    chatId: CHAT,
    senderId: 2,
    type: 'text',
    text: `m${seq}`,
    replyToId: null,
    mediaId: null,
    createdAt: at('12:00:00'),
    threadRootId: null,
    out: false,
    ...over,
    seq,
  }
}

/** Хост групп — срез `ChatBubbles` (контейнеры дней + аватар), собранный так же,
 *  как его собирает tweb `getDateContainerByTimestamp` (bubbles.ts:4823):
 *  секция дня начинается с дата-бабла, его `is-fake`-дубля и sticky-sentinel'а,
 *  поэтому первая группа встаёт на позицию `STICKY_OFFSET`. */
class TestHost implements BubbleGroupsHost {
  public chatInner = document.createElement('div')
  public dateMessages: Map<number, DateContainer> = new Map()
  public middlewareHelper: MiddlewareHelper = getMiddleware()
  public avatarsCreated = 0

  public getDateContainerByTimestamp(timestamp: number): DateContainer {
    const dateTimestamp = timestamp * 1000
    const found = this.dateMessages.get(dateTimestamp)
    if (found) return found

    const container = document.createElement('section')
    container.className = 'bubbles-date-group'
    container.dataset.date = '' + dateTimestamp
    for (const cls of ['bubble service is-date', 'bubble service is-date is-fake', 'sticky_sentinel--top']) {
      const el = document.createElement('div')
      el.className = cls
      container.append(el)
    }
    expect(container.childElementCount).toBe(STICKY_OFFSET)

    const ret: DateContainer = { container, groupsLength: 0 }
    this.dateMessages.set(dateTimestamp, ret)

    // Секции дней лежат по возрастанию даты (tweb bubbles.ts:4846-4864).
    const after = [...this.dateMessages.entries()]
      .filter(([t]) => t > dateTimestamp)
      .sort((a, b) => a[0] - b[0])[0]
    if (after) this.chatInner.insertBefore(container, after[1].container)
    else this.chatInner.append(container)

    return ret
  }

  public deleteEmptyDateGroups() {
    for (const [timestamp, dateMessage] of this.dateMessages) {
      if (dateMessage.groupsLength) continue
      dateMessage.container.remove()
      this.dateMessages.delete(timestamp)
    }
  }

  public getMiddleware(): Middleware {
    return this.middlewareHelper.get()
  }

  public createAvatar(_message: Message, _middleware: Middleware): GroupAvatar {
    ++this.avatarsCreated
    const node = document.createElement('div')
    node.classList.add('avatar')
    return { node }
  }
}

let host: TestHost
let groups: BubbleGroups
const bubbleOf: Map<number, HTMLElement> = new Map()

beforeEach(() => {
  nextSeq = 0
  host = new TestHost()
  groups = new BubbleGroups(host)
  bubbleOf.clear()
})

/** Порт тела tweb `ChatBubbles.groupBubbles` (bubbles.ts:5973-6021) без ветки
 *  scheduled: положить баблы в кэш → разложить по сериям → (по флагу) завести
 *  аватары затронутых серий, как это делает оригинал ДО монтирования, —
 *  → смонтировать. */
function feed(messages: Message[], withAvatars = false) {
  for (const message of messages) {
    const bubble = document.createElement('div')
    bubble.classList.add('bubble')
    bubble.dataset.mid = '' + message.id
    bubbleOf.set(message.id, bubble)
    groups.prepareForGrouping(bubble, message)
  }

  const modified = groups.groupUngrouped()

  if (withAvatars) {
    for (const group of modified) {
      const firstItem = group.firstItem
      if (firstItem) void group.createAvatar(firstItem.message)
    }
  }

  groups.mountUnmountGroups([...modified])
  return modified
}

const bubble = (id: number) => bubbleOf.get(id)!

/** Все серии в порядке DOM. */
const seriesEls = () => Array.from(host.chatInner.querySelectorAll<HTMLElement>('.bubbles-group'))

/** Раскладка ленты: серия → идентификаторы её баблов в порядке DOM. */
const layout = () => seriesEls().map((el) =>
  Array.from(el.querySelectorAll<HTMLElement>('.bubble')).map((b) => +b.dataset.mid!))

/** Края серий: `f` — is-group-first, `l` — is-group-last. */
const edges = () => seriesEls().map((el) =>
  Array.from(el.querySelectorAll<HTMLElement>('.bubble')).map((b) =>
    `${b.classList.contains('is-group-first') ? 'f' : ''}${b.classList.contains('is-group-last') ? 'l' : ''}`))

const snapshotClassNames = () => new Map([...bubbleOf].map(([id, el]) => [id, el.className]))

const changedSince = (before: Map<number, string>) =>
  [...bubbleOf].filter(([id, el]) => before.get(id) !== el.className).map(([id]) => id)

describe('правила разрыва серии', () => {
  it('подряд идущие сообщения одного автора образуют одну серию', () => {
    feed([
      msg({ createdAt: at('12:00:00') }),
      msg({ createdAt: at('12:00:30') }),
      msg({ createdAt: at('12:01:00') }),
    ])

    expect(layout()).toEqual([[1, 2, 3]])
    expect(edges()).toEqual([['f', '', 'l']])
  })

  it('одиночное сообщение — серия из одного: is-group-first И is-group-last', () => {
    feed([msg()])
    expect(edges()).toEqual([['fl']])
  })

  it('смена автора рвёт серию', () => {
    feed([
      msg({ senderId: 2, createdAt: at('12:00:00') }),
      msg({ senderId: 3, createdAt: at('12:00:10') }),
      msg({ senderId: 2, createdAt: at('12:00:20') }),
    ])

    expect(layout()).toEqual([[1], [2], [3]])
    expect(edges()).toEqual([['fl'], ['fl'], ['fl']])
  })

  it('смена календарного дня рвёт серию и заводит вторую секцию дня', () => {
    feed([
      msg({ createdAt: at('12:00:00', DAY) }),
      msg({ createdAt: at('12:00:10', NEXT_DAY) }),
    ])

    expect(layout()).toEqual([[1], [2]])
    expect(host.chatInner.querySelectorAll('.bubbles-date-group')).toHaveLength(2)
  })

  it('разрыв ровно 121 с серию НЕ рвёт, 122 с — рвёт', () => {
    feed([
      msg({ createdAt: at('12:00:00') }),
      msg({ createdAt: at('12:02:01') }), // +121 c
      msg({ createdAt: at('12:04:03') }), // +122 c
    ])

    expect(layout()).toEqual([[1, 2], [3]])
  })

  it('сервисное сообщение не группируется ни с чем и рвёт серию', () => {
    feed([
      msg({ createdAt: at('12:00:00') }),
      msg({ createdAt: at('12:00:10'), type: 'service' }),
      msg({ createdAt: at('12:00:20') }),
    ])

    expect(layout()).toEqual([[1], [2], [3]])
  })

  it('входящее и исходящее не попадают в одну серию', () => {
    feed([
      msg({ createdAt: at('12:00:00'), out: false }),
      msg({ createdAt: at('12:00:10'), out: true }),
    ])

    expect(layout()).toEqual([[1], [2]])
  })

  it('порядок в серии — по seq, а не по порядку прихода баблов', () => {
    feed([
      msg({ seq: 3, createdAt: at('12:00:20') }),
      msg({ seq: 1, createdAt: at('12:00:00') }),
      msg({ seq: 2, createdAt: at('12:00:10') }),
    ])

    expect(layout()).toEqual([[1, 2, 3]])
  })
})

describe('инкрементальность', () => {
  /** Окно из `groupCount` серий по 5 сообщений: автор меняется каждые 5 штук. */
  const window5 = (groupCount: number) => {
    const messages: Message[] = []
    for (let i = 0; i < groupCount * 5; ++i) {
      messages.push(msg({ senderId: 2 + Math.floor(i / 5) % 2, createdAt: at('12:00:00') }))
    }
    return messages
  }

  /** Дописать одно сообщение в НИЖНЮЮ серию окна и вернуть цену вставки. */
  const appendOne = (groupCount: number) => {
    host = new TestHost()
    groups = new BubbleGroups(host)
    bubbleOf.clear()
    nextSeq = 0

    const messages = window5(groupCount)
    feed(messages)
    const last = messages[messages.length - 1]

    const before = snapshotClassNames()
    const canGroupSpy = vi.spyOn(groups, 'canItemsBeGrouped')
    const modified = feed([msg({ senderId: last.senderId, createdAt: at('12:00:00') })])
    const comparisons = canGroupSpy.mock.calls.length
    canGroupSpy.mockRestore()

    return { comparisons, modified, changed: changedSince(before) }
  }

  it('цена вставки не зависит от размера окна: сверок столько же на 40 сообщениях, сколько на 10', () => {
    const small = appendOne(2) // 10 сообщений
    const big = appendOne(8) // 40 сообщений

    expect(big.comparisons).toBe(small.comparisons)
    // Полный проход по окну (то, что делает React-лента) дал бы ≥ 39 сверок.
    expect(big.comparisons).toBeLessThan(10)
  })

  it('вставка трогает ровно одну серию и ровно два бабла — новый и бывший последний', () => {
    const { modified, changed } = appendOne(8)

    expect(modified.size).toBe(1)
    // 40 — бывший последний бабл окна, 41 — только что вставленный.
    expect(changed).toEqual([40, 41])
    expect(bubble(40).classList.contains('is-group-last')).toBe(false)
    expect(bubble(41).classList.contains('is-group-last')).toBe(true)
  })
})

describe('удаление бабла', () => {
  const three = () => feed([
    msg({ createdAt: at('12:00:00') }),
    msg({ createdAt: at('12:00:10') }),
    msg({ createdAt: at('12:00:20') }),
  ])

  it('из середины серии — края серии не меняются', () => {
    three()
    expect(groups.removeAndUnmountBubble(bubble(2))).toBe(true)

    expect(layout()).toEqual([[1, 3]])
    expect(edges()).toEqual([['f', 'l']])
  })

  it('из начала серии — is-group-first переезжает на нового первого', () => {
    three()
    groups.removeAndUnmountBubble(bubble(1))

    expect(layout()).toEqual([[2, 3]])
    expect(bubble(2).classList.contains('is-group-first')).toBe(true)
  })

  it('из конца серии — is-group-last переезжает на нового последнего', () => {
    three()
    groups.removeAndUnmountBubble(bubble(3))

    expect(layout()).toEqual([[1, 2]])
    expect(bubble(2).classList.contains('is-group-last')).toBe(true)
    expect(bubble(1).classList.contains('is-group-last')).toBe(false)
  })

  it('удаление единственного бабла снимает и серию, и опустевшую секцию дня', () => {
    feed([msg()])
    groups.removeAndUnmountBubble(bubble(1))

    expect(seriesEls()).toHaveLength(0)
    expect(host.chatInner.querySelectorAll('.bubbles-date-group')).toHaveLength(0)
  })

  it('удаление разделителя серий сливает соседей обратно в одну серию', () => {
    feed([
      msg({ senderId: 2, createdAt: at('12:00:00') }),
      msg({ senderId: 3, createdAt: at('12:00:10') }),
      msg({ senderId: 2, createdAt: at('12:00:20') }),
    ])
    expect(layout()).toEqual([[1], [2], [3]])

    groups.removeAndUnmountBubble(bubble(2))

    expect(layout()).toEqual([[1, 3]])
    expect(edges()).toEqual([['f', 'l']])
  })

  it('чужой узел (плейсхолдер) не ломает кэш и снимается сам', () => {
    feed([msg()])
    const placeholder = document.createElement('div')
    host.chatInner.append(placeholder)

    expect(groups.removeAndUnmountBubble(placeholder)).toBe(false)
    expect(placeholder.parentElement).toBeNull()
    expect(layout()).toEqual([[1]])
  })
})

describe('прилипающий аватар серии', () => {
  it('узел один на серию: дописанный в серию бабл не заводит второй аватар', () => {
    feed([msg({ createdAt: at('12:00:00') })], true)
    const group = groups.lastGroup

    feed([msg({ createdAt: at('12:00:10') })], true)
    feed([msg({ createdAt: at('12:00:20') })], true)

    expect(layout()).toEqual([[1, 2, 3]])
    expect(host.avatarsCreated).toBe(1)
    expect(group.container.querySelectorAll('.bubbles-group-avatar-container')).toHaveLength(1)
    expect(group.container.querySelectorAll('.avatar')).toHaveLength(1)
  })

  it('аватар лежит первым в серии, баблы — после него (offset)', () => {
    feed([
      msg({ createdAt: at('12:00:00') }),
      msg({ createdAt: at('12:00:10') }),
    ], true)
    const group = groups.lastGroup

    expect(group.offset).toBe(1)
    expect(group.container.firstElementChild!.className).toBe('bubbles-group-avatar-container')
    expect(layout()).toEqual([[1, 2]])
  })

  it('у каждой серии свой аватар', () => {
    feed([
      msg({ senderId: 2, createdAt: at('12:00:00') }),
      msg({ senderId: 3, createdAt: at('12:00:10') }),
    ], true)

    expect(host.avatarsCreated).toBe(2)
    expect(seriesEls().map((el) => el.querySelectorAll('.avatar').length)).toEqual([1, 1])
  })

  it('у сервисной серии аватара нет', () => {
    feed([msg({ type: 'service' })])
    const group = groups.lastGroup

    expect(group.createAvatar(group.firstItem.message)).toBeUndefined()
    expect(host.avatarsCreated).toBe(0)
  })

  it('destroyAvatar снимает узел и возвращает offset', () => {
    feed([msg()])
    const group = groups.lastGroup
    void group.createAvatar(group.firstItem.message)
    expect(group.offset).toBe(1)

    group.destroyAvatar()

    expect(group.offset).toBe(0)
    expect(group.container.querySelectorAll('.avatar')).toHaveLength(0)
  })

  it('avatar-for-reply-markup висит по ПОСЛЕДНЕМУ баблу серии', () => {
    feed([
      msg({ createdAt: at('12:00:00') }),
      msg({ createdAt: at('12:00:10'), replyMarkup: { inline: [[{ text: 'ok', callback: 'ok' }]] } }),
    ])
    const group = groups.lastGroup
    void group.createAvatar(group.firstItem.message)
    group.updateClassNames()

    expect(group.avatar!.node.classList.contains('avatar-for-reply-markup')).toBe(true)
  })
})

describe('getItemByBubble', () => {
  it('отдаёт то, чем пользуется обработчик history_update: mid и группу бабла', () => {
    feed([msg({ createdAt: at('12:00:00') }), msg({ createdAt: at('12:00:10') })])

    const item = groups.getItemByBubble(bubble(2))
    expect(item?.mid).toBe(2)
    expect(item?.group).toBe(groups.lastGroup)
    expect(item?.message.text).toBe('m2')
  })

  it('чужой узел — undefined', () => {
    feed([msg()])
    expect(groups.getItemByBubble(document.createElement('div'))).toBeUndefined()
  })

  it('changeBubbleMessage переклеивает адрес и порядок, не трогая узел и серию', () => {
    feed([msg({ id: -7, seq: 1 })])
    const el = bubble(-7)
    const group = groups.getItemByBubble(el)!.group

    groups.changeBubbleMessage(el, msg({ id: 42, seq: 9 }))

    const item = groups.getItemByBubble(el)!
    expect(item.mid).toBe(42)
    expect(item.seq).toBe(9)
    expect(item.group).toBe(group)
    expect(item.bubble).toBe(el)
  })

  it('changeBubbleByBubble переносит запись кэша на новый узел', () => {
    feed([msg()])
    const from = bubble(1)
    const to = document.createElement('div')

    groups.changeBubbleByBubble(from, to)

    expect(groups.getItemByBubble(from)).toBeUndefined()
    expect(groups.getItemByBubble(to)?.mid).toBe(1)
  })

  it('cleanup забывает окно целиком', () => {
    feed([msg(), msg()])
    groups.cleanup()

    expect(groups.getItemByBubble(bubble(1))).toBeUndefined()
    expect(groups.groups).toHaveLength(0)
    expect(groups.itemsArr).toHaveLength(0)
  })
})
