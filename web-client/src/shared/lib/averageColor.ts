// Порт tweb `src/helpers/averageColor.ts` (812502980): средний цвет холста или
// картинки — из него фон чата выводит `--message-highlighting-color`
// (`chat/bubbles/chatBackground.solid.tsx::computeHighlightingHsla`).
// `averageColor(url)` оригинала не перенесён: его зовёт только выбор обоев-
// картинки во вкладке «Обои» (`background.tsx:187-213`), у нас этот расчёт
// делает сам фон при показе.

export function averageColorFromCanvas(canvas: HTMLCanvasElement) {
  const context = canvas.getContext('2d')!

  const pixel = [0, 0, 0, 0]
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data
  const pixelsLength = pixels.length / 4
  for(let i = 0; i < pixels.length; i += 4) {
    pixel[0] += pixels[i]
    pixel[1] += pixels[i + 1]
    pixel[2] += pixels[i + 2]
    pixel[3] += pixels[i + 3]
  }

  const outPixel = new Uint8ClampedArray(4)
  outPixel[0] = pixel[0] / pixelsLength
  outPixel[1] = pixel[1] / pixelsLength
  outPixel[2] = pixel[2] / pixelsLength
  outPixel[3] = pixel[3] / pixelsLength
  return outPixel
}

export function averageColorFromImageSource(imageSource: CanvasImageSource, width: number, height: number) {
  const canvas = document.createElement('canvas')
  const ratio = width / height
  const DIMENSIONS = 50
  if(ratio === 1) {
    canvas.width = DIMENSIONS
    canvas.height = canvas.width / ratio
  } else if(ratio > 1) {
    canvas.height = DIMENSIONS
    canvas.width = canvas.height / ratio
  } else {
    canvas.width = canvas.height = DIMENSIONS
  }

  const context = canvas.getContext('2d')!
  context.drawImage(imageSource, 0, 0, width, height, 0, 0, canvas.width, canvas.height)
  return averageColorFromCanvas(canvas)
}

export function averageColorFromImage(image: HTMLImageElement) {
  return averageColorFromImageSource(image, image.naturalWidth, image.naturalHeight)
}
