// Карточка превью ссылки. Держит три решения, взятые из tweb, — все три у нас
// раньше были сделаны иначе и это было видно глазом:
//   • картинка ПОД текстом, а не над ним (bubbles.ts:8341 — position
//     'bottom', 'top' только для квадратной/invert_media);
//   • квадратная картинка — врезка 48px ПЕРЕД текстом (bubbles.ts:8188-8202);
//   • футер «Мгновенный просмотр» — только когда статья реально извлекается
//     (bubbles.ts:7990, `if(webPage.cached_page)`), а не на каждой ссылке.
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { WebPagePreview } from './richBubbles'
import type { MyPhoto, WebPage } from '../../../core/media/messageMedia'

// Медиа-конвейер и RPC-менеджеры к предмету теста отношения не имеют:
// картинка нужна как факт наличия узла, а не как байты.
vi.mock('../../../core/hooks/useMediaUrl', () => ({
  useMediaUrl: (id: number | null) => (id ? `blob:media-${id}` : ''),
}))
vi.mock('../../../core/hooks/useManagers', () => ({ useManagers: () => ({ iv: { article: vi.fn() } }) }))
vi.mock('../useBlurThumb', () => ({ useBlurThumb: () => ({ current: null }) }))

afterEach(cleanup)

const base: WebPage = {
  _: 'webPage',
  url: 'https://example.com/post',
  display_url: 'example.com/post',
  site_name: 'Example',
  title: 'Заголовок',
  description: 'Строка один\nСтрока два',
}

/** Картинка карточки — ОБЫЧНАЯ лестница ступеней, та же, что у фотографии
 *  сообщения: россыпи `photo_w`/`photo_h` рядом с карточкой больше нет. */
const photo = (id: number, w: number, h: number): MyPhoto => ({
  _: 'photo', id,
  sizes: [{ _: 'photoSize', type: 'w', w, h, size: 0 }],
})

function renderCard(wp: Partial<WebPage>) {
  const { container } = render(<WebPagePreview wp={{ ...base, ...wp }} />)
  return container.querySelector('.webpage-content')!
}

/**
 * Позиция узла среди детей `.webpage-content`. Сравниваем ИМЕННО пару
 * «картинка ↔ текст», а не весь список: список зависит ещё и от футера, и
 * тогда правка кнопки красила бы тесты про порядок картинки — с сообщением не
 * о том (проверено: так и было в первом заходе).
 */
function indexOf(content: Element, selector: string) {
  return [...content.children].findIndex((c) => c.matches(selector))
}

describe('WebPagePreview', () => {
  it('обычная картинка идёт ПОД текстом', () => {
    const content = renderCard({ photo: photo(42, 1280, 720) })

    expect(indexOf(content, '.webpage-preview-resizer')).toBeGreaterThan(indexOf(content, '.webpage-text'))
  })

  it('квадратная картинка — врезка ПЕРЕД текстом', () => {
    const content = renderCard({ photo: photo(42, 320, 320) })

    expect(indexOf(content, '.webpage-preview-resizer')).toBeLessThan(indexOf(content, '.webpage-name'))
    expect(content.closest('.webpage')!.classList.contains('has-square-photo')).toBe(true)
  })

  it('вертикальная картинка помечается своим классом и остаётся снизу', () => {
    const content = renderCard({ photo: photo(42, 400, 900) })

    expect(indexOf(content, '.webpage-preview-resizer')).toBeGreaterThan(indexOf(content, '.webpage-text'))
    expect(content.closest('.webpage')!.classList.contains('has-vertical-photo')).toBe(true)
  })

  it('без картинки узла картинки нет вовсе', () => {
    const content = renderCard({})

    expect(content.querySelector('.webpage-preview-resizer')).toBeNull()
  })

  it('картинка едет своим media_id, а не чужим адресом', () => {
    const content = renderCard({ photo: photo(42, 1280, 720) })

    expect(content.querySelector('img')!.getAttribute('src')).toBe('blob:media-42')
  })

  it('кнопки Instant View нет, пока сервер не подтвердил статью', () => {
    const content = renderCard({})

    expect(content.querySelector('.webpage-footer')).toBeNull()
  })

  it('кнопка Instant View появляется по флагу сервера', () => {
    const content = renderCard({ has_iv: true })

    expect(content.querySelector('.webpage-footer')).not.toBeNull()
  })

  it('переносы строк описания доезжают до DOM (рисует их pre-wrap из партиала)', () => {
    const content = renderCard({})

    expect(content.querySelector('.webpage-text')!.textContent).toBe('Строка один\nСтрока два')
  })
})
