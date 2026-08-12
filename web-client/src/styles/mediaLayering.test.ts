// Слоение медиа в бабле: превью-подложка и само медиа обязаны быть в ОДНОМ
// классе позиционирования.
//
// Канвас stripped-превью (`components/messages/useBlurThumb.ts`) — absolute
// (`.canvas-thumbnail`, порт tweb base.scss:1244-1248), и лежит он в DOM ПЕРЕД
// медиа. Если `.media-photo` останется static, порядок отрисовки CSS покрасит
// позиционированный канвас ПОВЕРХ непозиционированного содержимого — загруженное
// фото навсегда останется под блюром (ровно этот дефект и был: пропал парный
// блок tweb base.scss:1282-1296 при портировании соседнего `.canvas-thumbnail`).
//
// Тест гоняет НАСТОЯЩИЙ скомпилированный `styles/index.scss` по дереву, которое
// строит RealMediaBubble: удаление правила из партиала краснит его.
import { describe, expect, it, beforeAll } from 'vitest'
import { join } from 'node:path'
import * as sass from 'sass'

let css: string

beforeAll(() => {
  css = sass.compile(join(__dirname, 'index.scss'), {
    loadPaths: [__dirname, join(__dirname, '..', '..', 'node_modules')],
    // Предупреждения вендорного tweb-SCSS к предмету теста отношения не имеют.
    silenceDeprecations: ['import', 'global-builtin', 'color-functions', 'legacy-js-api', 'slash-div'],
    quietDeps: true,
  }).css
})

/** Дерево из RealMediaBubble.tsx:231-241 + useBlurThumb.ts:31-33 (prepend). */
function mountBubbleMedia() {
  const style = document.createElement('style')
  style.textContent = css
  document.head.append(style)

  const container = document.createElement('div')
  container.className = 'attachment media-container no-background'

  const canvas = document.createElement('canvas')
  canvas.className = 'canvas-thumbnail media-photo thumbnail'

  const img = document.createElement('img')
  img.className = 'media-photo'

  container.append(canvas, img)
  document.body.append(container)
  return { canvas, img }
}

describe('слоение превью и медиа', () => {
  it('медиа позиционировано так же, как канвас-подложка — иначе подложка красится поверх', () => {
    const { canvas, img } = mountBubbleMedia()

    expect(getComputedStyle(canvas).position).toBe('absolute')
    expect(getComputedStyle(img).position).toBe('absolute')
  })

  it('видео перекрывает фото слоем (tweb base.scss:1296 — «overflow media-photo»)', () => {
    const video = document.createElement('video')
    video.className = 'media-video'
    document.body.append(video)

    expect(getComputedStyle(video).position).toBe('absolute')
    expect(getComputedStyle(video).zIndex).toBe('1')
  })
})
