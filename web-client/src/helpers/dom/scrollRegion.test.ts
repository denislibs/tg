/**
 * Пины порта `helpers/dom/scrollRegion.ts` (tweb 472e3e76b). Потребитель — оболочка
 * попапов (`popups/indexTsx.tsx:587-607`): скролл получает вкладку фокуса, только
 * если до его содержимого иначе не дотянуться, и тогда он назван.
 */
import { describe, expect, it } from 'vitest'
import updateScrollRegionFocusable from './scrollRegion'

function region(html: string) {
  const container = document.createElement('div')
  container.innerHTML = html
  return container
}

describe('updateScrollRegionFocusable', () => {
  it('внутри есть кнопка → без tabindex/role/aria-label (снимает прежние)', () => {
    const container = region('<button>ok</button>')
    container.tabIndex = 0
    container.setAttribute('role', 'region')
    container.setAttribute('aria-label', 'old')

    updateScrollRegionFocusable(container, 'Title')

    expect(container.hasAttribute('tabindex')).toBe(false)
    expect(container.hasAttribute('role')).toBe(false)
    expect(container.hasAttribute('aria-label')).toBe(false)
  })

  it('только текст → tabindex=0, role=region, aria-label = переданное имя', () => {
    const container = region('<p>long text</p>')

    updateScrollRegionFocusable(container, 'Title')

    expect(container.getAttribute('tabindex')).toBe('0')
    expect(container.getAttribute('role')).toBe('region')
    expect(container.getAttribute('aria-label')).toBe('Title')
  })

  it('без имени — регион без aria-label; tabindex="-1" внутри не считается фокусируемым', () => {
    const container = region('<span tabindex="-1">x</span>')

    updateScrollRegionFocusable(container)

    expect(container.getAttribute('tabindex')).toBe('0')
    expect(container.getAttribute('role')).toBe('region')
    expect(container.hasAttribute('aria-label')).toBe(false)
  })
})
