/** @jsxImportSource solid-js */
/**
 * Тесты порта `buttonTsx.solid.tsx` — Solid-версии кнопки.
 *
 * Пины из брифа задачи (task-2-brief.md):
 *  1. Вариант icon (`Button.Icon`) и вариант text (`text`-проп на базовой
 *     `Button`) дают РАЗНУЮ разметку/классы — как в оригинале
 *     (tweb `buttonTsx.tsx:81-107`): у иконки — `btn-icon` + класс самого
 *     имени иконки + `tabIndex=-1` по умолчанию, у текста — span из ядра
 *     `i18n`, без `btn-icon`.
 *  2. Рипл вешается: узел получает класс `rp` и в нём появляется `.c-ripple`
 *     (`RippleElement` → `ripple(el, undefined, 'no')`), а `noRipple`
 *     гасит оба.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { render } from 'solid-js/web'
import Button from './buttonTsx.solid'

let dispose: (() => void) | undefined
let host: HTMLDivElement | undefined

function mount(component: () => unknown) {
  host = document.createElement('div')
  document.body.append(host)
  dispose = render(component as () => never, host)
  return host
}

afterEach(() => {
  dispose?.()
  host?.remove()
  dispose = undefined
  host = undefined
})

describe('buttonTsx: варианты icon/text — разная разметка', () => {
  it('текстовый вариант: тег button по умолчанию, подпись из i18n, без btn-icon', () => {
    const el = mount(() => <Button text="OK" />)
    const btn = el.querySelector('button')!

    expect(btn).not.toBeNull()
    expect(btn.classList.contains('btn-icon')).toBe(false)
    // Ядро i18n кладёт живой узел (см. section.solid.test.tsx — то же на заголовке карточки);
    // тут достаточно, что текст реально появился в DOM.
    expect(btn.textContent).not.toBe('')
  })

  it('Button.Icon: класс btn-icon + класс самой иконки, tabIndex=-1 по умолчанию', () => {
    const el = mount(() => <Button.Icon icon="close" />)
    const btn = el.querySelector('button')!

    expect(btn.classList.contains('btn-icon')).toBe(true)
    expect(btn.classList.contains('close')).toBe(true)
    expect(btn.tabIndex).toBe(-1)
    // Сама иконка — потомок с tgico+button-icon (IconTsx.solid)
    expect(btn.querySelector('.tgico.button-icon')).not.toBeNull()
  })

  it('базовая Button с icon/iconAfter кладёт обе иконки вокруг текста', () => {
    const el = mount(() => <Button icon="close" iconAfter="check" text="OK" />)
    const btn = el.querySelector('button')!
    const icons = btn.querySelectorAll('.tgico.button-icon')

    expect(icons.length).toBe(2)
    expect(btn.classList.contains('btn-icon')).toBe(false)
  })
})

describe('buttonTsx: рипл вешается', () => {
  it('по умолчанию — класс rp и узел .c-ripple присутствуют', () => {
    const el = mount(() => <Button text="OK" />)
    const btn = el.querySelector('button')!

    expect(btn.classList.contains('rp')).toBe(true)
    expect(btn.querySelector('.c-ripple')).not.toBeNull()
  })

  it('noRipple гасит и класс rp, и узел .c-ripple', () => {
    const el = mount(() => <Button text="OK" noRipple />)
    const btn = el.querySelector('button')!

    expect(btn.classList.contains('rp')).toBe(false)
    expect(btn.querySelector('.c-ripple')).toBeNull()
  })
})
