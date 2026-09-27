// Пины `components/searchWebPageRow.solid.tsx` — порт tweb `components/searchWebPageRow.tsx`
// (812502980): строка вкладки «Ссылки» shared media на Solid `Row`. Сценарий — tweb
// `src/tests/rowTsxController.test.tsx:261-290`; вызов из `appSearchSuper.ts` пинят
// `appSearchSuper.links.test.ts`.
import { afterEach, describe, expect, it } from 'vitest'
import { getMiddleware } from '@helpers/middleware'
import { ANCHOR_ACTION_ATTRIBUTE } from '@lib/richtext/url'
import { renderSearchWebPageRow } from './searchWebPageRow.solid'

afterEach(() => document.body.replaceChildren())

describe('renderSearchWebPageRow', () => {
  it('ссылка: `a` с адресом, действием и уходом в новую вкладку; внешнее превью — медиа `big`', () => {
    const middleware = getMiddleware()
    const media = document.createElement('div')
    media.textContent = 'Preview'
    const row = renderSearchWebPageRow({
      title: 'Title',
      titleRight: '12:00',
      subtitle: 'Subtitle',
      media,
      link: {
        href: 'https://example.com/path',
        action: 'showMaskedAlert',
        targetBlank: true,
      },
      middleware: middleware.get(),
    }) as HTMLAnchorElement

    expect(row).toBeInstanceOf(HTMLAnchorElement)
    expect(row.href).toBe('https://example.com/path')
    expect(row.getAttribute(ANCHOR_ACTION_ATTRIBUTE)).toBe('showMaskedAlert')
    expect(row.target).toBe('_blank')
    expect(row.rel).toBe('noopener noreferrer')
    // `clickable havePadding noRipple` (tweb `:40-42`)
    for(const cls of ['row', 'row-with-padding', 'row-clickable', 'hover-effect']) {
      expect(row.classList.contains(cls), cls).toBe(true)
    }
    expect(row.classList.contains('rp')).toBe(false)
    expect(row.querySelector('.row-title-row > .row-title')?.textContent).toBe('Title')
    expect(row.querySelector('.row-title-row > .row-title-right')?.textContent).toBe('12:00')
    expect(row.querySelector('.row-subtitle')?.textContent).toBe('Subtitle')
    expect(media.classList.contains('row-media')).toBe(true)
    expect(media.classList.contains('row-media-big')).toBe(true)
    expect(media.parentElement).toBe(row)
    // HEAD `rowTsx.tsx:247-257`: заголовок → подпись → медиа
    expect(Array.from(row.children).map((c) => c.className.split(' ')[0])).toEqual(['row-row', 'row-subtitle', 'row-media'])

    middleware.clean()
    // корень снят вместе с middleware (`wrapSolidComponent`): классы части ушли с превью
    expect(media.classList.contains('row-media')).toBe(false)
  })

  it('без ссылки строка — `div` без адреса и действия (tweb `:39`)', () => {
    const row = renderSearchWebPageRow({
      title: 'Title',
      titleRight: '12:00',
      subtitle: 'Subtitle',
      media: document.createElement('div'),
      middleware: getMiddleware().get(),
    })

    expect(row.tagName).toBe('DIV')
    expect(row.hasAttribute('href')).toBe(false)
    expect(row.hasAttribute(ANCHOR_ACTION_ATTRIBUTE)).toBe(false)
  })
})
