// Пункт меню «в работе» — tweb `_button.scss` (812502980, коммит 508acd4f5):
// `.btn-menu-item.is-loading` глохнет для кликов, глиф иконки прячется, а
// прелоадер `.btn-menu-item-preloader` (его ставит `setButtonMenuItemLoading`,
// `components/buttonMenu.ts`) занимает место иконки. Гоняется НАСТОЯЩИЙ
// скомпилированный `styles/index.scss` по разметке `ButtonMenuItem`.
import { beforeAll, describe, expect, it } from 'vitest'
import { join } from 'node:path'
import * as sass from 'sass'
import { ButtonMenuItem, setButtonMenuItemLoading, type ButtonMenuItemOptions } from '@components/buttonMenu'

let css: string

beforeAll(() => {
  css = sass.compile(join(__dirname, 'index.scss'), {
    loadPaths: [__dirname, join(__dirname, '..', '..', 'node_modules')],
    silenceDeprecations: ['import', 'global-builtin', 'color-functions', 'legacy-js-api', 'slash-div'],
    quietDeps: true,
  }).css
  const style = document.createElement('style')
  style.textContent = css
  document.head.append(style)
})

describe('пункт меню в состоянии загрузки (tweb _button.scss, 508acd4f5)', () => {
  it('is-loading гасит клики, прелоадер растянут на всю иконку', () => {
    const menu = document.createElement('div')
    menu.classList.add('btn-menu')
    const options: ButtonMenuItemOptions = { icon: 'copy', text: 'MediaViewer.Context.Copy', onClick: () => {} }
    menu.append(...ButtonMenuItem(options))
    document.body.append(menu)

    const item = options.element!
    expect(getComputedStyle(item).pointerEvents).not.toBe('none')

    setButtonMenuItemLoading(options, true)
    expect(getComputedStyle(item).pointerEvents).toBe('none')
    const preloader = item.querySelector<HTMLElement>('.btn-menu-item-icon > .btn-menu-item-preloader')!
    expect(getComputedStyle(preloader).width).toBe('100%')
    // глиф иконки (иконка — сам `.tgico`) уходит в ноль, чтобы не просвечивал
    expect(getComputedStyle(item.querySelector('.btn-menu-item-icon')!).fontSize).toBe('0px')

    setButtonMenuItemLoading(options, false)
    expect(getComputedStyle(item).pointerEvents).not.toBe('none')
    expect(item.querySelector('.btn-menu-item-preloader')).toBeNull()
  })
})
