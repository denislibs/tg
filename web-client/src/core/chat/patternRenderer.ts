// Рендер паттерна-дудлов обоев на canvas — порт tweb
// (src/components/chat/patternRenderer.ts fillCanvas + математика приглушения из
// bubbles/chatBackground.tsx:255-272). Заменяет сторонний @twallpaper/react, чьи
// зашитые overlay+opacity 0.5 давали пересвет дудлов.
//
// Две стратегии (выбирает вызывающий по теме):
//  • mask (тёмные, напр. night): холст заливается #000, паттерн выбивает дырки
//    (destination-out) → сквозь дырки виден градиент; приглушение — через opacity
//    градиента (|i|·0.5, пол 0.3).
//  • overlay/normal (day/light/tinted): дудлы рисуются поверх (source-over) с
//    mix-blend soft-light; приглушение — через opacity паттерна (|i|).

/**
 * Максимальная непрозрачность приглушаемого слоя из интенсивности обоев.
 * intensity — «сырое» tweb-значение (-50..50, tweb делит на 100).
 * mask=true → путь маски (приглушается градиент): max(0.3, |i/100|·0.5).
 * mask=false → overlay/light (приглушается паттерн): |i/100|.
 * 1:1 tweb chatBackground.tsx:266-270.
 */
export function patternOpacity(intensity: number, mask: boolean): number {
  const i = intensity / 100
  if (mask) return Math.max(0.3, Math.abs(i) * 0.5)
  return Math.abs(i)
}

/**
 * Заливает canvas тайлами дудл-паттерна. При mask — чёрный фон с прорезями формой
 * дудла (destination-out); иначе — просто тайлит дудл (source-over). Порт
 * tweb fillCanvas (patternRenderer.ts:138-190): паттерн масштабируется по высоте
 * patternHeight и тайлится от центра вверх/вниз.
 */
export function renderPattern(
  canvas: HTMLCanvasElement,
  source: CanvasImageSource & { width: number; height: number },
  opts: { mask: boolean; viewportHeight: number; dpr?: number },
): void {
  const context = canvas.getContext('2d')
  if (!context) return
  const { width, height } = canvas
  const dpr = opts.dpr ?? 1

  let imageWidth = source.width
  let imageHeight = source.height
  // tweb: высота тайла зависит от вьюпорта (крупные дудлы на больших экранах).
  const patternHeight = (500 + opts.viewportHeight / 2.5) * dpr
  const ratio = patternHeight / imageHeight
  imageWidth *= ratio
  imageHeight = patternHeight

  if (opts.mask) {
    context.fillStyle = '#000'
    context.fillRect(0, 0, width, height)
    context.globalCompositeOperation = 'destination-out'
  } else {
    context.globalCompositeOperation = 'source-over'
  }

  const drawRow = (y: number) => {
    for (let x = 0; x < width; x += imageWidth) {
      context.drawImage(source, x, y, imageWidth, imageHeight)
    }
  }

  const centerY = (height - imageHeight) / 2
  drawRow(centerY)
  if (centerY > 0) {
    let topY = centerY
    do {
      drawRow((topY -= imageHeight))
    } while (topY >= 0)
  }
  const endY = height - 1
  for (let bottomY = centerY + imageHeight; bottomY < endY; bottomY += imageHeight) {
    drawRow(bottomY)
  }
}
