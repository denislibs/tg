// Тесты message-варианта вьювера `AppMediaViewer` (порт tweb
// `mediaViewer/index.ts`, Task 14): раскладка соседей в listLoader, листание
// prev/next через onJump (fromRight ±1), hide на краях, caption-остров RichText,
// видимость/действия кнопок forward/delete по колбэкам, close→jumpToMessage,
// download через downloadMediaURL, префетч listLoader.loadMore, ⋮-меню.
// Среда — как base.open.test.ts: happy-dom + fake timers, RPC managers замокан.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import AppMediaViewer, { type AppMediaViewerOptions, type ViewerItem } from './appMediaViewer'

const { downloadMediaURL, meta } = vi.hoisted(() => ({
  downloadMediaURL: vi.fn<(id: number) => Promise<string>>(),
  meta: vi.fn<(id: number) => Promise<{ fileName: string }>>(),
}))

// RPC-мост вкладки — фейк (реальный SharedWorker в happy-dom не поднять)
vi.mock('@/client/bootstrap', () => ({
  startClient: () => ({ managers: { media: { downloadMediaURL, meta } } }),
}))

// blur грузит Image из data:-URI — в happy-dom onload не гарантирован
vi.mock('@helpers/blur', () => ({
  default: vi.fn(() => {
    const canvas = document.createElement('canvas')
    canvas.className = 'canvas-thumbnail'
    return { canvas, promise: Promise.resolve() }
  }),
}))

// Публикатор protected-полей (штатный способ — сабкласс, как в base.test.ts).
class TestViewer extends AppMediaViewer {
  /** цель ПОСЛЕДНЕГО закрытия — close() тут же чистит listLoader.current
   * (reset), поэтому перецел onDelete проверяется по аргументу полёта */
  public lastCloseTarget: HTMLElement | undefined

  protected override setMoverToTarget(target: HTMLElement | undefined, closing = false, fromRight = 0) {
    if (closing) this.lastCloseTarget = target
    return super.setMoverToTarget(target, closing, fromRight)
  }

  get whole() { return this.wholeDiv }
  get ll() { return this.listLoader }
  get buttonsMap() { return this.buttons }
  get contentMap() { return this.content }
  get captionScroll() { return this.captionScrollable }
  get authorMap() { return this.author }
  get targetPub() { return this.target }
  get menu() {
    return {
      toggle: this.btnMenuToggle,
      forward: this.btnMenuForward,
      download: this.btnMenuDownload,
      delete: this.btnMenuDelete,
    }
  }
}

const item = (mid: number, over: Partial<ViewerItem> = {}): ViewerItem => ({
  element: null, // сосед вне вьюпорта (tweb processItem: element null)
  mid,
  media: { mediaId: mid, width: 800, height: 600, kind: 'photo', blurPreview: 'AAAA' },
  author: { peerId: mid, name: 'Алиса', date: 'вчера' },
  ...over,
})

function makeViewer(opts: AppMediaViewerOptions = {}) {
  return new TestViewer(opts)
}

beforeEach(() => {
  vi.useFakeTimers()
  Object.defineProperty(HTMLImageElement.prototype, 'decode', {
    configurable: true,
    writable: true,
    value: () => Promise.resolve(),
  })
  downloadMediaURL.mockReset()
  downloadMediaURL.mockResolvedValue('blob:full')
  meta.mockReset()
  meta.mockResolvedValue({ fileName: 'photo.jpg' })
})

afterEach(() => {
  vi.useRealTimers()
  document.body.replaceChildren()
})

// Полный доезд открытия: doubleRaf + страховочный таймер (200/350 + 100) + fastRaf.
async function settleOpen(p: Promise<void> | undefined) {
  await vi.advanceTimersByTimeAsync(800)
  await p
}

describe('openMedia: раскладка соседей в listLoader (tweb :420-487)', () => {
  it('первый вызов кладёт prev = items до index, next = после; текущий — в target', async () => {
    const v = makeViewer()
    const items = [item(1), item(2), item(3), item(4)]
    const p = v.openMedia({ items, index: 1 })

    expect(v.ll.previous.map((t) => t.mid)).toEqual([1])
    expect(v.ll.next.map((t) => t.mid)).toEqual([3, 4])
    expect(v.ll.reverse).toBe(false)
    expect(v.targetPub?.mid).toBe(2)
    expect(v.targetPub?.item).toBe(items[1])

    // оба свитчера видимы — соседи есть с обеих сторон
    expect(v.buttonsMap.prev.classList.contains('hide')).toBe(false)
    expect(v.buttonsMap.next.classList.contains('hide')).toBe(false)
    await settleOpen(p)
  })

  it('на краю списка соответствующий свитчер получает hide', async () => {
    const v = makeViewer()
    const p = v.openMedia({ items: [item(1), item(2)], index: 1 })
    expect(v.buttonsMap.next.classList.contains('hide')).toBe(true)
    expect(v.buttonsMap.prev.classList.contains('hide')).toBe(false)
    await settleOpen(p)
  })
})

describe('листание: onJump → openMedia соседа (tweb index.ts:204-220)', () => {
  it('клик next зовёт openMedia соседа с fromRight=1; prev — с fromRight=-1', async () => {
    const v = makeViewer()
    const p = v.openMedia({ items: [item(1), item(2), item(3)], index: 1 })
    await settleOpen(p)

    const spy = vi.spyOn(v, 'openMedia')
    v.buttonsMap.next.click()
    expect(spy).toHaveBeenCalledTimes(1)
    const nextArgs = spy.mock.calls[0][0]
    expect(nextArgs.fromRight).toBe(1)
    expect(nextArgs.items[nextArgs.index].mid).toBe(3)
    expect(v.targetPub?.mid).toBe(3)
    await settleOpen(spy.mock.results[0].value as Promise<void>)

    v.buttonsMap.prev.click()
    expect(spy).toHaveBeenCalledTimes(2)
    const prevArgs = spy.mock.calls[1][0]
    expect(prevArgs.fromRight).toBe(-1)
    expect(prevArgs.items[prevArgs.index].mid).toBe(2)
    await settleOpen(spy.mock.results[1].value as Promise<void>)
  })
})

describe('caption: RichText-остров (tweb setCaption :304-356)', () => {
  it('непустая подпись — рендер в scrollable, hide снят; листание к пустой — hide', async () => {
    const v = makeViewer()
    const p = v.openMedia({
      items: [item(1, { caption: 'привет мир' }), item(2)],
      index: 0,
    })
    expect(v.captionScroll.textContent).toContain('привет мир')
    expect(v.contentMap.caption.classList.contains('hide')).toBe(false)
    await settleOpen(p)

    // сосед без подписи → контейнер прячется (tweb :354 toggle hide)
    v.buttonsMap.next.click()
    expect(v.contentMap.caption.classList.contains('hide')).toBe(true)
    expect(v.captionScroll.textContent).toBe('')
    await vi.advanceTimersByTimeAsync(800)
  })
})

describe('forward/delete: видимость и действия по колбэкам (адаптация :396-418)', () => {
  it('без колбэков кнопки и пункты меню несут hide', () => {
    const v = makeViewer()
    expect(v.buttonsMap.forward.classList.contains('hide')).toBe(true)
    expect(v.buttonsMap.delete.classList.contains('hide')).toBe(true)
    expect(v.menu.forward.classList.contains('hide')).toBe(true)
    expect(v.menu.delete.classList.contains('hide')).toBe(true)
    // download — всегда доступен
    expect(v.buttonsMap.download.classList.contains('hide')).toBe(false)
    expect(v.menu.download.classList.contains('hide')).toBe(false)
  })

  it('с колбэками — видимы и кликабельны: приходит mid текущего медиа', async () => {
    const onForward = vi.fn()
    const onDelete = vi.fn()
    const v = makeViewer({ onForward, onDelete })
    expect(v.buttonsMap.forward.classList.contains('hide')).toBe(false)
    expect(v.buttonsMap.delete.classList.contains('hide')).toBe(false)

    const p = v.openMedia({ items: [item(5)], index: 0 })
    await settleOpen(p)

    v.buttonsMap.forward.click()
    expect(onForward).toHaveBeenCalledTimes(1)
    expect(onForward.mock.calls[0][0]).toBe(5)

    v.buttonsMap.delete.click()
    expect(onDelete).toHaveBeenCalledTimes(1)
    expect(onDelete.mock.calls[0][0]).toBe(5)
  })

  it('closeFromMedia из onDelete перецеливает close в отцентрованное медиа и закрывает', async () => {
    const onDelete = vi.fn()
    const v = makeViewer({ onDelete })
    const p = v.openMedia({ items: [item(5)], index: 0 })
    await settleOpen(p)
    expect(document.body.contains(v.whole)).toBe(true)

    v.buttonsMap.delete.click()
    const closeFromMedia = onDelete.mock.calls[0][1] as () => void
    closeFromMedia()
    // tweb :250: target перецелен в content.media — полёт «в никуда» (opacity)
    expect(v.lastCloseTarget).toBe(v.contentMap.media)
    await vi.advanceTimersByTimeAsync(800)
    expect(document.body.contains(v.whole)).toBe(false)
  })
})

describe('клик по автору: close → jumpToMessage(item) (tweb index.ts:268-290)', () => {
  it('jumpToMessage зовётся с item ПОСЛЕ реального закрытия (вьювер уже снят с DOM)', async () => {
    const jumpToMessage = vi.fn((_item: ViewerItem) => {
      // порядок load-bearing: сначала close() доехал (wholeDiv снят), потом jump
      expect(document.body.contains(v.whole)).toBe(false)
    })
    const v = makeViewer({ jumpToMessage })
    const p = v.openMedia({ items: [item(9, { seq: 90 })], index: 0 })
    await settleOpen(p)

    v.authorMap.container.click()
    expect(jumpToMessage).not.toHaveBeenCalled() // закрытие ещё летит

    await vi.advanceTimersByTimeAsync(800)
    expect(jumpToMessage).toHaveBeenCalledTimes(1)
    // item целиком: вызывающему нужен seq (jump ленты ходит по seq)
    expect(jumpToMessage.mock.calls[0][0].mid).toBe(9)
    expect(jumpToMessage.mock.calls[0][0].seq).toBe(90)
  })

  it('без jumpToMessage клик по автору вьювер не закрывает', async () => {
    const v = makeViewer()
    const p = v.openMedia({ items: [item(9)], index: 0 })
    await settleOpen(p)
    v.authorMap.container.click()
    await vi.advanceTimersByTimeAsync(800)
    expect(document.body.contains(v.whole)).toBe(true)
  })
})

describe('download: существующая механика downloadMediaURL + <a download>', () => {
  it('клик по download зовёт downloadMediaURL(mediaId) и кликает <a download=fileName>', async () => {
    const v = makeViewer()
    const p = v.openMedia({ items: [item(7)], index: 0 })
    await settleOpen(p)
    downloadMediaURL.mockClear() // открытие само качало полноразмер

    let downloadAttr = ''
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      downloadAttr = this.download
    })
    v.buttonsMap.download.click()
    await vi.advanceTimersByTimeAsync(50)

    expect(downloadMediaURL).toHaveBeenCalledWith(7)
    expect(clickSpy).toHaveBeenCalledTimes(1)
    expect(downloadAttr).toBe('photo.jpg')
    clickSpy.mockRestore()
  })
})

describe('пагинация: listLoader.loadMore → opts.loadMoreMedia', () => {
  it('префетч после открытия (next < 10) зовёт loadMoreMedia(older=true) и дозаполняет next', async () => {
    const loadMoreMedia = vi.fn(async (_older: boolean, _anchor: ViewerItem | undefined, _loadCount: number) => [item(100)])
    const v = makeViewer({ loadMoreMedia })
    const p = v.openMedia({ items: [item(1), item(2)], index: 0 })
    await settleOpen(p)
    await vi.advanceTimersByTimeAsync(50)

    expect(loadMoreMedia).toHaveBeenCalledTimes(1)
    // anchor — последний из next (reverse=false, tweb listLoader :153)
    expect(loadMoreMedia.mock.calls[0][0]).toBe(true)
    expect((loadMoreMedia.mock.calls[0][1] as ViewerItem).mid).toBe(2)
    expect(loadMoreMedia.mock.calls[0][2]).toBe(50)
    expect(v.ll.next.map((t) => t.mid)).toEqual([2, 100])
  })

  it('без колбэка — пустой ответ короче loadCount ⇒ loadedAll, повторный load не ходит', async () => {
    const v = makeViewer()
    const p = v.openMedia({ items: [item(1), item(2)], index: 0 })
    await settleOpen(p)
    await vi.advanceTimersByTimeAsync(50)
    // next остался как был — дозагрузки нет и края помечены
    expect(v.ll.next.map((t) => t.mid)).toEqual([2])
    await v.ll.load(true) // resolved сразу (loadedAllDown)
    expect(v.ll.next.map((t) => t.mid)).toEqual([2])
  })
})

describe('мобильное ⋮-меню (порт base :970-973 + минимальный btn-menu)', () => {
  it('кнопка more.only-handhelds в топбаре, пункты [forward, download, delete(.danger)]', () => {
    const v = makeViewer()
    const toggle = v.menu.toggle
    expect(toggle.matches('button.btn-icon.only-handhelds.btn-menu-toggle')).toBe(true)
    expect(toggle.parentElement!.classList.contains('media-viewer-topbar')).toBe(true)
    const menu = toggle.querySelector('.btn-menu.bottom-left')!
    expect(menu).not.toBeNull()
    expect([...menu.children]).toEqual([v.menu.forward, v.menu.download, v.menu.delete])
    expect(v.menu.delete.classList.contains('danger')).toBe(true)
    for (const el of menu.children) {
      expect(el.matches('.btn-menu-item.rp-overflow')).toBe(true)
      expect(el.querySelector('.btn-menu-item-icon')).not.toBeNull()
      expect(el.querySelector('.btn-menu-item-text')).not.toBeNull()
    }
  })

  it('клик по toggle открывает (active/was-open + menu-open), повторный — закрывает', () => {
    const v = makeViewer()
    const toggle = v.menu.toggle
    const menu = toggle.querySelector('.btn-menu')!
    toggle.click()
    expect(menu.classList.contains('active')).toBe(true)
    expect(menu.classList.contains('was-open')).toBe(true)
    expect(toggle.classList.contains('menu-open')).toBe(true)
    toggle.click()
    expect(menu.classList.contains('active')).toBe(false)
    expect(toggle.classList.contains('menu-open')).toBe(false)
  })

  it('пункт меню зовёт действие и закрывает меню', async () => {
    const onForward = vi.fn()
    const v = makeViewer({ onForward })
    const p = v.openMedia({ items: [item(3)], index: 0 })
    await settleOpen(p)
    const toggle = v.menu.toggle
    toggle.click()
    v.menu.forward.click()
    expect(onForward).toHaveBeenCalledTimes(1)
    expect(onForward.mock.calls[0][0]).toBe(3)
    expect(toggle.querySelector('.btn-menu')!.classList.contains('active')).toBe(false)
  })
})
