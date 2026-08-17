// prepareAlbum — раскладка медиагруппы в грид (порт tweb).
//
// Пиним то, ради чего функция и существует, а не то, что можно списать с любой
// разметки:
//   • раскладка СЧИТАЕТСЯ ПО РАЗМЕРАМ каждого элемента: две широких картинки
//     ложатся друг под друга, две узких — рядом. Это первое, что теряется при
//     «упрощении» (константный грид), и снаружи выглядит правдоподобно;
//   • геометрия уходит в DOM В ПРОЦЕНТАХ от бокса, а сам бокс — в пикселях:
//     контейнер можно ужать, и грид ужмётся вместе с ним;
//   • классы/вложенность 1:1 с живым DOM tweb (docs/tweb/dom/dumps/03-album-channel.json).
import { describe, expect, it } from 'vitest'
import prepareAlbum from './prepareAlbum'

// tweb wrapAlbum: maxWidth = mediaSizes.active.album.width, minWidth 100, spacing 1
const OPTS = { maxWidth: 420, minWidth: 100, spacing: 1 } as const

const pct = (v: string) => parseFloat(v)

function scene(items: { w: number; h: number }[], extra: Partial<Parameters<typeof prepareAlbum>[0]> = {}) {
  const container = document.createElement('div')
  const res = prepareAlbum({ container, items, ...OPTS, forMedia: true, ...extra })
  return { container, ...res, children: [...container.children] as HTMLElement[] }
}

const WIDE = { w: 1600, h: 900 }
const TALL = { w: 900, h: 1600 }

describe('prepareAlbum', () => {
  it('дерево и классы 1:1 с живым DOM tweb', () => {
    const { container, children } = scene([WIDE, WIDE])

    expect(container.style.width).toMatch(/^\d+px$/)
    expect(container.style.height).toMatch(/^\d+px$/)
    expect(children).toHaveLength(2)
    for (const div of children) {
      expect(div.classList.contains('album-item')).toBe(true)
      expect(div.classList.contains('grouped-item')).toBe(true)
      expect(div.firstElementChild!.className).toBe('album-item-media')
      // геометрия — в процентах от бокса, не в пикселях
      expect(div.style.width).toMatch(/%$/)
      expect(div.style.height).toMatch(/%$/)
      expect(div.style.top).toMatch(/%$/)
      expect(div.style.left).toMatch(/%$/)
    }
  })

  // Ядро задачи: раскладка — производная от пропорций элементов.
  it('две широких ложатся друг под друга', () => {
    const { children } = scene([WIDE, WIDE])

    expect(pct(children[0].style.width)).toBeCloseTo(100, 1)
    expect(pct(children[1].style.width)).toBeCloseTo(100, 1)
    expect(pct(children[0].style.top)).toBeCloseTo(0, 1)
    expect(pct(children[1].style.top)).toBeGreaterThan(45)
    expect(pct(children[1].style.left)).toBeCloseTo(0, 1)
  })

  it('две узких ложатся рядом', () => {
    const { children } = scene([TALL, TALL])

    expect(pct(children[0].style.top)).toBeCloseTo(0, 1)
    expect(pct(children[1].style.top)).toBeCloseTo(0, 1)
    expect(pct(children[0].style.left)).toBeCloseTo(0, 1)
    expect(pct(children[1].style.left)).toBeGreaterThan(45)
    expect(pct(children[0].style.width)).toBeLessThan(100)
  })

  it('размеры элементов реально влияют: смешанная группа — не тот же грид, что однородная', () => {
    const mixed = scene([TALL, WIDE, WIDE]).children.map((d) => d.style.cssText)
    const uniform = scene([WIDE, WIDE, WIDE]).children.map((d) => d.style.cssText)

    expect(mixed).not.toEqual(uniform)
  })

  it('бокс контейнера = обход крайних ячеек (правый край + нижний край)', () => {
    const { container, children, width, height } = scene([WIDE, TALL, TALL])

    expect(container.style.width).toBe(width + 'px')
    expect(container.style.height).toBe(height + 'px')
    // самая правая ячейка достаёт до правого края, самая нижняя — до нижнего
    expect(Math.max(...children.map((d) => pct(d.style.left) + pct(d.style.width)))).toBeCloseTo(100, 1)
    expect(Math.max(...children.map((d) => pct(d.style.top) + pct(d.style.height)))).toBeCloseTo(100, 1)
  })

  it('noGroupedItem — ячейка без grouped-item (предпросмотр отправки в tweb)', () => {
    const { children } = scene([WIDE, WIDE], { noGroupedItem: true })

    for (const div of children) {
      expect(div.classList.contains('album-item')).toBe(true)
      expect(div.classList.contains('grouped-item')).toBe(false)
    }
  })

  it('без forMedia внутренний .album-item-media не создаётся', () => {
    const { children } = scene([WIDE, WIDE], { forMedia: undefined })

    expect(children[0].firstElementChild).toBeNull()
  })

  // tweb переиспользует уже лежащие в контейнере узлы (перераскладка альбома
  // при resize не должна пересоздавать ячейки — в них уже висит медиа).
  it('существующие ячейки переиспользуются, а не пересоздаются', () => {
    const container = document.createElement('div')
    const existing = document.createElement('div')
    existing.dataset.mark = 'kept'
    container.append(existing)

    const { items } = prepareAlbum({ container, items: [WIDE, WIDE], ...OPTS, forMedia: true })

    expect(items[0]).toBe(existing)
    expect(container.children).toHaveLength(2)
    expect((container.children[0] as HTMLElement).dataset.mark).toBe('kept')
  })
})
