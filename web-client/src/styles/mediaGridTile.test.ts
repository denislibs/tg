// Квадрат плитки медиа-грида shared media задаётся ТОЛЬКО стилем — и не
// партиалом `_searchSuper.scss` (там у `.grid-item` один `overflow: hidden`), а
// глобальным блоком `.grid { &-item { … &-media { … } } }` из tweb `base.scss`
// (`:1117-1161`). Без него плитка нулевой высоты, а `img.grid-item-media`,
// у которого `position: absolute` без размеров, вываливается во всю панель —
// ровно то, что показал стенд после того, как класс `AppSearchSuper` въехал в
// профиль (задача 13 плана shared media).
//
// Пины разметки (`components/appSearchSuper.media.test.ts`) сверяют классы и
// остаются зелёными без этого правила, поэтому здесь — НАСТОЯЩИЙ
// скомпилированный `styles/index.scss` поверх разметки плитки, как её строит
// `processPhotoVideoFilter`, тем же способом, что `styles/spoilerPlate.test.ts`.
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { join } from 'node:path'
import * as sass from 'sass'

let css: string

beforeAll(() => {
  css = sass.compile(join(__dirname, 'index.scss'), {
    loadPaths: [__dirname, join(__dirname, '..', '..', 'node_modules')],
    silenceDeprecations: ['import', 'global-builtin', 'color-functions', 'legacy-js-api', 'slash-div'],
    quietDeps: true,
  }).css
})

afterEach(() => {
  document.head.replaceChildren()
  document.body.replaceChildren()
})

/**
 * Плитка, как её собирает `appSearchSuper.ts::processPhotoVideoFilter` +
 * `wrapPhoto` (дамп tweb `07-right-sidebar.json`:
 * `div.grid-item.search-super-item.media-container.no-background > img.media-photo.grid-item-media`).
 */
function mountTile() {
  const style = document.createElement('style')
  style.textContent = css
  document.head.append(style)

  const content = document.createElement('div')
  content.className = 'search-super-content-container search-super-content-media'
  const grid = document.createElement('div')
  grid.className = 'search-super-content-media-grid'
  const tile = document.createElement('div')
  tile.className = 'grid-item media-container no-background search-super-item'
  const img = document.createElement('img')
  img.className = 'media-photo grid-item-media'
  tile.append(img)
  grid.append(tile)
  content.append(grid)
  document.body.append(content)
  return { tile, img }
}

describe('плитка медиа-грида shared media (tweb base.scss:1117-1161)', () => {
  it('плитка — квадрат через padding-bottom: высота ноль, отступ 100%, позиционирует детей', () => {
    const { tile } = mountTile()
    const cs = getComputedStyle(tile)

    expect(cs.height).toBe('0px')
    expect(cs.paddingBottom).toBe('100%')
    expect(cs.position).toBe('relative')
  })

  it('превью растянуто на всю плитку и обрезается по cover, а не вываливается натуральным размером', () => {
    const { img } = mountTile()
    const cs = getComputedStyle(img)

    expect(cs.position).toBe('absolute')
    expect(cs.width).toBe('100%')
    expect(cs.height).toBe('100%')
    expect(cs.objectFit).toBe('cover')
  })
})
