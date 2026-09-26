/** @jsxImportSource solid-js */
// Тесты порта tweb `lib/solidjs/defineSolidElement.tsx` (см. шапку файла рядом).
//
// Главное, ради чего порт заведён, — жизненный цикл, привязанный к DOM: корень
// Solid живёт, пока узел в документе, и гаснет на `disconnectedCallback`. У
// потребителей (заглушка пустого поиска с lottie-уткой) другого сигнала на
// уборку нет: группа поиска снимает заглушку голым `remove()`.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { onCleanup } from 'solid-js'
import defineSolidElement, { type PassedProps } from './defineSolidElement.solid'

afterEach(() => {
  document.body.replaceChildren()
  vi.restoreAllMocks()
})

type Props = { label?: string, onClean?: () => void }

const Labeled = defineSolidElement({
  name: 'test-labeled',
  component: (props: PassedProps<Props>) => {
    onCleanup(() => props.onClean?.())
    return <b onClick={() => props.label = 'clicked'}>{props.label}</b>
  },
})

describe('defineSolidElement', () => {
  it('регистрирует настоящий custom element с тегом name', () => {
    const el = new Labeled()
    expect(el).toBeInstanceOf(HTMLElement)
    expect(el.tagName).toBe('TEST-LABELED')
    expect(customElements.get('test-labeled')).toBe(Labeled)
  })

  it('пропы кормятся до вставки, рендер — на вставке в документ (tweb :136-139, :164-170)', () => {
    const el = new Labeled()
    el.feedProps({ label: 'a' })
    expect(el.childElementCount).toBe(0)
    expect(el.props.label).toBe('a')
    expect(el.props.element).toBe(el)

    document.body.append(el)
    expect(el.querySelector('b')?.textContent).toBe('a')
  })

  it('props — изменяемый реактивный стор: запись снаружи перерисовывает, запись компонента видна снаружи', () => {
    const el = new Labeled()
    el.feedProps({ label: 'a' })
    document.body.append(el)

    el.props.label = 'b'
    expect(el.querySelector('b')?.textContent).toBe('b')

    el.feedProps({ label: 'c' })
    expect(el.querySelector('b')?.textContent).toBe('c')

    el.querySelector('b')!.click()
    expect(el.props.label).toBe('clicked')
    expect(el.querySelector('b')?.textContent).toBe('clicked')
  })

  it('снятие из документа гасит корень и чистит узел; пропы переживают, повторная вставка монтирует заново (tweb :145-152, :213-220)', () => {
    const onClean = vi.fn()
    const el = new Labeled()
    el.feedProps({ label: 'a', onClean })
    document.body.append(el)

    el.props.label = 'kept'
    el.remove()

    expect(onClean).toHaveBeenCalledTimes(1)
    expect(el.childElementCount).toBe(0)
    expect(el.props.label).toBe('kept')

    document.body.append(el)
    expect(el.querySelector('b')?.textContent).toBe('kept')
  })

  it('ошибка компонента сдерживается и логируется, а не роняет вставку (как у mountSolid)', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const Broken = defineSolidElement({
      name: 'test-broken',
      component: () => {
        throw new Error('boom')
      },
    })

    const el = new Broken()
    expect(() => document.body.append(el)).not.toThrow()
    expect(error).toHaveBeenCalled()
  })
})
