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
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import rootScope from '@lib/rootScope'
import contextMenuController from '@helpers/contextMenuController'
import { ManagersProvider } from '@core/hooks/useManagers'
import { putMirrorPage, resetMessagesMirror, winKey } from '@core/history/messagesMirror'
import { clearChatPositions } from '@core/chat/chatPositions'
import { useSettingsStore } from '@/settings'
import type { Managers } from '../../client/bootstrap'
import type { MessageReal, MyMessage } from '@core/models'
import { generateMessageId } from '@core/history/messageId'
import { makeMessage } from '@core/messages/testMessage'
import type { HistoryResult } from '@core/managers/messagesManager'
import type { ContextMenuPopups } from './contextMenu'
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
    menuPopups?: ContextMenuPopups
    onOpenDatePicker?: (initDate: number, onPick: (timestamp: number) => void) => void
  } = { peerId: CHAT },
) {
  const { managers, getHistory, messageByDate } = managersWith(messages)
  const view = render(
    <ManagersProvider managers={managers}>
      <div className="chat">
        <VanillaFeed paddingTopPx={0} paddingBottomPx={0} {...props} />
      </div>
    </ManagersProvider>,
  )
  return { ...view, getHistory, messageByDate }
}

beforeEach(() => {
  // Файл про ПРОВОДКУ ленты в React-дерево, а не про «лестницу» первой
  // загрузки. Лестница объявляет себя тяжёлой анимацией на сотни миллисекунд
  // (tweb bubbles.ts:10436-10440), и под ней очередь рендера ждёт — соседние
  // тесты этого файла упирались бы в таймаут `vi.waitFor`. Гейт тот же, что в
  // оригинале (`liteMode.isAvailable('animations')`, tweb bubbles.ts:11540).
  useSettingsStore.setState({ reduceMotion: true })
  // Размонтирование ленты пишет позицию чата в синглтон-карту (порт
  // `peer_changing` → `appImManager.saveChatPosition`) — без сброса следующий
  // тест открыл бы «тот же чат» ВОЗВРАТОМ, не спросив страницу у менеджера.
  clearChatPositions()
})

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

// ── Контекстное меню сообщения ──────────────────────────────────────────────
//
// Шестая строка проводки — `createContextMenu` в `ChatContext`: лента поднимает
// им порт `chat/contextMenu.ts` и вешает на свой контейнер (порт tweb
// bubbles.ts:1478 `this.chat.contextMenu.attachTo(container)`), а гасит в
// `destroy()` (порт chat.ts:845 `this.contextMenu?.destroy()`). Состав пунктов и
// их условия проверяет `contextMenu.test.ts`; здесь — ровно ПРОВОДКА.

/** Правый клик — десктопный путь `attachContextMenuListener` (как в
 *  `contextMenu.test.ts`). */
function rightClick(target: HTMLElement) {
  const e = new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
  Object.defineProperty(e, 'pageX', { value: 10 })
  Object.defineProperty(e, 'pageY', { value: 10 })
  target.dispatchEvent(e)
}

const menuElement = () => document.getElementById('bubble-contextmenu')

/** Дать отработать `verify()`/`ButtonMenu` — меню строится асинхронно. */
const flushMenu = () => new Promise((resolve) => setTimeout(resolve, 0))

function makeMenuPopups() {
  return {
    showPinMessage: vi.fn(),
    showDeleteMessages: vi.fn(),
    showForward: vi.fn(),
    showMessageReport: vi.fn(),
    showReactedList: vi.fn(),
    showStatistics: vi.fn(),
    showFactCheckEditor: vi.fn(),
  } satisfies ContextMenuPopups
}

/** Цель сообщений у меню — ЗЕРКАЛО окна (`messagesMirror`), а не дерево ленты:
 *  наполняем его тем же, что отдаёт `getHistory`. */
async function mountWithMenu(messages: MyMessage[]) {
  const popups = makeMenuPopups()
  putMirrorPage(winKey(CHAT), messages)
  const view = mount(messages, { peerId: CHAT, menuPopups: popups })
  await vi.waitFor(() => {
    expect(bubblesIn(view.container)).toHaveLength(messages.length)
  })
  return { ...view, popups }
}

describe('VanillaFeed — контекстное меню сообщения в ленте', () => {
  afterEach(() => {
    contextMenuController.close()
    // Закрытие только СНИМАЕТ `active`, а узел `destroy()` убирает через 300мс
    // (порт tweb contextMenu.ts:466-476). В следующем тесте он бы ещё лежал в
    // body и врал, что меню открылось.
    document.querySelectorAll('#bubble-contextmenu').forEach((el) => el.remove())
  })

  it('правый клик по баблу ленты открывает меню (`createContextMenu` + attachTo, tweb :1478)', async () => {
    const { container } = await mountWithMenu([msg(cid(1))])

    rightClick(container.querySelector<HTMLElement>('.bubble:not(.service) .bubble-content')!)
    await flushMenu()

    const element = menuElement()
    expect(element).not.toBeNull()
    // openBtnMenu — меню именно ОТКРЫТО, а не просто построено.
    expect(element!.classList.contains('active')).toBe(true)
  })

  it('по плейсхолдеру пустого чата (`bubble-first`) меню не открывается', async () => {
    // `renderEmptyPlaceholder` (tweb bubbles.ts:10785) лента ещё не портировала,
    // поэтому класс ставится на настоящий бабл — тем же приёмом, каким этот же
    // отсев пинают `selection.test.ts:110` и `replySwipe.test.ts:445-447`.
    const { container } = await mountWithMenu([msg(cid(1))])
    const bubble = container.querySelector<HTMLElement>('.bubble:not(.service)')!
    bubble.classList.add('bubble-first')

    rightClick(bubble.querySelector<HTMLElement>('.bubble-content')!)
    await flushMenu()

    expect(menuElement()).toBeNull()
  })

  it('пункт меню доезжает до попапа хоста парой «пир + номера»', async () => {
    const { container, popups } = await mountWithMenu([msg(cid(1))])

    rightClick(container.querySelector<HTMLElement>('.bubble:not(.service) .bubble-content')!)
    await flushMenu()

    const item = Array.from(menuElement()!.querySelectorAll<HTMLElement>('.btn-menu-item'))
      .find((el) => el.querySelector('.btn-menu-item-text')?.textContent === 'Delete')
    expect(item, 'пункт «Delete» не найден').toBeTruthy()
    item!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))

    expect(popups.showDeleteMessages).toHaveBeenCalledWith(CHAT, [cid(1)])
  })

  // Отвязка (`destroy()`) и ЗАКРЫТИЕ — разные вещи: `ChatContextMenu.destroy()`
  // это только `cleanup()` + `attachListenerSetter.removeAll()` (порт tweb
  // contextMenu.ts:689-692), а узел меню лежит в `document.body` и переживает
  // смерть ленты. В tweb этого не видно — кликнуть по другому чату сквозь
  // `.btn-menu-overlay` нельзя (_button.scss:590-599); у нас лента умирает и
  // без клика, поэтому владелец закрывает меню сам — тем же вызовом, каким
  // оригинал закрывает меню на исчезновении его цели (tweb contextMenu.ts:322-346).
  it('размонтирование ЗАКРЫВАЕТ открытое меню, а не бросает его в body', async () => {
    const { container, unmount } = await mountWithMenu([msg(cid(1))])

    rightClick(container.querySelector<HTMLElement>('.bubble:not(.service) .bubble-content')!)
    await flushMenu()
    const element = menuElement()
    expect(element, 'меню не открылось — тест ниже проверял бы пустоту').not.toBeNull()
    expect(element!.classList.contains('active')).toBe(true)

    unmount()

    // `close()` снимает `active` синхронно...
    expect(element!.classList.contains('active')).toBe(false)
    // ...а сам узел убирает `destroy()` через 300мс (порт tweb
    // contextMenu.ts:565-580 → 1762 `element.remove()`) — то есть по цепочке,
    // которую запускает ИМЕННО закрытие.
    await vi.waitFor(() => {
      expect(menuElement()).toBeNull()
    }, { timeout: 1000 })
  })

  it('размонтирование отвязывает меню (`contextMenu.destroy()` в bubbles.destroy)', async () => {
    const { container, unmount } = await mountWithMenu([msg(cid(1))])
    // Дерево уходит из документа вместе с хостом — держим ссылку, иначе после
    // размонтирования кликать будет некуда.
    const bubble = container.querySelector<HTMLElement>('.bubble:not(.service) .bubble-content')!

    unmount()
    rightClick(bubble)
    await flushMenu()

    expect(menuElement()).toBeNull()
  })
})
