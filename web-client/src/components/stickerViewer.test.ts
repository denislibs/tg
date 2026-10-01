// Порт tweb `components/stickerViewer.ts` (812502980) — `attachStickerViewerListeners`.
// Жест целиком на настоящих событиях DOM: mousedown на ячейке, 125 мс удержания,
// mousemove по документу, mouseup. Врапперы медиа подменены — их рендер предмет
// своих тестов; здесь важно, ЧТО просмотрщик попросил нарисовать и КОГДА.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ListenerSetter from '@helpers/listenerSetter'
import { makeSticker } from '@core/stickers/testSticker'
import { getDoc } from '@core/media/messageMedia'
import attachStickerViewerListeners from './stickerViewer'

// Реестр документов воркера (`managers.docs.getDoc`) — та же функция модуля,
// что регистрирует воркер (`workerCore.ts`): фикстуры проходят `saveDocument`.
vi.mock('@/client/bootstrap', () => ({
  startClient: () => ({ managers: { docs: { getDoc: async(id: number) => getDoc(id) } } }),
}))

const wrapSticker = vi.fn((o: { div: HTMLElement }) => {
  const img = document.createElement('img')
  img.classList.add('media-sticker')
  o.div.append(img)
  return { render: Promise.resolve(img), width: 0, height: 0, destroy: () => {} }
})
vi.mock('@components/wrappers/sticker', () => ({ default: (o: { div: HTMLElement }) => wrapSticker(o) }))
vi.mock('@components/wrappers/video', () => ({ default: vi.fn() }))

const OPEN = 125 // tweb :243 — порог удержания
const TRANSITION = 200 // tweb :81-82 — openDuration/switchDuration

let listenerSetter: ListenerSetter
let listenTo: HTMLElement

function cell(id: number): HTMLElement {
  makeSticker({ id, emoji: '🦆' })
  const el = document.createElement('div')
  el.className = 'grid-item super-sticker media-sticker-wrapper'
  el.dataset.docId = '' + id
  // tweb wrapSticker кладёт в ячейку медиа — mousedown обычно приходит на него
  el.append(document.createElement('canvas'))
  listenTo.append(el)
  return el
}

const mouse = (type: string, target: EventTarget, init: MouseEventInit = {}) =>
  target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, buttons: 1, ...init }))

const viewer = () => document.querySelector<HTMLElement>('.sticker-viewer')
const shownIds = () => wrapSticker.mock.calls.map(([o]) => (o as unknown as { mediaId: number }).mediaId)

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'requestAnimationFrame', 'cancelAnimationFrame'] })
  wrapSticker.mockClear()
  listenerSetter = new ListenerSetter()
  listenTo = document.createElement('div')
  listenTo.className = 'scrollable'
  document.body.append(listenTo)
  attachStickerViewerListeners({ listenTo, listenerSetter })
})

afterEach(async() => {
  // жест обязан закончиться: модульный `hasViewer` иначе запер бы следующий тест
  mouse('mouseup', document)
  await vi.advanceTimersByTimeAsync(TRANSITION + 50)
  listenerSetter.removeAll()
  document.body.replaceChildren()
  vi.useRealTimers()
})

describe('attachStickerViewerListeners — удержание, скольжение, отпускание', () => {
  it('удержание 125 мс открывает .sticker-viewer над тем стикером, на котором зажали', async() => {
    const first = cell(11)
    cell(12)

    mouse('mousedown', first.firstElementChild!)
    await vi.advanceTimersByTimeAsync(OPEN - 25)
    expect(viewer()).toBeNull() // порог не истёк

    await vi.advanceTimersByTimeAsync(TRANSITION + 50)
    const v = viewer()
    expect(v).not.toBeNull()
    expect(v!.parentElement).toBe(document.body) // getOverlayRoot()
    expect(v!.classList.contains('is-visible')).toBe(true)
    expect(shownIds()).toEqual([11])
    const transformers = v!.querySelectorAll('.sticker-viewer-transformer')
    expect(transformers).toHaveLength(1)
    // tweb :100 — бокс 360 у стикера без эффекта
    const sticker = transformers[0].querySelector<HTMLElement>('.sticker-viewer-sticker')!
    expect(sticker.style.width).toBe('360px')
    expect(transformers[0].querySelector('.sticker-viewer-emoji img.emoji')!.getAttribute('alt')).toBe('🦆')
  })

  it('ведение мыши с зажатой кнопкой на соседний стикер переключает предпросмотр на него', async() => {
    const first = cell(21)
    const second = cell(22)

    mouse('mousedown', first)
    await vi.advanceTimersByTimeAsync(OPEN + TRANSITION + 50)
    expect(shownIds()).toEqual([21])

    mouse('mousemove', second.firstElementChild!)
    await vi.advanceTimersByTimeAsync(50)
    expect(shownIds()).toEqual([21, 22])
    // старый уходит классом is-switching, новый уже в контейнере
    const during = viewer()!.querySelectorAll('.sticker-viewer-transformer')
    expect(during).toHaveLength(2)
    expect(during[0].classList.contains('is-switching')).toBe(true)

    await vi.advanceTimersByTimeAsync(TRANSITION + 50)
    expect(viewer()!.querySelectorAll('.sticker-viewer-transformer')).toHaveLength(1)
  })

  it('стикер вне контейнера жеста не переключает предпросмотр (findTarget(e, true))', async() => {
    const first = cell(31)
    const outside = document.createElement('div')
    outside.className = 'media-sticker-wrapper'
    outside.dataset.docId = '32'
    makeSticker({ id: 32 })
    document.body.append(outside)

    mouse('mousedown', first)
    await vi.advanceTimersByTimeAsync(OPEN + TRANSITION + 50)
    mouse('mousemove', outside)
    await vi.advanceTimersByTimeAsync(TRANSITION + 50)
    expect(shownIds()).toEqual([31])
  })

  it('отпускание закрывает предпросмотр и глотает следующий click — стикер не отправляется', async() => {
    const first = cell(41)
    const onClick = vi.fn()
    first.addEventListener('click', onClick)

    mouse('mousedown', first)
    await vi.advanceTimersByTimeAsync(OPEN + TRANSITION + 50)
    expect(viewer()).not.toBeNull()

    mouse('mouseup', first)
    expect(viewer()!.classList.contains('backwards')).toBe(true) // уходит переходом
    await vi.advanceTimersByTimeAsync(TRANSITION + 50)
    expect(viewer()).toBeNull()

    mouse('click', first)
    expect(onClick).not.toHaveBeenCalled()
  })

  it('быстрый клик (mouseup до порога) предпросмотра не открывает и click не глотает', async() => {
    const first = cell(51)
    const onClick = vi.fn()
    first.addEventListener('click', onClick)

    mouse('mousedown', first)
    await vi.advanceTimersByTimeAsync(50)
    mouse('mouseup', first)
    mouse('click', first)
    await vi.advanceTimersByTimeAsync(OPEN + TRANSITION + 50)

    expect(viewer()).toBeNull()
    expect(wrapSticker).not.toHaveBeenCalled()
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('увод курсора с ячейки до порога обрывает жест (onMousePreMove)', async() => {
    const first = cell(61)
    const second = cell(62)

    mouse('mousedown', first)
    await vi.advanceTimersByTimeAsync(50)
    mouse('mousemove', second)
    await vi.advanceTimersByTimeAsync(OPEN + TRANSITION + 50)

    expect(viewer()).toBeNull()
  })

  it('правая кнопка жест не начинает', async() => {
    const first = cell(71)
    mouse('mousedown', first, { button: 2, buttons: 2 })
    await vi.advanceTimersByTimeAsync(OPEN + TRANSITION + 50)
    expect(viewer()).toBeNull()
  })
})
