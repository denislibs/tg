/** @jsxImportSource solid-js */
/**
 * Порт tweb `src/components/tooltip.tsx` (812502980, 173 строки) — `showTooltip`:
 * всплывающая подсказка с «носиком» над/под якорем. Стили — `styles/tweb/_tooltip.scss`,
 * вырез носика — `#tooltip-notch-clip` спрайта `index.html`.
 *
 * Отличия от оригинала — только типовые (строгий tsconfig):
 *  • `containerRect`/`elementRect`/`mountRect` у tweb — `DOMRect | false` под `!relative`
 *    и читаются без проверки; здесь — `DOMRect | undefined` с тем же условием (в ветке
 *    `relative` `getStyle` не зовётся вовсе — `style` не ставится).
 *  • `style={!relative && getStyle()}` → `relative ? undefined : getStyle()`: Solid
 *    не принимает `false` в `style`.
 *  • `icon` — наш `IconName` (`@core/tgico-icons`), у tweb — ambient-тип `Icon`.
 *  • Выражения-операторы `a && b()` и голый `<Portal>` — `if`/`void` (oxlint
 *    `no-unused-expressions`), `ref={div}` — колбэком (`no-unassigned-vars`).
 */
import { createRoot, createSignal, onMount, type JSX } from 'solid-js'
import { Portal } from 'solid-js/web'
import clamp from '@helpers/number/clamp'
import OverlayClickHandler from '@helpers/overlayClickHandler'
import { getOverlayRoot } from '@helpers/appWindow'
import classNames from '@helpers/string/classNames'
import { IconTsx } from '@components/iconTsx.solid'
import { setTransition as SetTransition } from '@core/dom/setTransition'
import type { IconName } from '@core/tgico-icons'

const KEEP_TOOLTIP = true
const tooltipOverlayClickHandler = new OverlayClickHandler(undefined, true)
export default function showTooltip({
  element,
  class: className,
  container = element.parentElement!,
  vertical,
  textElement,
  subtitleElement,
  paddingX = 0,
  offsetY = 0,
  centerVertically,
  onClose,
  icon,
  auto,
  // Mount into the active window's body so a tooltip shown while the client is popped out renders in
  // the Document PiP window. Falls back to the main body when not popped out — same as before.
  mountOn = getOverlayRoot(),
  relative,
  absolute,
  lighter,
  rightElement,
  useOverlay = mountOn === getOverlayRoot(),
}: {
  element: HTMLElement,
  class?: string,
  container?: HTMLElement,
  vertical: 'top' | 'bottom',
  textElement?: HTMLElement | DocumentFragment,
  subtitleElement?: HTMLElement | DocumentFragment,
  rightElement?: JSX.Element,
  paddingX?: number,
  offsetY?: number,
  centerVertically?: boolean,
  onClose?: () => void,
  icon?: IconName,
  auto?: boolean,
  mountOn?: HTMLElement,
  relative?: boolean,
  // Position absolutely within `mountOn` (a positioned ancestor) instead of `fixed` to the viewport, so
  // the tooltip scrolls with its anchor and is clipped by the scroll container rather than floating over
  // fixed chrome (topbar). `mountOn` must be the offset parent (e.g. the bubble the tooltip anchors to).
  absolute?: boolean,
  lighter?: boolean, // When opening a tooltip in dark mode on a surface
  useOverlay?: boolean,
}) {
  const containerRect = !relative ? container.getBoundingClientRect() : undefined
  const elementRect = !relative ? element.getBoundingClientRect() : undefined
  const mountRect = absolute ? mountOn.getBoundingClientRect() : undefined

  let close!: () => void
  createRoot((dispose) => {
    const [getRect, setRect] = createSignal<DOMRect>()

    const getStyle = (): JSX.CSSProperties => {
      const css: JSX.CSSProperties = {
        'max-width': Math.min(containerRect!.width - paddingX * 2, 320) + 'px',
      }

      // when anchored inside `mountOn`, switch to absolute so the tooltip travels with the scroll
      if(absolute) css.position = 'absolute'

      const rect = getRect()
      if(!rect) {
        return css
      }

      // everything below is computed in viewport space, then shifted into `mountOn`'s frame for absolute mode
      const mountLeft = absolute ? mountRect!.left : 0
      const mountTop = absolute ? mountRect!.top : 0

      const cRect = containerRect!
      const eRect = elementRect!
      const minX = Math.min(cRect.left + paddingX, cRect.right)
      const maxX = Math.max(cRect.left, cRect.right - Math.min(cRect.width, rect.width) - paddingX)

      const centerX = eRect.left + (eRect.width - rect.width) / 2
      const left = clamp(centerX, minX, maxX)
      const verticalOffset = 12
      if(vertical === 'top') css.top = (centerVertically ? eRect.top + eRect.height / 2 : eRect.top) - rect.height - verticalOffset + offsetY - mountTop + 'px'
      else css.top = eRect.bottom + verticalOffset - mountTop + 'px'
      css.left = left - mountLeft + 'px'

      const notchCenterX = eRect.left + (eRect.width - 19) / 2
      css['--notch-offset'] = notchCenterX - left + 'px'

      return css
    }

    let div!: HTMLDivElement
    const tooltip = (
      <div
        ref={(el) => div = el}
        class={classNames('tooltip', 'tooltip-' + vertical, icon && 'tooltip-with-icon', className, lighter && 'tooltip-lighter')}
        style={relative ? undefined : getStyle()}
      >
        <div class="tooltip-part tooltip-background"></div>
        <span class="tooltip-part tooltip-notch"></span>
        <div class="tooltip-part tooltip-text">
          {icon && <IconTsx icon={icon} class="tooltip-icon" />}
          {subtitleElement ? (
            <>
              <div>{textElement}</div>
              <div class="tooltip-subtitle">{subtitleElement}</div>
            </>
          ) : textElement}
        </div>
        {rightElement && <div class="tooltip-part tooltip-right">{rightElement}</div>}
      </div>
    )

    void (
      <Portal mount={mountOn}>
        {tooltip}
      </Portal>
    )

    onMount(() => {
      if(!relative) setRect(div.getBoundingClientRect())
      div.classList.add('mounted')
      SetTransition({
        element: div,
        className: 'is-visible',
        duration: 200,
        useRafs: 2,
        forwards: true,
      })
    })

    let closed = false
    const onToggle = (open: boolean) => {
      if(open) {
        return
      }

      closed = true
      clearTimeout(timeout)
      SetTransition({
        element: div,
        className: 'is-visible',
        duration: 200,
        forwards: false,
        onTransitionEnd: () => {
          onClose?.()
          dispose()
        },
      })
    }

    close = () => {
      if(closed) {
        return
      }

      if(useOverlay) tooltipOverlayClickHandler.close()
      else onToggle(false)
    }

    const timeout = KEEP_TOOLTIP && !auto ? 0 : window.setTimeout(close, 3000)

    if(useOverlay) void Promise.resolve().then(() => {
      tooltipOverlayClickHandler.open(mountOn)
      tooltipOverlayClickHandler.addEventListener('toggle', onToggle, { once: true })
    })
  })

  return { close }
}
