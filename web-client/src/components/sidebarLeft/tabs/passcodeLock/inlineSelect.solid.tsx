/** @jsxImportSource solid-js */
/**
 * Порт tweb `src/components/sidebarLeft/tabs/passcodeLock/inlineSelect.tsx`
 * (812502980, 191 строка) — выпадающий выбор значения в `Row.RightContent`:
 * в строке — подпись текущего значения (`.Value`), по `isOpen` — список в
 * портале поверх всего (`.Overlay > .SelectClip > .Select[role=listbox]`),
 * раскрывающийся от выбранного пункта (clip-path, 400 мс). Щелчок по пункту
 * зовёт `onChange` и, всплыв до оверлея, `onClose`; Escape, уход курсора
 * дальше 100px и `resize` окна — тоже `onClose`. Потребители в плане 2D:
 * код-пароль (AutoLock), горячие клавиши, срок жизни сессий.
 *
 * Отличия от оригинала:
 *  1. `keepMe(ripple)` (`:11`) → `void ripple`: у нас директиву держит так же
 *     `emptySearchPlaceholder.solid.tsx` (oxlint `no-unused-expressions`).
 *  2. `Transition` — наш вендор `@vendor/solid-transition-group` (у tweb
 *     импорт `solid-transition-group` указывает на тот же вендор).
 *  3. Под наш strict и oxlint: реф `valueEl` — `!`; `selectEl()` в `toCheck`
 *     — приведением после проверки `every(Boolean)`; подпись значения —
 *     `value()?.()` (у tweb `value()()` бросило бы на значении вне списка);
 *     асинхронный `onExit` отдан `Transition` через `void` — поведение то же.
 */
import { type Component, createEffect, createMemo, createSelector, createSignal, For, type JSX, onCleanup, onMount } from 'solid-js'
import { Portal } from 'solid-js/web'
import { Transition } from '@vendor/solid-transition-group'
import { animateValue, simpleEasing } from '@helpers/animateValue'
import buttonKeyDown from '@helpers/solid/buttonKeyDown'
import ListenerSetter from '@helpers/listenerSetter'
import ripple from '@components/ripple'
import styles from '@components/sidebarLeft/tabs/passcodeLock/inlineSelect.module.scss'

void ripple

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- значение опции произвольное, как у tweb (`value: any`)
type OptionValue = any

const InlineSelect: Component<{
  isOpen?: boolean
  onClose?: () => void
  value: OptionValue
  onChange: (value: OptionValue) => void
  options: { value: OptionValue, label: () => JSX.Element }[]
  parent: HTMLElement
}> = (props) => {
  let valueEl!: HTMLDivElement

  const value = createMemo(() => props.options.find((option) => option.value === props.value)?.label)

  const [valueLabel, setValueLabel] = createSignal<JSX.Element>() // Doesn't work without intermediary signal
  createEffect(() => {
    setValueLabel(value()?.())
  })

  const isSelected = createSelector(() => props.value)

  const [selectEl, setSelectEl] = createSignal<HTMLDivElement>()

  onMount(() => {
    const listenerSetter = new ListenerSetter()
    listenerSetter.add(window)('resize', () => {
      if(props.isOpen) props.onClose?.()
    })

    onCleanup(() => {
      listenerSetter.removeAll()
    })
  })

  const onEnter = (el: Element, done: () => void) => {
    const selectEl = el.firstElementChild as HTMLElement
    const selectOptionEl = selectEl.querySelector(`.${styles.selected}`)

    if(!selectOptionEl || !selectEl) {
      // done();
      return
    }

    // Move focus to the currently-selected option so keyboard users can immediately
    // arrow/activate within the listbox and Escape closes it.
    ;(selectOptionEl as HTMLElement).focus({ preventScroll: true })

    const valueRect = valueEl.getBoundingClientRect()
    const selectRect = selectEl.getBoundingClientRect()
    const selectedOptionRect = selectOptionEl.getBoundingClientRect()

    const optionTop = selectedOptionRect.top - selectRect.top
    const optionBottom = optionTop + selectedOptionRect.height
    const distToOptionCenter = optionTop + selectedOptionRect.height / 2

    const x = valueRect.left + valueRect.width / 2
    let y = valueRect.top + valueRect.height / 2 - distToOptionCenter

    const isOverflowing = y + selectRect.height > window.innerHeight || y < 0

    if(isOverflowing) {
      y +=
        Math.max(0, -y) +
        Math.min(0, window.innerHeight - (y + selectRect.height))
    }

    selectEl.style.setProperty('--x', '' + x)
    selectEl.style.setProperty('--y', '' + y)

    void selectEl.animate({ opacity: [0, 1] }, { duration: 120 }).finished.then(() => {
      if(isOverflowing) done()
    })

    if(isOverflowing) return

    const maxDist = Math.max(optionTop, selectRect.height - optionBottom)
    const getPath = (dist: number) =>
      `polygon(0% ${optionTop - dist}px, 100% ${optionTop - dist}px, 100% ${optionBottom + dist}px, 0px ${optionBottom + dist}px)`

    animateValue(
      0,
      maxDist,
      400,
      (dist) => {
        selectEl.style.setProperty('clip-path', getPath(dist))
      },
      {
        easing: simpleEasing,
        onEnd: () => {
          selectEl.style.removeProperty('clip-path')
          done()
        },
      },
    )
  }

  const onExit = async(el: Element, done: () => void) => {
    const selectEl = el.firstElementChild as HTMLElement

    await selectEl.animate({ opacity: [1, 0] }, { duration: 120 }).finished

    done()
  }

  const onMouseMove = (e: MouseEvent) => {
    const toCheck = [props.parent, selectEl()]
    if(!toCheck.every(Boolean)) return

    const isOutside = (toCheck as HTMLElement[]).every((el) => {
      const rect = el.getBoundingClientRect()
      const max = Math.max(
        rect.left - e.clientX,
        e.clientX - rect.right,
        rect.top - e.clientY,
        e.clientY - rect.bottom,
      )

      return max > 100
    })

    if(isOutside) {
      props.onClose?.()
    }
  }

  return (
    <>
      <div ref={valueEl} class={styles.Value}>
        {valueLabel()}
      </div>

      <Portal>
        <Transition appear onEnter={onEnter} onExit={(el, done) => void onExit(el, done)}>
          {props.isOpen && (
            <div
              class={styles.Overlay}
              onClick={(e) => {
                e.stopPropagation()
                props.onClose?.()
              }}
              onKeyDown={(e) => {
                if(e.key === 'Escape') {
                  e.stopPropagation()
                  props.onClose?.()
                }
              }}
              onMouseMove={onMouseMove}
            >
              <div class={styles.SelectClip}>
                <div class={styles.Select} ref={setSelectEl} role="listbox">
                  <For each={props.options}>
                    {(option) => (
                      <div
                        use:ripple
                        class={styles.Option}
                        classList={{
                          [styles.selected]: isSelected(option.value),
                        }}
                        role="option"
                        tabindex="0"
                        aria-selected={isSelected(option.value)}
                        onClick={[props.onChange, option.value]}
                        onKeyDown={buttonKeyDown}
                      >
                        <span>{option.label()}</span>
                      </div>
                    )}
                  </For>
                </div>
              </div>
            </div>
          )}
        </Transition>
      </Portal>
    </>
  )
}

export default InlineSelect
