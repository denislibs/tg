// Порт tweb `src/helpers/dom/attachListNavigation.ts` (812502980) — навигация
// стрелками/Enter по списку. Потребитель — поиск по чату
// (`components/chat/topbarSearch.tsx`). `attachPickerGrid` (сетки эмодзи/стикеров)
// не портирован: его потребители — эмодзи-дропдаун (Б-35, П-6).
import fastSmoothScroll from '@helpers/fastSmoothScroll'
import cancelEvent from '@helpers/dom/cancelEvent'
import { attachClickEvent } from '@helpers/dom/clickEvent'
import findUpAsChild from '@helpers/dom/findUpAsChild'
import findUpClassName from '@helpers/dom/findUpClassName'
import isKeyboardControl from '@helpers/dom/isKeyboardControl'

type ArrowKey = 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight'
const HANDLE_EVENT = 'keydown'
const ACTIVE_CLASS_NAME = 'active'

const AXIS_Y_KEYS: ArrowKey[] = ['ArrowUp', 'ArrowDown']
const AXIS_X_KEYS: ArrowKey[] = ['ArrowLeft', 'ArrowRight']
export type ListNavigationOptions = {
  list: HTMLElement,
  type: 'xy' | 'x' | 'y',
  onSelect: (target: Element) => void | boolean | Promise<boolean>,
  once?: boolean,
  waitForKey?: string[],
  activeClassName?: string,
  cancelMouseDown?: boolean,
  target?: Element,
  /** A real focusable picker grid, rather than autocomplete driven from an editor. */
  focusable?: boolean,
  itemSelector?: string
}

export default function attachListNavigation({
  list,
  type,
  onSelect,
  once,
  waitForKey,
  activeClassName = ACTIVE_CLASS_NAME,
  cancelMouseDown,
  target,
  focusable,
  itemSelector,
}: ListNavigationOptions) {
  let waitForKeySet = waitForKey?.length ? new Set(waitForKey) : undefined
  const keyNames = new Set<string>(type === 'xy' ? AXIS_Y_KEYS.concat(AXIS_X_KEYS) : (type === 'x' ? AXIS_X_KEYS : AXIS_Y_KEYS))

  const getItems = () => Array.from(list.children).filter((item) => !itemSelector || item.matches(itemSelector))
  const getCurrentTarget = () => {
    const items = getItems()
    return target && items.includes(target) ? target : items.find((item) => item.classList.contains(activeClassName)) || items[0]
  }

  const setCurrentTarget = (_target: Element | undefined, scrollTo: boolean) => {
    if(target === _target) {
      return
    }

    let hadTarget = false
    if(target) {
      hadTarget = true
      target.classList.remove(activeClassName)
      if(focusable) (target as HTMLElement).tabIndex = -1
      if(target.getAttribute('role') === 'option') {
        target.setAttribute('aria-selected', 'false')
      }
    }

    target = _target
    if(!target) return
    target.classList.add(activeClassName)
    if(focusable) {
      (target as HTMLElement).tabIndex = 0
      if(scrollTo) (target as HTMLElement).focus()
    }
    if(target.getAttribute('role') === 'option') {
      target.setAttribute('aria-selected', 'true')
    }

    if(hadTarget && scrollable && scrollTo) {
      void fastSmoothScroll({
        container: scrollable,
        element: target as HTMLElement,
        position: 'center',
        forceDuration: 100,
        axis: type === 'x' ? 'x' : 'y',
      })
    }
  }

  const getNextTargetX = (currentTarget: Element, isNext: boolean): Element => {
    const items = getItems()
    return items[(items.indexOf(currentTarget) + (isNext ? 1 : items.length - 1)) % items.length]
  }

  const getNextTargetY = (currentTarget: Element, isNext: boolean) => {
    const currentRect = currentTarget.getBoundingClientRect()

    let nextTarget = getNextTargetX(currentTarget, isNext)
    while(nextTarget !== currentTarget) {
      const targetRect = nextTarget.getBoundingClientRect()
      if(targetRect.x === currentRect.x && targetRect.y !== currentRect.y) {
        break
      }

      nextTarget = getNextTargetX(nextTarget, isNext)
    }

    return nextTarget
  }

  let handleArrowKey: (currentTarget: Element, key: ArrowKey) => Element
  if(type === 'xy') { // flex-direction: row; flex-wrap: wrap;
    handleArrowKey = (currentTarget, key) => {
      if(key === 'ArrowUp' || key === 'ArrowDown') return getNextTargetY(currentTarget, key === 'ArrowDown')
      else return getNextTargetX(currentTarget, key === 'ArrowRight')
    }
  } else { // flex-direction: row | column;
    handleArrowKey = (currentTarget, key) => getNextTargetX(currentTarget, key === 'ArrowRight' || key === 'ArrowDown')
  }

  let onKeyDown = (e: KeyboardEvent) => {
    if(e.defaultPrevented || e.isComposing || !getItems().length) return
    if(!focusable && isKeyboardControl(e.target as HTMLElement)) return
    if(focusable) {
      const focused = findUpAsChild(e.target as HTMLElement, list)
      if(!focused || !getItems().includes(focused)) return
      target = focused
      if(e.key === 'Home' || e.key === 'End') {
        cancelEvent(e)
        const items = getItems()
        setCurrentTarget(items[e.key === 'Home' ? 0 : items.length - 1], true)
        return
      }
    }
    const key = e.key
    if(!keyNames.has(key)) {
      if(key === 'Enter' || (focusable && key === ' ') || (!focusable && type !== 'xy' && key === 'Tab')) {
        cancelEvent(e)
        if(!e.repeat) void fireSelect(getCurrentTarget())
      }

      return
    }

    cancelEvent(e)

    if(list.childElementCount > 1) {
      let currentTarget = getCurrentTarget()
      currentTarget = handleArrowKey(currentTarget, key as ArrowKey)
      setCurrentTarget(currentTarget, true)
    }
  }

  const scrollable = findUpClassName(list, 'scrollable') as HTMLElement | null
  // Paints `.active` as the keyboard highlight — autocomplete only. A focusable grid highlights
  // with its own class and the focus ring, and its items may use `.active` for something else
  // (the selected theme tile).
  if(!focusable) list.classList.add('navigable-list')

  const onMouseMove = (e: MouseEvent) => {
    const target = findUpAsChild(e.target as HTMLElement, list)
    if(!target) {
      return
    }

    setCurrentTarget(target, false)
  }

  const onClick = (e: Event) => {
    cancelEvent(e) // cancel keyboard closening

    const target = findUpAsChild(e.target as HTMLElement, list)
    if(!target) {
      return
    }

    setCurrentTarget(target, false)
    void fireSelect(getCurrentTarget())
  }

  const fireSelect = async(target: Element) => {
    const canContinue = await onSelect(target)
    if(canContinue !== undefined ? !canContinue : once) {
      detach()
    }
  }

  let attached = false, attachedDocument: Document | undefined, detachClickEvent: (() => void) | undefined
  const attach = () => {
    if(attached) return
    attached = true
    attachedDocument = list.ownerDocument;
    (focusable ? list : attachedDocument).addEventListener(HANDLE_EVENT, onKeyDown as EventListener, { capture: true, passive: false })
    if(!focusable) list.addEventListener('mousemove', onMouseMove, { passive: true })
    if(cancelMouseDown) list.addEventListener('mousedown', cancelEvent)
    if(!focusable) detachClickEvent = attachClickEvent(list, onClick, { ignoreMove: cancelMouseDown })
  }

  const detach = () => {
    if(!attached) return
    attached = false;
    (focusable ? list : attachedDocument!).removeEventListener(HANDLE_EVENT, onKeyDown as EventListener, { capture: true })
    list.removeEventListener('mousemove', onMouseMove)
    if(cancelMouseDown) list.removeEventListener('mousedown', cancelEvent)
    detachClickEvent?.()
    detachClickEvent = undefined
  }

  const resetTarget = () => {
    if(waitForKeySet) return
    setCurrentTarget(getItems()[0], false)
  }

  if(waitForKeySet) {
    const _onKeyDown = onKeyDown
    onKeyDown = (e) => {
      if(e.defaultPrevented || isKeyboardControl(e.target as HTMLElement)) return
      if(waitForKeySet?.has(e.key)) {
        cancelEvent(e)

        attachedDocument!.removeEventListener(HANDLE_EVENT, onKeyDown as EventListener, { capture: true })
        onKeyDown = _onKeyDown
        attachedDocument!.addEventListener(HANDLE_EVENT, onKeyDown as EventListener, { capture: true, passive: false })

        waitForKeySet = undefined
        resetTarget()
      }
    }
  } else if(!target) {
    resetTarget()
  }

  attach()

  return {
    attach,
    detach,
    resetTarget,
  }
}
