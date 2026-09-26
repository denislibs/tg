/** @jsxImportSource solid-js */
/**
 * Порт tweb `sidebarLeft/tabs/passcodeLock/inlineSelect.tsx` (812502980) —
 * выпадающий выбор в `Row.RightContent` (код-пароль, горячие клавиши, срок
 * жизни сессий). Обвязка теста — как у потребителя tweb
 * (`passcodeLock/mainTab.tsx:283-294`): `onChange` пишет значение, закрытие —
 * `onClose` от оверлея, куда щелчок по пункту всплывает.
 *
 * Анимации входа/выхода идут через Web Animations (`element.animate`), которых
 * в happy-dom нет: подставлена заглушка с уже завершённым `finished`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createSignal } from 'solid-js'
import { render } from 'solid-js/web'
import InlineSelect from './inlineSelect.solid'
import styles from './inlineSelect.module.scss'

let dispose: (() => void) | undefined

beforeEach(() => {
  Element.prototype.animate = vi.fn(() => ({ finished: Promise.resolve() }) as unknown as Animation)
})

afterEach(() => {
  dispose?.()
  dispose = undefined
  document.body.replaceChildren()
  delete (Element.prototype as { animate?: unknown }).animate
})

const OPTIONS = [
  { value: 60, label: () => '1 min' },
  { value: 300, label: () => '5 min' },
  { value: 3600, label: () => '1 hour' },
]

function mount() {
  const [value, setValue] = createSignal(300)
  const [isOpen, setIsOpen] = createSignal(false)
  const onChange = vi.fn((v: number) => setValue(v))
  const parent = document.createElement('div')
  document.body.append(parent)
  dispose = render(() => (
    <InlineSelect
      value={value()}
      onClose={() => setIsOpen(false)}
      options={OPTIONS}
      onChange={onChange}
      isOpen={isOpen()}
      parent={parent}
    />
  ), parent)
  return { value, isOpen, setIsOpen, onChange, parent }
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))
const overlay = () => document.querySelector(`.${styles.Overlay}`) as HTMLElement | null

describe('InlineSelect', () => {
  it('закрытый: в строке — подпись текущего значения, списка нет', () => {
    const { parent } = mount()

    const valueEl = parent.querySelector(`.${styles.Value}`)!
    expect(valueEl.textContent).toBe('5 min')
    expect(overlay()).toBeNull()
  })

  it('открытый: список в портале, текущий пункт выбран и в фокусе', async() => {
    const { setIsOpen } = mount()

    setIsOpen(true)
    await flush()

    const list = overlay()!.querySelector('[role="listbox"]')!
    expect(list.classList.contains(styles.Select)).toBe(true)
    const options = [...list.querySelectorAll<HTMLElement>('[role="option"]')]
    expect(options.map((o) => o.textContent)).toEqual(['1 min', '5 min', '1 hour'])
    expect(options.map((o) => o.getAttribute('aria-selected'))).toEqual(['false', 'true', 'false'])
    expect(options[1].classList.contains(styles.selected)).toBe(true)
    expect(document.activeElement).toBe(options[1])
  })

  it('выбор пункта меняет значение и закрывает меню', async() => {
    const { setIsOpen, onChange, isOpen, parent } = mount()
    setIsOpen(true)
    await flush()

    const hour = [...overlay()!.querySelectorAll<HTMLElement>('[role="option"]')][2]
    hour.click()
    await flush()

    expect(onChange).toHaveBeenCalledOnce()
    expect(onChange.mock.calls[0][0]).toBe(3600)
    expect(isOpen()).toBe(false)
    expect(parent.querySelector(`.${styles.Value}`)!.textContent).toBe('1 hour')
    expect(overlay()).toBeNull()
  })

  it('Escape и изменение размера окна закрывают открытое меню', async() => {
    const { setIsOpen, isOpen } = mount()
    setIsOpen(true)
    await flush()

    overlay()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(isOpen()).toBe(false)

    setIsOpen(true)
    await flush()
    window.dispatchEvent(new Event('resize'))
    expect(isOpen()).toBe(false)
  })
})
