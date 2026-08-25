// Тесты порта `components/chat/selection.ts` (tweb `AppSelection`/`ChatSelection`).
//
// Лента подменена узким портом `SelectionBubbles` — ровно тем, который в бою
// реализует `ChatBubbles`; DOM собирается по разметке tweb (`.bubbles` >
// `.bubbles-inner` > `.bubble[data-mid][data-peer-id]`, альбом —
// `.bubble.is-grouped` > `.grouped-item[data-mid]`).
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ChatSelection, {
  type SelectionBubbles,
  type SelectionManagers,
  type SelectionPlate,
} from './selection'
import ListenerSetter from '@helpers/listenerSetter'

const PEER = 1

function makeBubble(mid: number, classes: string[] = []): HTMLElement {
  const bubble = document.createElement('div')
  bubble.classList.add('bubble', ...classes)
  bubble.dataset.mid = String(mid)
  bubble.dataset.peerId = String(PEER)
  return bubble
}

function makeAlbum(mid: number, itemMids: number[]): HTMLElement {
  const bubble = makeBubble(mid, ['is-album', 'is-grouped'])
  const attachment = document.createElement('div')
  attachment.classList.add('attachment')
  for (const itemMid of itemMids) {
    const item = document.createElement('div')
    item.classList.add('album-item', 'grouped-item')
    item.dataset.mid = String(itemMid)
    item.dataset.peerId = String(PEER)
    attachment.append(item)
  }
  bubble.append(attachment)
  return bubble
}

/** Вертикальная раскладка: `getElementsBetween` считает порядок по rect'ам */
function layout(elements: HTMLElement[]) {
  elements.forEach((element, i) => {
    element.getBoundingClientRect = () => ({
      top: i * 50, left: 0, bottom: i * 50 + 40, right: 100,
      width: 100, height: 40, x: 0, y: i * 50, toJSON: () => ({}),
    })
  })
}

class FakeBubbles implements SelectionBubbles {
  constructor(public inner: HTMLElement) {}

  getRenderedHistory(sort: 'asc' | 'desc'): string[] {
    const mids = Array.from(this.inner.querySelectorAll<HTMLElement>('.bubble'))
      .map((bubble) => `${PEER}_${bubble.dataset.mid}`)
    return sort === 'asc' ? mids : mids.reverse()
  }

  getBubble(fullMid: string): HTMLElement | undefined {
    const mid = fullMid.slice(fullMid.indexOf('_') + 1)
    return this.inner.querySelector<HTMLElement>(`.bubble[data-mid="${mid}"]`) ?? undefined
  }

  getBubbleGroupedItems(bubble: HTMLElement): HTMLElement[] {
    return Array.from(bubble.querySelectorAll<HTMLElement>('.grouped-item'))
  }

  // Аналог tweb `getMountedBubble`: мид ячейки альбома резолвится в её узел
  async getMountedBubble(fullMid: string): Promise<{ bubble: HTMLElement } | undefined> {
    const mid = fullMid.slice(fullMid.indexOf('_') + 1)
    const bubble = this.getBubble(fullMid) ??
      this.inner.querySelector<HTMLElement>(`.grouped-item[data-mid="${mid}"]`)
    return bubble ? { bubble } : undefined
  }
}

function setup(bubbles: HTMLElement[]) {
  document.body.innerHTML = ''
  const container = document.createElement('div')
  container.classList.add('bubbles')
  const inner = document.createElement('div')
  inner.classList.add('bubbles-inner')
  container.append(inner)
  document.body.append(container)
  inner.append(...bubbles)
  layout(bubbles)

  const plate = {
    toggle: vi.fn<SelectionPlate['toggle']>(),
    update: vi.fn<SelectionPlate['update']>(),
    remove: vi.fn<SelectionPlate['remove']>(),
  } satisfies SelectionPlate

  const cantForwardDeleteMids = vi.fn(async () => ({ cantForward: false, cantDelete: false }))
  const managers: SelectionManagers = { messages: { cantForwardDeleteMids } }

  const port = new FakeBubbles(inner)
  const selection = new ChatSelection(port, managers, plate)
  selection.attachListeners(container, new ListenerSetter())

  return { container, inner, selection, plate, cantForwardDeleteMids }
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

const checkbox = (element: HTMLElement) =>
  element.querySelector<HTMLInputElement>(':scope > label.bubble-select-checkbox > input')

describe('canSelectBubble (tweb selection.ts:999-1006)', () => {
  const cases = ['service', 'is-outgoing', 'is-error', 'bubble-first', 'avoid-selection']

  it('обычный бабл выделяется', () => {
    const bubble = makeBubble(1)
    const { selection } = setup([bubble])
    expect(selection.canSelectBubble(bubble)).toBe(true)
  })

  for (const className of cases) {
    it(`.${className} — не выделяется`, () => {
      const bubble = makeBubble(1, [className])
      const { selection } = setup([bubble])
      expect(selection.canSelectBubble(bubble)).toBe(false)
      selection.toggleByElement(bubble)
      expect(selection.length()).toBe(0)
      expect(selection.isSelecting).toBe(false)
    })
  }
})

describe('toggleByElement (tweb :901-937)', () => {
  it('первый выбор включает режим, ставит чекбокс и is-selected', async() => {
    const bubble = makeBubble(1)
    const { selection, container, plate } = setup([bubble])

    selection.toggleByElement(bubble)

    expect(selection.isSelecting).toBe(true)
    expect(selection.getSelectedMids()).toEqual([1])
    expect(selection.isMidSelected(PEER, 1)).toBe(true)

    // разметка чекбокса — tweb :342-344 + :824-826 (prepend в бабл)
    const label = bubble.firstElementChild as HTMLElement
    expect(label.tagName).toBe('LABEL')
    expect(label.classList.contains('checkbox-field')).toBe(true)
    expect(label.classList.contains('checkbox-field-round')).toBe(true)
    expect(label.classList.contains('bubble-select-checkbox')).toBe(true)
    expect(checkbox(bubble)!.checked).toBe(true)
    expect(bubble.classList.contains('is-selected')).toBe(true)

    // класс режима на самой ленте — ПОСЛЕ плашки: tweb тоже ждёт композер
    // (`await chat.input.center(animate)`, :1010) прежде чем красить ленту
    expect(container.classList.contains('is-selecting')).toBe(false)
    await flush()
    expect(container.classList.contains('is-selecting')).toBe(true)
    expect(container.classList.contains('no-select')).toBe(true)
    expect(plate.toggle).toHaveBeenCalledWith(true, true)
  })

  it('повторный выбор снимает выделение и выключает режим', () => {
    const bubble = makeBubble(1)
    const { selection, container } = setup([bubble])

    selection.toggleByElement(bubble)
    selection.toggleByElement(bubble)

    expect(selection.getSelectedMids()).toEqual([])
    expect(selection.isSelecting).toBe(false)
    // выход из режима убирает чекбокс целиком (tweb :372-377)
    expect(checkbox(bubble)).toBeNull()
    expect(container.classList.contains('no-select')).toBe(false)
  })

  it('cancelSelection снимает всё выделение (tweb :475-482)', () => {
    const b1 = makeBubble(1)
    const b2 = makeBubble(2)
    const { selection } = setup([b1, b2])

    selection.toggleByElement(b1)
    selection.toggleByElement(b2)
    expect(selection.length()).toBe(2)

    selection.cancelSelection()

    expect(selection.length()).toBe(0)
    expect(selection.isSelecting).toBe(false)
    expect(selection.selectedMids.size).toBe(0)
  })
})

describe('чекбоксы по всей ленте (tweb :862-885, :346-378)', () => {
  it('вход в режим досыпает чекбоксы всем отрисованным баблам', () => {
    const b1 = makeBubble(1)
    const b2 = makeBubble(2)
    const b3 = makeBubble(3, ['service'])
    const { selection } = setup([b1, b2, b3])

    selection.toggleByElement(b1)

    expect(checkbox(b1)).not.toBeNull()
    expect(checkbox(b2)).not.toBeNull()
    // service выделять нельзя — чекбокса нет (tweb :888)
    expect(checkbox(b3)).toBeNull()
    expect(checkbox(b2)!.checked).toBe(false)
  })

  it('выход из режима убирает чекбоксы', () => {
    const b1 = makeBubble(1)
    const b2 = makeBubble(2)
    const { selection } = setup([b1, b2])

    selection.toggleByElement(b1)
    selection.cancelSelection()

    expect(checkbox(b1)).toBeNull()
    expect(checkbox(b2)).toBeNull()
  })

  it('бабл, доехавший уже в режиме, встаёт в нужное положение без перехода (tweb :364-370)', () => {
    const b1 = makeBubble(1)
    const { selection, inner } = setup([b1])
    selection.toggleByElement(b1)

    // сообщение дорисовалось позже, а его мид уже выбран
    const late = makeBubble(7)
    inner.append(late)
    selection.toggleMid(PEER, 7)
    selection.toggleElementCheckbox(late, true)

    expect(checkbox(late)!.checked).toBe(true)
    expect(late.classList.contains('is-selected')).toBe(true)
  })
})

describe('альбомы (tweb :887-937, :951-974)', () => {
  it('выбор контейнера выбирает все ячейки, чекбокс контейнера отражает «все выбраны»', () => {
    const album = makeAlbum(10, [10, 11, 12])
    const { selection } = setup([album])

    selection.toggleByElement(album)

    expect(selection.getSelectedMids()).toEqual([10, 11, 12])
    const items = Array.from(album.querySelectorAll<HTMLElement>('.grouped-item'))
    for (const item of items) {
      expect(checkbox(item)!.checked).toBe(true)
      expect(item.classList.contains('is-selected')).toBe(true)
    }
    expect(checkbox(album)!.checked).toBe(true)
  })

  it('снятие одной ячейки снимает чекбокс контейнера, остальные остаются', () => {
    const album = makeAlbum(10, [10, 11, 12])
    const { selection } = setup([album])

    selection.toggleByElement(album)
    const items = Array.from(album.querySelectorAll<HTMLElement>('.grouped-item'))
    selection.toggleByElement(items[1])

    expect(selection.getSelectedMids()).toEqual([10, 12])
    expect(checkbox(items[1])!.checked).toBe(false)
    expect(checkbox(album)!.checked).toBe(false)
    expect(checkbox(items[0])!.checked).toBe(true)
  })

  it('контейнер, выбранный не целиком, по клику добирается до полного выбора', () => {
    const album = makeAlbum(10, [10, 11, 12])
    const { selection } = setup([album])

    selection.toggleByElement(album)
    const items = Array.from(album.querySelectorAll<HTMLElement>('.grouped-item'))
    selection.toggleByElement(items[1]) // 10, 12

    selection.toggleByElement(album) // tweb :908-916 — сначала сброс, потом все

    expect(selection.getSelectedMids()).toEqual([10, 11, 12])
    expect(checkbox(album)!.checked).toBe(true)
  })
})

describe('drag-выделение мышью (tweb :163-306)', () => {
  const down = (element: HTMLElement) =>
    element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }))
  const move = (element: HTMLElement) =>
    element.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }))
  const up = () => document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))

  it('первый бабл режим не включает — тоггл начинается со второго (tweb :240-247)', async() => {
    const b1 = makeBubble(1)
    const b2 = makeBubble(2)
    const { selection } = setup([b1, b2])

    down(b1)
    move(b1)
    await flush()

    expect(selection.isSelecting).toBe(false)
    expect(selection.length()).toBe(0)

    move(b2)
    await flush()

    expect(selection.getSelectedMids()).toEqual([1, 2])
    expect(selection.isSelecting).toBe(true)
    up()
  })

  it('пропущенные баблы добираются через getElementsBetween (tweb :308-336)', async() => {
    const b1 = makeBubble(1)
    const b2 = makeBubble(2)
    const b3 = makeBubble(3)
    const { selection } = setup([b1, b2, b3])

    down(b1)
    move(b1)
    move(b3) // курсор перескочил через b2
    await flush()

    expect(selection.getSelectedMids()).toEqual([1, 2, 3])
    up()
  })

  it('mouseup снимает body.no-select и слушателя движения', async() => {
    const b1 = makeBubble(1)
    const b2 = makeBubble(2)
    const b3 = makeBubble(3)
    const { selection } = setup([b1, b2, b3])

    down(b1)
    move(b1)
    expect(document.body.classList.contains('no-select')).toBe(true)
    up()
    expect(document.body.classList.contains('no-select')).toBe(false)

    move(b2)
    move(b3)
    await flush()

    expect(selection.length()).toBe(0)
  })

  it('нажатие на потомка бабла протяжку не заводит (tweb verifyTarget :799-807)', async() => {
    const b1 = makeBubble(1)
    const inner = document.createElement('span')
    inner.classList.add('bubble-content')
    b1.append(inner)
    const b2 = makeBubble(2)
    const { selection } = setup([b1, b2])

    down(inner)
    move(b1)
    move(b2)
    await flush()

    expect(selection.length()).toBe(0)
  })

  it('правая кнопка протяжку не заводит (tweb :165-167)', async() => {
    const b1 = makeBubble(1)
    const b2 = makeBubble(2)
    const { selection } = setup([b1, b2])

    b1.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 2 }))
    move(b1)
    move(b2)
    await flush()

    expect(selection.length()).toBe(0)
  })
})

describe('updateContainer (tweb :385-403)', () => {
  it('дизейбл кнопок плашки считается по выбранным мидам', async() => {
    const b1 = makeBubble(1)
    const { selection, plate, cantForwardDeleteMids } = setup([b1])
    cantForwardDeleteMids.mockResolvedValue({ cantForward: true, cantDelete: false })

    selection.toggleByElement(b1)
    await flush()

    expect(cantForwardDeleteMids).toHaveBeenCalledWith(PEER, [1], false)
    expect(plate.update).toHaveBeenCalledWith(true, false, false)
  })

  it('на нуле выбранных плашка не пересчитывается (ранний выход :387)', async() => {
    const b1 = makeBubble(1)
    const { selection, plate, cantForwardDeleteMids } = setup([b1])

    selection.toggleByElement(b1)
    await flush()
    plate.update.mockClear()
    cantForwardDeleteMids.mockClear()

    selection.toggleByElement(b1) // снятие — выбранных не осталось
    await flush()

    expect(cantForwardDeleteMids).not.toHaveBeenCalled()
    expect(plate.update).not.toHaveBeenCalled()
  })
})

describe('deleteSelectedMids (tweb :552-578)', () => {
  it('удаление последнего выбранного выключает режим', async() => {
    const b1 = makeBubble(1)
    const { selection } = setup([b1])

    selection.toggleByElement(b1)
    expect(selection.isSelecting).toBe(true)

    selection.deleteSelectedMids(PEER, [1])
    await flush()

    expect(selection.length()).toBe(0)
    expect(selection.isSelecting).toBe(false)
  })

  it('batch откладывает пересчёт до вызова возвращённого хвоста', () => {
    const b1 = makeBubble(1)
    const b2 = makeBubble(2)
    const { selection } = setup([b1, b2])

    selection.toggleByElement(b1)
    const after = selection.deleteSelectedMids(PEER, [1], true)

    expect(selection.length()).toBe(0)
    expect(selection.isSelecting).toBe(true)

    after!()
    expect(selection.isSelecting).toBe(false)
  })
})

describe('событие toggle (tweb :429)', () => {
  it('стреляет на вход и на выход из режима', () => {
    const b1 = makeBubble(1)
    const { selection } = setup([b1])
    const onToggle = vi.fn()
    selection.addEventListener('toggle', onToggle)

    selection.toggleByElement(b1)
    selection.toggleByElement(b1)

    expect(onToggle.mock.calls).toEqual([[true], [false]])
  })
})

beforeEach(() => {
  document.body.className = ''
})
