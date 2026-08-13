// Пункт меню обязан рождать ровно то дерево, что и tweb `ButtonMenuItem`
// (buttonMenu.ts:80-210) — иначе портированный `_button.scss` промахивается
// мимо разметки и правила молча не применяются.
//
// Тест держит четыре вещи, каждая из которых была отсебятиной до этой правки:
//   1. `rp-overflow` на пункте (в tweb безусловный, ripple вешается отдельно);
//   2. класс иконки НА САМОМ глифе, а не на обёртке-span — геометрия
//      `_button.scss:350-363` (`width/height: var(--icon-size)`, `align-self:
//      flex-start`, `margin-top: .125rem`) считается от него;
//   3. разметка пункта с подменю: подпись и шеврон ВНУТРИ `btn-menu-item-text`
//      (`createSubmenuTrigger.ts:70-77`), а не рядом с ним;
//   4. правый глиф-галочка несёт оба класса разом
//      (`buttonMenu.ts:209`: `Icon('next', 'btn-menu-item-icon', 'btn-menu-item-icon-right')`).
import { describe, it, expect, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import MenuItem from './MenuItem'

afterEach(cleanup)

const icon = <span className="tgico">g</span>

describe('MenuItem — дерево 1:1 с tweb ButtonMenuItem', () => {
  it('пункт несёт btn-menu-item и rp-overflow', () => {
    const { container } = render(<MenuItem icon={icon} label="Settings" />)
    const item = container.querySelector('.btn-menu-item')!

    expect(item).not.toBeNull()
    expect(item.classList.contains('rp-overflow')).toBe(true)
  })

  it('класс иконки лежит на самом глифе, без обёртки', () => {
    const { container } = render(<MenuItem icon={icon} label="Settings" />)
    const glyph = container.querySelector('.btn-menu-item-icon')!

    expect(glyph.tagName).toBe('SPAN')
    expect(glyph.classList.contains('tgico')).toBe(true)
    // обёртки быть не должно: иконка — прямой ребёнок пункта
    expect(glyph.parentElement!.classList.contains('btn-menu-item')).toBe(true)
  })

  it('подпись лежит в btn-menu-item-text', () => {
    const { container } = render(<MenuItem icon={icon} label="Settings" />)
    const text = container.querySelector('.btn-menu-item-text')!

    expect(text.textContent).toBe('Settings')
  })

  it('пункт с подменю: submenu-trigger + submenu-label внутри текста', () => {
    const { container } = render(<MenuItem icon={icon} label="More" submenu />)
    const item = container.querySelector('.btn-menu-item')!
    const label = container.querySelector('.submenu-label')!

    expect(item.classList.contains('submenu-trigger')).toBe(true)
    // label обязан лежать ВНУТРИ btn-menu-item-text (tweb кладёт его туда же)
    expect(label.closest('.btn-menu-item-text')).not.toBeNull()
    expect(label.querySelector('.submenu-label-text')!.textContent).toBe('More')
    // шеврон — последний ребёнок label, глиф tgico
    expect(label.lastElementChild!.classList.contains('tgico')).toBe(true)
  })

  it('правая галочка несёт btn-menu-item-icon и btn-menu-item-icon-right', () => {
    const { container } = render(
      <MenuItem icon={icon} label="Rate" right={<span className="tgico">v</span>} />,
    )
    const right = container.querySelector('.btn-menu-item-icon-right')!

    expect(right.classList.contains('btn-menu-item-icon')).toBe(true)
    expect(right.classList.contains('tgico')).toBe(true)
  })

  it('danger вешает класс на сам пункт', () => {
    const { container } = render(<MenuItem icon={icon} label="Log Out" danger />)

    expect(container.querySelector('.btn-menu-item')!.classList.contains('danger')).toBe(true)
  })
})
