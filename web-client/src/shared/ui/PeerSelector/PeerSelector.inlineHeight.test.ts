// Пин раскладки хоста селектора (баг со стенда: экран «Участники» группы обрезался
// сразу под строкой «Добавить участников» — список 0 px, виден край карточки).
//
// `.selector` партиала tweb (`styles/tweb/_selector.scss`) — `height: 100%`, его
// `.selector-scrollable` — `position: absolute; inset: 0`: это раскладка для
// контейнера с ОПРЕДЕЛЁННОЙ высотой (у tweb — `.sidebar-content` вкладки или тело
// попапа). На экранах правой колонки наш хост стоит в прокручиваемом теле экрана
// после других секций, его высота — только `min-height`, и процентная высота
// `.selector` схлопывается в ноль. Поэтому вне попапа селектор идёт в потоке
// (растёт по содержимому, прокручивает тело экрана), а в попапе пересылки — как у
// tweb, с собственным скроллером. Пин — по скомпилированному модулю (sass оставляет
// `:global(...)` как есть, его снимает CSS Modules): happy-dom раскладку не считает.
import { beforeAll, describe, expect, it } from 'vitest'
import { join } from 'node:path'
import * as sass from 'sass'

let css: string

beforeAll(() => {
  css = sass.compile(join(__dirname, 'PeerSelector.module.scss'), {
    loadPaths: [join(__dirname, '..', '..', '..', 'styles')],
    silenceDeprecations: ['import', 'global-builtin', 'color-functions', 'legacy-js-api', 'slash-div'],
    quietDeps: true,
  }).css
})

const body = (selector: string) => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(?:^|\\n|\\})\\s*${escaped}\\s*\\{([^}]*)\\}`).exec(css)?.[1]
}

describe('PeerSelector — высота хоста', () => {
  it('вне попапа селектор и его скроллер в потоке: высота по содержимому', () => {
    expect(body('.host > :global(.selector)')).toMatch(/height:\s*auto/)
    const scroller = body('.host > :global(.selector) > :global(.selector-scrollable)')
    expect(scroller).toMatch(/position:\s*relative/)
    expect(scroller).toMatch(/inset:\s*auto/)
    expect(scroller).toMatch(/overflow:\s*visible/)
  })

  it('в попапе пересылки — раскладка tweb: высоту даёт тело, прокручивает скроллер селектора', () => {
    expect(body(':global(.popup-forward) :global(.popup-body) > .host > :global(.selector)')).toMatch(/height:\s*100%/)
    const scroller = body(':global(.popup-forward) :global(.popup-body) > .host > :global(.selector) > :global(.selector-scrollable)')
    expect(scroller).toMatch(/position:\s*absolute/)
    expect(scroller).toMatch(/inset:\s*0/)
    expect(scroller).toMatch(/overflow-y:\s*auto/)
  })
})
