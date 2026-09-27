/** @jsxImportSource solid-js */
/**
 * Пины оболочки попапов — порт tweb `components/popups/indexTsx.tsx` (812502980),
 * см. шапку `indexTsx.solid.tsx`. Настоящие `appNavigationController`,
 * `overlayCounter`, `focusTrap` и `scrollable2`; фейковые таймеры двигают и
 * `doubleRaf` показа (два кадра), и `setTimeout(0)` клавиатуры, и 250 мс выхода.
 * Пины — на результат: дерево и классы, запись навигации, счётчик, фокус.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Замер скролла троттлится `setTimeout(24)` при оверлейном скролле и rAF без него;
// фиксируем оверлейную ветку, как `scrollable2.solid.test.tsx`.
vi.mock('@environment/overlayScrollSupport', () => ({
  IS_OVERLAY_SCROLL_SUPPORTED: () => true,
}))

// Живые корни `createPopup`: снят ли Solid-корень попапа, видно только по его `dispose`
// (DoD 5 — «после закрытия Solid-корень снят»). Обёртка считает корни, которые ещё не сняты.
const liveRoots = new Set<() => void>()
vi.mock('solid-js', async(importOriginal) => {
  const solid = await importOriginal<typeof import('solid-js')>()
  return {
    ...solid,
    createRoot: <T,>(fn: (dispose: () => void) => T, owner?: Parameters<typeof solid.createRoot>[1]) => solid.createRoot((dispose) => {
      const tracked = () => {
        liveRoots.delete(tracked)
        dispose()
      }
      liveRoots.add(tracked)
      return fn(tracked)
    }, owner),
  }
})

const { createSignal } = await import('solid-js')
const { default: PopupElement, createPopup, usePopupContext } = await import('./indexTsx.solid')
const { default: overlayCounter } = await import('@helpers/overlayCounter')
const { default: appNavigationController } = await import('@core/navigation/appNavigationController')
const { setAppWindow } = await import('@helpers/appWindow')

// doubleRaf показа — два кадра по 16 мс, за ними `setTimeout(0)` клавиатуры и ловушки
const frames = () => vi.advanceTimersByTimeAsync(40)
const afterHide = () => vi.advanceTimersByTimeAsync(250)

const escape = () => {
  const e = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
  window.dispatchEvent(e)
  return e
}

const keydown = (target: HTMLElement, key: string, init: KeyboardEventInit = {}) => {
  const e = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init })
  target.dispatchEvent(e)
  return e
}

const click = (target: HTMLElement) => target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
const mousedown = (target: HTMLElement) => target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))

const popupNavItem = () => appNavigationController.findItemByType('popup')?.item

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(async() => {
  // Модульный стек POPUPS, записи навигации и счётчик переживают тест, если попап не закрыть.
  // Сперва дать показаться: destroy() непоказанного снял бы счётчик, которого не ставил.
  await frames()
  PopupElement.POPUPS.slice().forEach((popup) => popup.destroy())
  await vi.advanceTimersByTimeAsync(300)
  vi.useRealTimers()
  document.body.replaceChildren()
})

describe('PopupElement: дерево и показ (indexTsx.tsx:408-464)', () => {
  it('1. разметка, a11y-атрибуты, `active` — только после двух кадров', async() => {
    createPopup(() => (
      <PopupElement class="x" closable>
        <PopupElement.Header>
          <PopupElement.CloseButton />
          <PopupElement.Title title="AppName" />
        </PopupElement.Header>
        <PopupElement.Body>b</PopupElement.Body>
      </PopupElement>
    ))

    const popup = document.body.querySelector<HTMLElement>('.popup.x')!
    expect(popup).not.toBeNull()
    // Portal кладёт свою обёртку прямо в body
    expect(popup.parentElement!.parentElement).toBe(document.body)
    expect(popup.classList.contains('active')).toBe(false)

    expect(popup.children).toHaveLength(1)
    const container = popup.children[0] as HTMLElement
    expect([...container.classList]).toEqual(['popup-container', 'z-depth-1'])
    expect(container.getAttribute('role')).toBe('dialog')
    expect(container.getAttribute('aria-modal')).toBe('true')
    expect(container.getAttribute('tabindex')).toBe('-1')

    expect([...container.children].map((el) => el.className)).toEqual(['popup-header', 'popup-body'])
    const header = container.children[0] as HTMLElement
    expect([...header.children].map((el) => el.className)).toEqual(['btn-icon popup-close', 'popup-title'])
    expect(header.children[0].tagName).toBe('BUTTON')
    expect(header.children[0].getAttribute('aria-label')).toBe('Close')
    expect(header.children[1].textContent).toBe('Telegram')
    expect(container.children[1].textContent).toBe('b')

    await frames()
    expect(popup.classList.contains('active')).toBe(true)
  })

  it('монтируется в body активного окна, снятого при создании (indexTsx.tsx:157, :410)', async() => {
    const fakeDocument = document.implementation.createHTMLDocument('pip')
    // окно — EventTarget: на смену окна за ним переезжают Esc навигации и Enter попапа
    const fakeWindow = Object.assign(new EventTarget(), { document: fakeDocument }) as unknown as Window
    setAppWindow(fakeWindow)
    try {
      createPopup(() => <PopupElement class="pip"><PopupElement.Body>b</PopupElement.Body></PopupElement>)
    } finally {
      setAppWindow(window)
    }

    expect(fakeDocument.body.querySelector('.popup.pip')).not.toBeNull()
    expect(document.body.querySelector('.popup.pip')).toBeNull()
  })

  it('9. show={s()}: пока false — без `active`; true — показ', async() => {
    const [shown, setShown] = createSignal(false)
    createPopup(() => <PopupElement class="reactive" show={shown()}><PopupElement.Body>b</PopupElement.Body></PopupElement>)
    const popup = document.body.querySelector<HTMLElement>('.popup.reactive')!

    await frames()
    expect(popup.classList.contains('active')).toBe(false)
    expect(popupNavItem()).toBeUndefined()

    setShown(true)
    await frames()
    expect(popup.classList.contains('active')).toBe(true)
    expect(popupNavItem()).toBeDefined()
  })

  it('8. withoutOverlay: `no-overlay`, без `aria-modal`, счётчик оверлеев не тронут', async() => {
    createPopup(() => <PopupElement class="light" withoutOverlay><PopupElement.Body>b</PopupElement.Body></PopupElement>)
    await frames()

    const popup = document.body.querySelector<HTMLElement>('.popup.light')!
    expect(popup.classList.contains('no-overlay')).toBe(true)
    expect(popup.classList.contains('active')).toBe(true)
    expect(popup.querySelector('.popup-container')!.hasAttribute('aria-modal')).toBe(false)
    expect(overlayCounter.isOverlayActive).toBe(false)
  })

  it('расширение zIndex (О-3 2C): инлайн `z-index` у `.popup`', async() => {
    createPopup(() => <PopupElement class="above" zIndex={4300}><PopupElement.Body>b</PopupElement.Body></PopupElement>)

    expect(document.body.querySelector<HTMLElement>('.popup.above')!.style.zIndex).toBe('4300')
  })
})

describe('PopupElement: закрытие (indexTsx.tsx:180-314, :422-442)', () => {
  it('2. Esc: `hiding` сразу, через 250 мс узла, записи и счётчика нет; onClose — сразу, onCloseAfterTimeout — после', async() => {
    const onClose = vi.fn()
    const onCloseAfterTimeout = vi.fn()
    createPopup(() => (
      <PopupElement class="esc" onClose={onClose} onCloseAfterTimeout={onCloseAfterTimeout}>
        <PopupElement.Body>b</PopupElement.Body>
      </PopupElement>
    ))
    await frames()
    const popup = document.body.querySelector<HTMLElement>('.popup.esc')!
    expect(overlayCounter.isOverlayActive).toBe(true)
    expect(popupNavItem()).toBeDefined()

    expect(escape().defaultPrevented).toBe(true)
    expect(popup.classList.contains('hiding')).toBe(true)
    expect(popup.classList.contains('active')).toBe(false)
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(onCloseAfterTimeout).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(249)
    expect(popup.isConnected).toBe(true)
    await vi.advanceTimersByTimeAsync(1)
    expect(document.body.querySelector('.popup')).toBeNull()
    expect(overlayCounter.isOverlayActive).toBe(false)
    expect(popupNavItem()).toBeUndefined()
    expect(PopupElement.POPUPS).toHaveLength(0)
    expect(liveRoots.size).toBe(0)
    expect(onCloseAfterTimeout).toHaveBeenCalledTimes(1)
  })

  it('3. клик по подложке закрывает; mousedown в контейнере + click по подложке — нет', async() => {
    createPopup(() => <PopupElement class="outside"><PopupElement.Body>b</PopupElement.Body></PopupElement>)
    await frames()
    const popup = document.body.querySelector<HTMLElement>('.popup.outside')!
    const body = popup.querySelector<HTMLElement>('.popup-body')!

    click(body)
    expect(popup.classList.contains('hiding')).toBe(false)

    // выделяли текст в попапе и отпустили кнопку над подложкой
    mousedown(body)
    click(popup)
    expect(popup.classList.contains('hiding')).toBe(false)

    mousedown(popup)
    click(popup)
    expect(popup.classList.contains('hiding')).toBe(true)
  })

  it('3. closable={false}: клик по подложке не закрывает, Esc — закрывает', async() => {
    createPopup(() => <PopupElement class="sticky" closable={false}><PopupElement.Body>b</PopupElement.Body></PopupElement>)
    await frames()
    const popup = document.body.querySelector<HTMLElement>('.popup.sticky')!

    mousedown(popup)
    click(popup)
    expect(popup.classList.contains('hiding')).toBe(false)

    escape()
    expect(popup.classList.contains('hiding')).toBe(true)
  })

  it('4. isConfirmationNeededOnClose: Esc не закрывает, резолв — закрывает', async() => {
    let confirm!: () => void
    const isConfirmationNeededOnClose = vi.fn(() => new Promise<void>((resolve) => { confirm = resolve }))
    createPopup(() => (
      <PopupElement class="confirm-close" isConfirmationNeededOnClose={isConfirmationNeededOnClose}>
        <PopupElement.Body>b</PopupElement.Body>
      </PopupElement>
    ))
    await frames()
    const popup = document.body.querySelector<HTMLElement>('.popup.confirm-close')!

    escape()
    expect(isConfirmationNeededOnClose).toHaveBeenCalledTimes(1)
    expect(popup.classList.contains('hiding')).toBe(false)
    expect(popupNavItem()).toBeDefined()

    confirm()
    await vi.advanceTimersByTimeAsync(0)
    expect(popup.classList.contains('hiding')).toBe(true)
    await afterHide()
    expect(popup.isConnected).toBe(false)
    expect(popupNavItem()).toBeUndefined()
  })
})

describe('PopupElement: Enter и кнопки (indexTsx.tsx:237-258, :700-799)', () => {
  it('5. Enter жмёт `Button confirm` только верхнего попапа; на кнопке отмены — отмену; в поле — подтверждение', async() => {
    const lowerConfirm = vi.fn(() => false as const)
    const upperConfirm = vi.fn(() => false as const)
    const upperCancel = vi.fn(() => false as const)
    createPopup(() => (
      <PopupElement class="lower">
        <PopupElement.Buttons><PopupElement.Button langKey="OK" confirm callback={lowerConfirm} /></PopupElement.Buttons>
      </PopupElement>
    ))
    createPopup(() => (
      <PopupElement class="upper">
        <PopupElement.Body><input class="field" /></PopupElement.Body>
        <PopupElement.Buttons>
          <PopupElement.Button langKey="Cancel" cancel callback={upperCancel} />
          <PopupElement.Button langKey="OK" confirm callback={upperConfirm} />
        </PopupElement.Buttons>
      </PopupElement>
    ))
    await frames()
    const upper = document.body.querySelector<HTMLElement>('.popup.upper')!

    const input = upper.querySelector<HTMLInputElement>('.field')!
    input.focus()
    expect(keydown(input, 'Enter').defaultPrevented).toBe(true)
    expect(upperConfirm).toHaveBeenCalledTimes(1)
    expect(lowerConfirm).not.toHaveBeenCalled()

    // нативная кнопка сама отвечает за Enter — подтверждение её не перебивает
    const cancel = upper.querySelectorAll<HTMLButtonElement>('.popup-button')[0]
    cancel.focus()
    expect(keydown(cancel, 'Enter').defaultPrevented).toBe(false)
    expect(upperConfirm).toHaveBeenCalledTimes(1)
    expect(lowerConfirm).not.toHaveBeenCalled()
  })

  it('6. колбэк-промис: пока висит — `disabled`; reject — снова активна, попап открыт; resolve — закрыт', async() => {
    const pending: { resolve: () => void, reject: (err: Error) => void }[] = []
    const callback = () => new Promise<void>((resolve, reject) => { pending.push({ resolve, reject }) })
    vi.spyOn(console, 'log').mockImplementation(() => {})
    createPopup(() => (
      <PopupElement class="async">
        <PopupElement.Buttons><PopupElement.Button langKey="OK" callback={callback} /></PopupElement.Buttons>
      </PopupElement>
    ))
    await frames()
    const popup = document.body.querySelector<HTMLElement>('.popup.async')!
    const button = popup.querySelector<HTMLButtonElement>('.popup-button.btn.primary')!

    click(button)
    expect(button.disabled).toBe(true)
    pending[0].reject(new Error('network'))
    await vi.advanceTimersByTimeAsync(0)
    expect(button.disabled).toBe(false)
    expect(popup.classList.contains('hiding')).toBe(false)

    click(button)
    expect(button.disabled).toBe(true)
    pending[1].resolve()
    await vi.advanceTimersByTimeAsync(0)
    expect(popup.classList.contains('hiding')).toBe(true)
  })
})

describe('PopupElement: фокус (indexTsx.tsx:180-235, :279)', () => {
  it('7. фокус внутри, Tab по кругу, `aria-labelledby` → заголовок; закрыли — фокус на открывшем', async() => {
    const opener = document.createElement('button')
    opener.textContent = 'X'
    document.body.append(opener)
    opener.focus()

    createPopup(() => (
      <PopupElement class="focus">
        <PopupElement.Header>
          <PopupElement.CloseButton />
          <PopupElement.Title title="AppName" />
        </PopupElement.Header>
        <PopupElement.Buttons>
          <PopupElement.Button langKey="Cancel" cancel />
          <PopupElement.Button langKey="OK" />
        </PopupElement.Buttons>
      </PopupElement>
    ))
    await frames()
    const container = document.body.querySelector<HTMLElement>('.popup.focus .popup-container')!
    const close = container.querySelector<HTMLElement>('.popup-close')!
    const buttons = container.querySelectorAll<HTMLElement>('.popup-button')

    expect(document.activeElement).toBe(close)
    const title = container.querySelector<HTMLElement>('.popup-title')!
    expect(title.id).not.toBe('')
    expect(container.getAttribute('aria-labelledby')).toBe(title.id)

    buttons[1].focus()
    expect(keydown(buttons[1], 'Tab').defaultPrevented).toBe(true)
    expect(document.activeElement).toBe(close)

    click(close)
    expect(document.activeElement).toBe(opener)
  })
})

describe('PopupElement: стыки скролла с шапкой и футером (indexTsx.tsx:574-665)', () => {
  it('10. шапка + скролл + футер в потоке: верхняя рамка у скролла, футер затеняется, пока скролл не у низа', async() => {
    createPopup(() => (
      <PopupElement class="flow">
        <PopupElement.Header><PopupElement.Title title="AppName" /></PopupElement.Header>
        <PopupElement.Scrollable><div class="long">x</div></PopupElement.Scrollable>
        <PopupElement.Footer><PopupElement.FooterButton langKey="OK" /></PopupElement.Footer>
      </PopupElement>
    ))
    const popup = document.body.querySelector<HTMLElement>('.popup.flow')!
    const scrollable = popup.querySelector<HTMLDivElement>('.scrollable')!
    // контент вдвое выше скролла, скролл — у верха
    Object.defineProperty(scrollable, 'scrollHeight', { value: 1000, configurable: true })
    Object.defineProperty(scrollable, 'clientHeight', { value: 500, configurable: true })
    Object.defineProperty(scrollable, 'offsetHeight', { value: 500, configurable: true })
    await frames()
    await frames() // пересчёт концов после показа (doubleRaf, :394-401)

    expect(scrollable.classList.contains('popup-scrollable')).toBe(true)
    expect(scrollable.classList.contains('scrollable-y-bordered-top')).toBe(true)
    expect(scrollable.classList.contains('scrollable-y-bordered-bottom')).toBe(false)
    const footer = popup.querySelector<HTMLElement>('.popup-footer')!
    expect(footer.classList.contains('popup-footer-shaded')).toBe(true)
    expect(footer.classList.contains('scrolled-end')).toBe(false)
    expect(footer.querySelector('.popup-footer-button.btn-primary.btn-color-primary')).not.toBeNull()

    scrollable.scrollTop = 500
    scrollable.dispatchEvent(new Event('scroll'))
    await vi.advanceTimersByTimeAsync(24)
    expect(footer.classList.contains('scrolled-end')).toBe(true)
  })

  it('10. плавающий футер: `popup-footer-floating`, футера в потоке нет', async() => {
    let hasFlowFooter: boolean | undefined
    const Probe = () => {
      const context = usePopupContext()!
      queueMicrotask(() => { hasFlowFooter = context.hasFlowFooter })
      return null
    }
    createPopup(() => (
      <PopupElement class="floating">
        <PopupElement.Scrollable><Probe /></PopupElement.Scrollable>
        <PopupElement.Footer floating><PopupElement.FooterButton langKey="OK" /></PopupElement.Footer>
      </PopupElement>
    ))
    await frames()

    const footer = document.body.querySelector<HTMLElement>('.popup.floating .popup-footer')!
    expect(footer.classList.contains('popup-footer-floating')).toBe(true)
    expect(footer.classList.contains('popup-footer-shaded')).toBe(false)
    expect(hasFlowFooter).toBe(false)
  })
})

describe('PopupElement: стек и сдерживание (indexTsx.tsx:365-368, :818-822, :836-842)', () => {
  it('11. getPopups(kind) видит открытый попап, после закрытия — нет', async() => {
    const KIND = Symbol('test-kind')
    createPopup(() => <PopupElement class="kind" kind={KIND}><PopupElement.Body>b</PopupElement.Body></PopupElement>)
    createPopup(() => <PopupElement class="other"><PopupElement.Body>b</PopupElement.Body></PopupElement>)
    await frames()

    const found = PopupElement.getPopups(KIND)
    expect(found).toHaveLength(1)
    expect(found[0].element).toBe(document.body.querySelector('.popup.kind'))

    found[0].hide()
    await afterHide()
    expect(PopupElement.getPopups(KIND)).toHaveLength(0)
  })

  it('12. содержимое бросает: соседний попап жив, запись навигации и счётчик упавшего сняты (расхождение 1)', async() => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    createPopup(() => <PopupElement class="alive"><PopupElement.Body>b</PopupElement.Body></PopupElement>)
    const [broken, setBroken] = createSignal(false)
    const Content = () => <>{(() => {
      if(broken()) throw new Error('boom')
      return 'fine'
    })()}</>
    createPopup(() => <PopupElement class="broken"><PopupElement.Body><Content /></PopupElement.Body></PopupElement>)
    await frames()
    expect(overlayCounter.overlaysActive).toBe(2)

    expect(() => setBroken(true)).not.toThrow()
    await vi.advanceTimersByTimeAsync(0)

    expect(document.body.querySelector('.popup.broken')).toBeNull()
    const alive = document.body.querySelector<HTMLElement>('.popup.alive')!
    expect(alive.classList.contains('active')).toBe(true)
    expect(PopupElement.POPUPS.map((popup) => popup.element)).toEqual([alive])
    expect(popupNavItem()).toBe(PopupElement.POPUPS[0].navigationItem)
    expect(overlayCounter.overlaysActive).toBe(1)
    expect(liveRoots.size).toBe(1) // корень упавшего снят, жив только соседний

    escape()
    await afterHide()
    expect(popupNavItem()).toBeUndefined()
    expect(overlayCounter.isOverlayActive).toBe(false)
  })

  it('12. содержимое бросает на первом рендере: createPopup не бросает, показ не наступает', async() => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const Boom = (): null => {
      throw new Error('boom')
    }

    expect(() => createPopup(() => <PopupElement class="dead"><Boom /></PopupElement>)).not.toThrow()
    await frames()

    expect(document.body.querySelector('.popup.dead')).toBeNull()
    expect(PopupElement.POPUPS).toHaveLength(0)
    expect(popupNavItem()).toBeUndefined()
    expect(overlayCounter.isOverlayActive).toBe(false)
    expect(liveRoots.size).toBe(0)
  })
})
