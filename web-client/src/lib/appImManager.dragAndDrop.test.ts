// Блок K `AppImManager` (порт tweb `src/lib/appImManager.ts:2807-3125`, П-4, Б-24):
// зоны сброса файлов поверх чата (`ChatDragAndDrop`, `.drops-container`) появляются
// по `dragover` с файлами и пропадают по `dragleave`/сторожу 500 мс; сброс на зону и
// вставка из буфера открывают попап медиа (`popups/newMedia.ts::showNewMediaPopup`)
// с видом вложения; сброс на строку чатлиста сначала открывает чат.
// Класс — настоящий и ОДИН на файл: слушатели вешаются на `document`/`body`, второй
// экземпляр ответил бы на те же события. Чат — дублёр `Chat` в объёме блока K.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import pause from '@helpers/schedulers/pause'
import mediaSizes, { ScreenSize } from '@core/dom/mediaSizes'
import type { Managers } from '@/client/bootstrap'
import { AppImManager } from './appImManager'

const columnRight = vi.hoisted(() => ({ sidebarEl: undefined as HTMLElement | undefined, toggleSidebar: () => Promise.resolve(), hide: () => {}, replaceSharedMediaTab: () => {} }))
vi.mock('@components/sidebarRight', () => ({ default: columnRight, RIGHT_COLUMN_ACTIVE_CLASSNAME: 'is-right-column-shown' }))
vi.mock('@components/chat/bubbles/chatBackground.solid', () => ({
  default: { setBackground: () => Promise.resolve(), getReadyPromise: () => Promise.resolve() },
}))

const newMedia = vi.hoisted(() => ({
  show: vi.fn(),
  current: undefined as undefined | { addFiles: (files: File[]) => void },
}))
vi.mock('@components/popups/newMedia', () => ({
  default: newMedia.show,
  getCurrentNewMediaPopup: () => newMedia.current,
}))

type FakeAppImManager = { isSamePeer(a: object, b: object): boolean, dispatchEvent(name: string, chat: object): void }
const canSend = vi.hoisted(() => ({ value: true }))
const FakeChat = vi.hoisted(() => class {
  public container = document.createElement('div')
  public peerId = 0
  public type = 'chat'
  public inited?: boolean
  public input = { willAttachType: undefined as 'media' | 'document' | undefined }
  constructor(public appImManager: FakeAppImManager) {
    this.container.classList.add('chat', 'tabs-tab')
  }

  public canSend() {
    return Promise.resolve(canSend.value)
  }

  public async setPeer(options: { peerId?: number }) {
    this.appImManager.dispatchEvent('peer_changing', this)
    this.peerId = options.peerId || 0
    this.inited = true
    this.appImManager.dispatchEvent('peer_changed', this)
    return { cached: true, promise: Promise.resolve() }
  }

  public publishBackground() {
    return Promise.resolve()
  }

  public beforeDestroy() {}
  public destroy() {}
})
vi.mock('@components/chat/chat', () => ({ default: FakeChat }))

// happy-dom не знает `DragEvent`: событие с `dataTransfer`, как у браузера
class FakeDragEvent extends Event {
  constructor(type: string, public dataTransfer: unknown) {
    super(type, { bubbles: true, cancelable: true })
  }
}

type FakeItem = { kind: string, type: string, getAsFile(): File | null, webkitGetAsEntry(): null }
function transfer(files: File[], types = files.length ? ['Files'] : ['text/plain']) {
  const items: FakeItem[] = files.map((file) => ({ kind: 'file', type: file.type, getAsFile: () => file, webkitGetAsEntry: () => null }))
  return { types, items, files }
}

function drag(target: EventTarget, type: string, files: File[], types?: string[]) {
  const e = new FakeDragEvent(type, transfer(files, types))
  target.dispatchEvent(e)
  return e
}

function paste(files: File[]) {
  const e = new Event('paste', { bubbles: true, cancelable: true })
  Object.defineProperty(e, 'clipboardData', { value: transfer(files) })
  document.body.dispatchEvent(e)
}

const managers = {
  peers: { getPeers: async() => [], fillMirror: async() => {}, resolveUsername: vi.fn() },
  presence: { get: async() => [] },
  dialogs: { hasDialog: async() => true, refresh: async() => null },
} as unknown as Managers

const png = new File(['x'], 'cat.png', { type: 'image/png' })
const pdf = new File(['x'], 'doc.pdf', { type: 'application/pdf' })

let im: AppImManager
let center: HTMLElement
const zones = () => im.chat.container.querySelector('.drops-container')
const drops = () => Array.from(im.chat.container.querySelectorAll('.drops-container .drop'))

beforeAll(() => {
  mediaSizes.isMobile = false
  mediaSizes.isFloatingLeftSidebar = false
  mediaSizes.activeScreen = ScreenSize.large
  const left = document.getElementById('column-left')!
  center = document.getElementById('column-center')!
  const right = document.getElementById('column-right')!
  document.body.append(left, center, right)
  columnRight.sidebarEl = right
  im = new AppImManager()
  im.construct(managers)
})

beforeEach(async() => {
  vi.stubGlobal('DragEvent', FakeDragEvent)
  canSend.value = true
  newMedia.show.mockClear()
  newMedia.current = undefined
  await im.chat.setPeer({ peerId: 42 } as never)
})

// сторож снимает зоны и обнуляет счётчик `dragenter`/`dragleave` между тестами
afterEach(async() => {
  await pause(750)
  vi.unstubAllGlobals()
})

describe('зоны сброса (tweb :2815-3035)', () => {
  it('dragenter + dragover с картинкой — две зоны в чате и body.is-dragging; dragleave — зоны уходят', async() => {
    drag(center, 'dragenter', [png])
    const over = drag(center, 'dragover', [png])
    expect(over.defaultPrevented).toBe(true)
    await pause(0)

    expect(zones()?.classList.contains('is-visible')).toBe(true)
    expect(drops().map((d) => d.querySelector('.drop-subtitle')?.textContent)).toHaveLength(2)
    expect(drops().every((d) => d.classList.contains('has-icon'))).toBe(true)
    expect(document.body.classList.contains('is-dragging')).toBe(true)

    drag(center, 'dragleave', [png])
    await pause(0)
    expect(document.body.classList.contains('is-dragging')).toBe(false)
    await pause(300)
    expect(zones()?.classList.contains('is-visible')).toBe(false)
    expect(drops()).toHaveLength(0)
  })

  it('документ — одна зона «без сжатия»; текст и чат без права на медиа — без зон', async() => {
    drag(center, 'dragenter', [pdf])
    drag(center, 'dragover', [pdf])
    await pause(0)
    expect(drops()).toHaveLength(1)
    drag(center, 'dragleave', [pdf])
    await pause(300)

    drag(center, 'dragenter', [], ['text/plain'])
    drag(center, 'dragover', [], ['text/plain'])
    await pause(0)
    expect(drops()).toHaveLength(0)
    expect(document.body.classList.contains('is-dragging')).toBe(false)
    drag(center, 'dragleave', [])

    canSend.value = false
    drag(center, 'dragenter', [png])
    drag(center, 'dragover', [png])
    await pause(0)
    expect(drops()).toHaveLength(0)
  })

  it('сторож: без нового dragover за 500 мс зоны снимаются сами', async() => {
    drag(center, 'dragenter', [png])
    drag(center, 'dragover', [png])
    await pause(0)
    expect(document.body.classList.contains('is-dragging')).toBe(true)
    await pause(550)
    expect(document.body.classList.contains('is-dragging')).toBe(false)
  })

  it('сброс на зону открывает попап медиа с видом вложения зоны', async() => {
    drag(center, 'dragenter', [png])
    drag(center, 'dragover', [png])
    await pause(0)
    const [asFile, asMedia] = drops()

    drag(asMedia, 'drop', [png])
    await pause(0)
    expect(newMedia.show).toHaveBeenLastCalledWith(im.chat, [png], 'media')
    expect(im.chat.input.willAttachType).toBe('media')

    await pause(300)
    drag(center, 'dragenter', [png])
    drag(center, 'dragover', [png])
    await pause(0)
    drag(drops()[0], 'drop', [png])
    await pause(0)
    expect(newMedia.show).toHaveBeenLastCalledWith(im.chat, [png], 'document')
    expect(asFile.isConnected).toBe(false)
  })

  it('сброс на строку чатлиста открывает её чат и шлёт туда файлы', async() => {
    const row = document.createElement('a')
    row.classList.add('chatlist-chat')
    row.dataset.peerId = '77'
    document.body.append(row)

    drag(row, 'dragenter', [png])
    drag(row, 'dragover', [png])
    await pause(0)
    expect(row.classList.contains('is-dragover')).toBe(true)

    drag(row, 'drop', [png])
    await pause(20)
    expect(im.chat.peerId).toBe(77)
    expect(newMedia.show).toHaveBeenCalledWith(im.chat, [png], 'media')
    expect(row.classList.contains('is-dragover')).toBe(false)
    row.remove()
  })
})

describe('вставка из буфера (tweb :3052-3125)', () => {
  it('картинка — попап «как медиа», документ — «файлом», без файлов — ничего', async() => {
    paste([png])
    await pause(0)
    expect(newMedia.show).toHaveBeenLastCalledWith(im.chat, [png], 'media')

    paste([pdf])
    await pause(0)
    expect(newMedia.show).toHaveBeenLastCalledWith(im.chat, [pdf], 'document')

    newMedia.show.mockClear()
    paste([])
    await pause(0)
    expect(newMedia.show).not.toHaveBeenCalled()
  })

  it('без права на медиа — ничего; открытый попап — файлы дописываются в него', async() => {
    canSend.value = false
    paste([png])
    await pause(0)
    expect(newMedia.show).not.toHaveBeenCalled()

    const addFiles = vi.fn()
    newMedia.current = { addFiles }
    paste([pdf])
    await pause(0)
    expect(addFiles).toHaveBeenCalledWith([pdf])
    expect(newMedia.show).not.toHaveBeenCalled()
  })
})
