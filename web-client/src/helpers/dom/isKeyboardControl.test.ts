/**
 * Пины порта `helpers/dom/isKeyboardControl.ts` (tweb 472e3e76b). Потребитель в
 * волне 2C — Enter-подтверждение оболочки попапов (`popups/indexTsx.tsx:249`):
 * Enter на нативном контроле жмёт сам контрол, а не «Подтвердить».
 */
import { describe, expect, it } from 'vitest'
import isKeyboardControl from './isKeyboardControl'

function el(html: string) {
  const host = document.createElement('div')
  host.innerHTML = html
  return host.firstElementChild as HTMLElement
}

describe('isKeyboardControl', () => {
  it.each([
    '<button>x</button>',
    '<a href="#">x</a>',
    '<div role="link">x</div>',
    '<div role="button">x</div>',
    '<input type="checkbox">',
    '<input type="radio">',
    '<select></select>',
  ])('%s → true', (html) => {
    expect(isKeyboardControl(el(html))).toBe(true)
  })

  it.each([
    '<input type="text">',
    '<textarea></textarea>',
    '<div>x</div>',
    '<a>без href</a>',
  ])('%s → false', (html) => {
    expect(isKeyboardControl(el(html))).toBe(false)
  })

  it('узел внутри кнопки — тоже контрол (closest)', () => {
    const button = el('<button><span class="i">x</span></button>')
    expect(isKeyboardControl(button.querySelector('.i') as HTMLElement)).toBe(true)
  })
})
