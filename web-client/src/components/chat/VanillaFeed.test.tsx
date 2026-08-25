// src/components/chat/VanillaFeed.test.tsx
//
// Проводка React-хоста императивной ленты. Норма (web-client/CLAUDE.md,
// «Тесты»): строка проводки обязана краснить тест на своём удалении. Здесь под
// нормой ЧЕТЫРЕ строки layout-эффекта `VanillaFeed`:
//   `new ChatBubbles(...)`      — поднять ленту;
//   `host.append(container)`    — вставить её дерево в React-хост;
//   `void bubbles.setPeer()`     — набрать окно чата (порт `Chat.setPeer`);
//   `bubbles.destroy()` в cleanup — снять подписки на размонтировании.
// Каждая покрыта отдельным `it` ниже. Пятая — проброс `isMegagroup` в
// `ChatContext`: без него сообщение от лица канала уезжает не на ту сторону
// (порт `Chat.isOurMessage`, tweb chat.ts:1375-1377).
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import rootScope from '@lib/rootScope'
import { ManagersProvider } from '@core/hooks/useManagers'
import { resetMessagesMirror, winKey } from '@core/history/messagesMirror'
import type { Managers } from '../../client/bootstrap'
import type { MessageReal, MyMessage } from '@core/models'
import { generateMessageId } from '@core/history/messageId'
import { makeMessage } from '@core/messages/testMessage'
import type { HistoryResult } from '@core/managers/messagesManager'
import VanillaFeed from './VanillaFeed'

const CHAT = 50

/** Номер в КЛИЕНТСКОМ пространстве — окно живёт только в нём. */
const cid = generateMessageId

function msg(id: number, over: Partial<MessageReal> = {}): MyMessage {
  return { ...makeMessage({ id, peerId: CHAT, fromId: 2, text: `m${id}`, date: 1_755_259_200 }), ...over }
}

function managersWith(messages: MyMessage[]) {
  const getHistory = vi.fn(
    async (): Promise<HistoryResult> => ({ messages, count: messages.length, reachedTop: true, reachedBottom: true }),
  )
  const fillMirror = vi.fn(async () => {})
  const dialogs = { getReadMaxSeqIfUnread: async () => 0, getHistoryMaxSeq: async () => 0 }
  const getAround = vi.fn(async () => ({ messages, reachedTop: true, reachedBottom: true }))
  const messageByDate = vi.fn(async (): Promise<number | null> => null)
  return {
    managers: { messages: { getHistory, getAround, messageByDate }, peers: { fillMirror }, dialogs } as unknown as Managers,
    getHistory,
    messageByDate,
  }
}

/** Колонка чата (`.chat`) вокруг хоста — как в проде (`Chat.tsx`). Без неё
 *  эффект `VanillaFeed` не найдёт узел, которому лента вешает
 *  `is-go-down-visible` (порт tweb `chat.container`), и не поднимется. */
function mount(
  messages: MyMessage[],
  props: {
    peerId: PeerId
    threadRootId?: number
    isMegagroup?: boolean
    onOpenDatePicker?: (initDate: number, onPick: (timestamp: number) => void) => void
  } = { peerId: CHAT },
) {
  const { managers, getHistory, messageByDate } = managersWith(messages)
  const view = render(
    <ManagersProvider managers={managers}>
      <div className="chat">
        <VanillaFeed {...props} />
      </div>
    </ManagersProvider>,
  )
  return { ...view, getHistory, messageByDate }
}

afterEach(() => {
  cleanup()
  resetMessagesMirror()
})

/** Баблы СООБЩЕНИЙ: `.service` — это дата-бабл секции дня и его is-fake-дубль
 *  (порт tweb `createDateBubble`), сообщений за ними не стоит. */
const bubblesIn = (root: ParentNode) => root.querySelectorAll('.bubble:not(.service)')

describe('VanillaFeed — проводка императивной ленты в React-дерево', () => {
  it('поднимает ChatBubbles и вешает её дерево в хост (`new ChatBubbles` + `host.append`)', () => {
    const { container } = mount([])

    // Хост объявлен display:contents намеренно — .bubbles обязан остаться
    // flex-ребёнком .chat, как в tweb (см. докблок VanillaFeed.tsx).
    const host = container.querySelector('.chat')!.firstElementChild as HTMLElement
    expect(host.style.display).toBe('contents')

    const bubbles = host.querySelector('.bubbles')
    expect(bubbles).not.toBeNull()
    // Дерево именно ChatBubbles, а не пустой div: внутри — контейнер Scrollable
    // с .bubbles-inner (полная сверка дерева — bubbles.test.ts).
    expect(bubbles!.querySelector('.bubbles-scrollable > .bubbles-inner')).not.toBeNull()
  })

  it('просит у ленты окно чата и рисует его (`void bubbles.setPeer()`)', async () => {
    const { container, getHistory } = mount([msg(cid(1)), msg(cid(2), { message: 'привет' })])

    // Страница запрашивается не синхронно: `setPeer` сначала спрашивает у
    // владельца диалога последнее сообщение чата (`topMessageFullMid`, порт
    // tweb bubbles.ts:5079-5081).
    await vi.waitFor(() => {
      expect(getHistory).toHaveBeenCalledTimes(1)
    })
    await vi.waitFor(() => {
      expect(bubblesIn(container)).toHaveLength(2)
    })
    // Время лежит внутри `.message` (порт tweb :7630) и в `textContent`
    // попадает дважды — сам `span.time` и его дубль `.time-inner`; тест здесь
    // про ТЕКСТ сообщения, поэтому сверяется его начало.
    expect(container.querySelectorAll('.message')[1].textContent).toContain('привет')
  })

  it('ключ окна берётся из winKey — на треде лента открывает окно ТРЕДА', async () => {
    const { container, getHistory } = mount([], { peerId: CHAT, threadRootId: 60 })

    // Ждём доезда первой страницы: новое сообщение лента рисует, только когда
    // низ окна сведён с концом истории (tweb `_renderNewMessage`, :4538).
    await vi.waitFor(() => {
      expect(getHistory).toHaveBeenCalledWith(expect.objectContaining({ peerId: CHAT, threadRoot: 60 }))
    })
    await new Promise((resolve) => setTimeout(resolve, 0))
    // Подписки сверяют событие по этому же ключу: событие окна треда доезжает,
    // событие основного окна того же чата — нет. Рисуется бабл не сразу:
    // отрисовкой владеет очередь рендера ленты (порт tweb `batchProcessor`).
    rootScope.dispatchEventSingle('history_append', { storageKey: winKey(CHAT), message: msg(cid(1)) })

    rootScope.dispatchEventSingle('history_append', {
      storageKey: winKey(CHAT, 60),
      message: msg(cid(2), { reply_to: { _: 'messageReplyHeader', reply_to_top_id: 60 } }),
    })
    await vi.waitFor(() => {
      expect(bubblesIn(container)).toHaveLength(1)
    })
    // ...и это бабл ИМЕННО окна треда
    expect(container.querySelector('.bubble:not(.service)')!.getAttribute('data-mid')).toBe(String(cid(2)))
  })

  // Пятая строка проводки — `navigation.openDatePicker`: показ попапа принадлежит
  // владельцу слоя попапов (`Chat.tsx`), а лента лишь объявляет «кликнули по
  // дате этой секции» (порт роли `Chat` в tweb bubbles.ts:3075-3078).
  it('проводит календарь наверх: клик по дата-баблу зовёт onOpenDatePicker', async () => {
    const onOpenDatePicker = vi.fn<(initDate: number, onPick: (timestamp: number) => void) => void>()
    const { container } = mount([msg(cid(1))], { peerId: CHAT, onOpenDatePicker })

    await vi.waitFor(() => {
      expect(container.querySelector('.bubble.is-date')).not.toBeNull()
    })

    const dateContent = container.querySelector<HTMLElement>('.bubble.is-date:not(.is-fake) .bubble-content')!
    dateContent.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))

    expect(onOpenDatePicker).toHaveBeenCalledWith(expect.any(Number), expect.any(Function))
  })

  // Вид чата лента сама не знает (сторов ей нельзя) — он приезжает пропом и
  // уходит в `ChatContext`. Пин смотрит на ИТОГ: сторону бабла у send-as
  // (`pFlags.out` стоит, автор — канал). Без проброса он уехал бы влево.
  it('`isMegagroup` доезжает до ленты: send-as рисуется СПРАВА', async () => {
    const sendAs = msg(cid(1), { pFlags: { out: true }, from_id: { _: 'peerChannel', channel_id: 7 }, fromId: -7 })
    const { container } = mount([sendAs], { peerId: CHAT, isMegagroup: true })

    await vi.waitFor(() => {
      expect(bubblesIn(container)).toHaveLength(1)
    })
    expect(bubblesIn(container)[0].classList.contains('is-out')).toBe(true)
  })

  it('без объявленного вида чата тот же send-as — входящий', async () => {
    const sendAs = msg(cid(1), { pFlags: { out: true }, from_id: { _: 'peerChannel', channel_id: 7 }, fromId: -7 })
    const { container } = mount([sendAs])

    await vi.waitFor(() => {
      expect(bubblesIn(container)).toHaveLength(1)
    })
    expect(bubblesIn(container)[0].classList.contains('is-in')).toBe(true)
  })

  it('размонтирование гасит ленту: узел снят, подписки сняты (`bubbles.destroy()`)', async () => {
    const { container, unmount } = mount([msg(cid(1))])
    await vi.waitFor(() => {
      expect(bubblesIn(container)).toHaveLength(1)
    })
    // Держим ссылку на оторвавшееся дерево: после размонтирования оно уходит из
    // документа, и «нарисовала ли живая подписка ещё один бабл» видно только по
    // нему, а не по document.
    // Именно chatInner, а не одноимённый по классу `.bubbles-remover.bubbles-inner`.
    const detached = container.querySelector('.bubbles-scrollable > .bubbles-inner')!

    unmount()

    expect(container.querySelector('.bubbles')).toBeNull()
    // Живая подписка после размонтирования — утечка: лента продолжала бы
    // рисовать в оторванное от документа дерево.
    rootScope.dispatchEventSingle('history_append', { storageKey: winKey(CHAT), message: msg(cid(2)) })
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(bubblesIn(detached)).toHaveLength(1)
  })
})
