// Тесты каркаса vanilla-вьювера `AppMediaViewerBase` (порт tweb
// `mediaViewer/base.ts:318-445`). Пинится load-bearing порядок append детей
// `.media-viewer-whole` — на соседних селекторах партиала построены правила
// (`.zoom-container.is-visible ~ .media-viewer-caption`, `~ .media-viewer-movers`,
// tweb mediaViewer.scss:725,730), перестановка ломает CSS без единой ошибки JS.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import AppMediaViewerBase from './base'
import ListLoader from './listLoader'
import { glyph } from '@core/tgico-icons'

type Target = { element: HTMLElement }

// Публикатор protected-полей: тесты смотрят на реальное дерево и реальные
// методы, не копируя логику (сабкласс — штатный способ доступа, сам вьювер
// расширяется так же в Task 14).
class TestViewer extends AppMediaViewerBase<never, 'forward' | 'delete', Target> {
  get whole() { return this.wholeDiv }
  get topbarEl() { return this.topbar }
  get moversEl() { return this.moversContainer }
  get contentMap() { return this.content }
  get buttonsMap() { return this.buttons }
  get zoom() { return this.zoomElements }
  callToggleWholeActive(active: boolean) { this.toggleWholeActive(active) }
  callSetNewMover() { return this.setNewMover() }
  callMountToOverlay() { this.mountToOverlay() }
  callGetOverlayRoot() { return this.getOverlayRoot() }
}

function makeViewer(topButtons: ('forward' | 'delete')[] = []) {
  const listLoader = new ListLoader<Target, Target>({
    loadMore: async () => ({ count: 0, items: [] }),
  })
  return new TestViewer(listLoader, topButtons)
}

afterEach(() => {
  document.body.replaceChildren()
})

describe('AppMediaViewerBase: дерево конструктора (tweb base.ts:318-435)', () => {
  it('порядок детей wholeDiv ровно [zoom-container, overlays, topbar, movers]', () => {
    const v = makeViewer()
    const children = [...v.whole.children]
    expect(children.map((el) => el.classList[0])).toEqual([
      'zoom-container',
      'overlays',
      'media-viewer-topbar',
      'media-viewer-movers',
    ])
    expect(v.whole.classList.contains('media-viewer-whole')).toBe(true)
    expect(v.topbarEl.classList.contains('media-viewer-appear')).toBe(true)
  })

  it('overlays: .media-viewer > -content > -container > -media (layout-ghost)', () => {
    const v = makeViewer()
    const media = v.whole.querySelector(
      '.overlays > .media-viewer > .media-viewer-content > .media-viewer-container > .media-viewer-media',
    )
    expect(media).not.toBeNull()
    expect(v.contentMap.media).toBe(media)
    expect(v.contentMap.main.classList.contains('media-viewer-content')).toBe(true)
    expect(v.contentMap.container.classList.contains('media-viewer-container')).toBe(true)
  })

  it('topbar-left: mobile-close (btn-icon.only-handhelds) + author c right/name/date', () => {
    const v = makeViewer()
    const left = v.topbarEl.querySelector('.media-viewer-topbar-left')!
    expect(left).not.toBeNull()

    const mobileClose = left.children[0]
    expect(mobileClose).toBe(v.buttonsMap['mobile-close'])
    expect(mobileClose.matches('button.btn-icon.only-handhelds')).toBe(true)
    expect(mobileClose.querySelector('span.tgico.button-icon')!.textContent).toBe(glyph('close'))

    const author = left.children[1]
    expect(author.matches('.media-viewer-author.no-select')).toBe(true)
    const right = author.querySelector('.media-viewer-author-right')!
    expect([...right.children].map((el) => el.className)).toEqual([
      'media-viewer-name',
      'media-viewer-date',
    ])
  })

  it('кнопки топбара в порядке topButtons + [download, rotate, zoomin, close], rotate — глиф rotate_left', () => {
    const v = makeViewer(['delete', 'forward'])
    const buttonsDiv = v.topbarEl.querySelector('.media-viewer-buttons')!
    const glyphs = [...buttonsDiv.children].map(
      (el) => el.querySelector('span.tgico.button-icon')!.textContent,
    )
    expect(glyphs).toEqual([
      glyph('delete'),
      glyph('forward'),
      glyph('download'),
      glyph('rotate_left'),
      glyph('zoomin'),
      glyph('close'),
    ])
    // карта кнопок хранит их под исходными именами (rotate, не rotate_left)
    expect(v.buttonsMap.rotate).toBe(buttonsDiv.children[3])
    expect(v.buttonsMap.close).toBe(buttonsDiv.children[5])
    for (const el of buttonsDiv.children) {
      expect(el.matches('button.btn-icon')).toBe(true)
    }
  })

  it('zoom-container: [zoomout, progress-line (RangeSelector), zoomin]', () => {
    const v = makeViewer()
    const container = v.zoom.container
    expect([...container.children]).toEqual([
      v.zoom.btnOut,
      v.zoom.rangeSelector.container,
      v.zoom.btnIn,
    ])
    expect(v.zoom.btnOut.querySelector('span.tgico.button-icon')!.textContent).toBe(glyph('zoomout'))
    expect(v.zoom.btnIn.querySelector('span.tgico.button-icon')!.textContent).toBe(glyph('zoomin'))
    expect(v.zoom.rangeSelector.container.matches('.progress-line.with-transition')).toBe(true)
    // наполнение RangeSelector (tweb rangeSelector.ts:48-77)
    expect(v.zoom.rangeSelector.container.querySelector(':scope > .progress-line__filled')).not.toBeNull()
    const seek = v.zoom.rangeSelector.container.querySelector<HTMLInputElement>(':scope > input.progress-line__seek')!
    expect(seek.type).toBe('range')
    expect(seek.step).toBe('0.01')
    expect(seek.min).toBe('0.5')
    expect(seek.max).toBe('4')
  })

  it('movers: свитчеры left/right со span.tgico.media-viewer-sibling-button + стартовый mover-wrapper', () => {
    const v = makeViewer()
    const children = [...v.moversEl.children]
    expect(children[0]).toBe(v.buttonsMap.prev)
    expect(children[1]).toBe(v.buttonsMap.next)
    expect(children[0].className).toBe('media-viewer-switcher media-viewer-switcher-left')
    expect(children[1].className).toBe('media-viewer-switcher media-viewer-switcher-right')
    expect(
      children[0].querySelector('span.tgico.media-viewer-sibling-button.media-viewer-prev-button')!.textContent,
    ).toBe(glyph('previous'))
    expect(
      children[1].querySelector('span.tgico.media-viewer-sibling-button.media-viewer-next-button')!.textContent,
    ).toBe(glyph('next'))
    // конструктор tweb завершается setNewMover() — стартовый wrapper уже в дереве
    expect(children[2].className).toBe('media-viewer-mover-wrapper')
  })
})

describe('AppMediaViewerBase: setNewMover (tweb base.ts:1958-1980)', () => {
  it('создаёт wrapper > mover со стартовым cssText visibility:hidden; 1x1', () => {
    const v = makeViewer()
    const mover = v.callSetNewMover()
    const wrapper = mover.parentElement!
    expect(wrapper.className).toBe('media-viewer-mover-wrapper')
    expect(mover.className).toBe('media-viewer-mover')
    expect(mover.style.visibility).toBe('hidden')
    expect(mover.style.width).toBe('1px')
    expect(mover.style.height).toBe('1px')
    expect(v.contentMap.mover).toBe(mover)
  })

  it('новый wrapper встаёт рядом со старым (в moversContainer), старый не удаляется', () => {
    const v = makeViewer()
    const first = v.contentMap.mover
    const firstWrapper = first.parentElement!
    const second = v.callSetNewMover()
    expect(second).not.toBe(first)
    expect(second.parentElement!.parentElement).toBe(v.moversEl)
    // старый уезжает и удаляется анимацией навигации (Task 11), не здесь
    expect(firstWrapper.parentElement).toBe(v.moversEl)
    expect(v.moversEl.lastElementChild).toBe(second.parentElement)
  })
})

describe('AppMediaViewerBase: toggleWholeActive (tweb base.ts:1847-1856)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('true — ставит active', () => {
    const v = makeViewer()
    v.callToggleWholeActive(true)
    expect(v.whole.classList.contains('active')).toBe(true)
  })

  it('false — ставит backwards, а active снимает только по таймеру 0', () => {
    const v = makeViewer()
    v.callToggleWholeActive(true)
    v.callToggleWholeActive(false)
    // синхронно: backwards уже стоит, active ещё нет — CSS успевает увидеть
    // состояние «активен + задом наперёд» и запустить обратный переход
    expect(v.whole.classList.contains('backwards')).toBe(true)
    expect(v.whole.classList.contains('active')).toBe(true)
    vi.advanceTimersByTime(0)
    expect(v.whole.classList.contains('active')).toBe(false)
    expect(v.whole.classList.contains('backwards')).toBe(true)
  })
})

describe('AppMediaViewerBase: монтирование и destroy', () => {
  it('getOverlayRoot = document.body; mountToOverlay вешает wholeDiv один раз', () => {
    const v = makeViewer()
    expect(v.callGetOverlayRoot()).toBe(document.body)
    expect(v.whole.parentElement).toBeNull()
    v.callMountToOverlay()
    expect(v.whole.parentElement).toBe(document.body)
    v.callMountToOverlay()
    expect(document.querySelectorAll('.media-viewer-whole').length).toBe(1)
  })

  it('destroy снимает wholeDiv с DOM', () => {
    const v = makeViewer()
    v.callMountToOverlay()
    v.destroy()
    expect(v.whole.parentElement).toBeNull()
  })
})
