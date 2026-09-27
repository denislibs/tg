/** @jsxImportSource solid-js */
/**
 * Порт tweb `components/passcodeLock/simplePopup.tsx` (812502980) — попап
 * подтверждения поверх экрана блокировки (классы `popup popup-peer
 * popup-confirmation` глобальных партиалов, свой `z-index` над экраном): заголовок,
 * описание, «опасная» кнопка и «Отмена» с автофокусом; Esc и щелчок мимо окна
 * закрывают. Базовый `PopupElement` здесь не годится и у оригинала: экран живёт
 * до старта приложения, без навигационного стека.
 *
 * Портал — в `getOverlayRoot()`, Esc — `bindActiveWindowListener` на документ
 * активного окна: в выносе клиента (Document PiP, `core/pip.ts`) попап и его
 * клавиша живут в окне выноса и переезжают вместе с ним.
 *
 * Расхождения с tweb:
 *  1. `Transition` — вендор `@vendor/solid-transition-group`, асинхронные
 *     `onEnter`/`onExit` отданы ему через `void` (как `inlineSelect.solid.tsx`).
 *  2. `keepMe(ripple)` → `void ripple`.
 */
import { type Component, createEffect, createSignal, createUniqueId, type JSX, onCleanup } from 'solid-js'
import { Portal } from 'solid-js/web'
import { Transition } from '@vendor/solid-transition-group'
import pause from '@helpers/schedulers/pause'
import { bindActiveWindowListener, getOverlayRoot } from '@helpers/appWindow'
import createFocusTrap from '@helpers/dom/focusTrap'
import { i18n } from '@lib/langPack'
import ripple from '@components/ripple'
import styles from './simplePopup.module.scss'

void ripple

const SimplePopup: Component<{
  visible?: boolean

  title: JSX.Element
  description: JSX.Element
  confirmButtonContent: JSX.Element

  onClose?: () => void
  onConfirm: () => void
}> = (props) => {
  const [container, setContainer] = createSignal<HTMLDivElement>()
  const titleId = createUniqueId()
  const descriptionId = createUniqueId()
  const root = getOverlayRoot()
  createEffect(() => {
    const element = container()
    if(!props.visible || !element) return
    const trap = createFocusTrap(element)
    trap.activate(undefined, element.querySelector<HTMLElement>('[autofocus]') ?? undefined)
    const listener = (e: KeyboardEvent) => {
      if(e.key === 'Escape' && !e.defaultPrevented) {
        e.preventDefault()
        props.onClose?.()
      }
    }
    const detach = bindActiveWindowListener((win) => win.document, 'keydown', listener)

    onCleanup(() => {
      detach()
      trap.deactivate()
    })
  })

  const onEnter = async(el: Element, done: () => void) => {
    await pause(0)
    el.classList.add('active')
    await pause(0)
    done()
  }

  const onExit = async(el: Element, done: () => void) => {
    el.classList.remove('active')
    await pause(200)
    done()
  }

  return (
    <Portal mount={root}>
      <Transition
        onEnter={(el, done) => void onEnter(el, done)}
        onExit={(el, done) => void onExit(el, done)}
      >
        {props.visible && <div
          class={'popup popup-peer popup-confirmation ' + styles.Popup}
          onClick={(e) => {
            if(e.target === e.currentTarget) {
              props.onClose?.()
            }
          }}
        >
          <div ref={setContainer} class="popup-container" role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={descriptionId} tabindex={-1}>
            <div class="popup-header">
              <div class="popup-title" id={titleId}>
                {props.title}
              </div>
            </div>

            <div class="popup-description" id={descriptionId}>
              {props.description}
            </div>

            <div class="popup-buttons">
              <button class="popup-button btn danger" use:ripple onClick={() => props.onConfirm()}>
                {props.confirmButtonContent}
              </button>
              <button class="popup-button btn primary" use:ripple onClick={() => props.onClose?.()} autofocus>
                {i18n('Cancel')}
              </button>
            </div>
          </div>
        </div>}
      </Transition>
    </Portal>
  )
}

export default SimplePopup
