// Порт tweb `src/components/chat/patternRenderer.ts` (812502980) — рендерер
// дудл-узора обоев: общий на элемент-слой (`getInstance` по `element` + опциям),
// холсты под размер слоя × `min(2, dpr)`, узор масштабируется по высоте окна и
// тайлится от центра вверх/вниз (`fillCanvas`); при `mask` — чёрная заливка с
// прорезями формой дудла (`destination-out`). Потребитель —
// `components/chat/bubbles/chatBackground.solid.tsx::buildContent`.
//
// Отличия от оригинала — только мёртвое у него самого: закомментированные
// ветки `createCanvasPattern`/`exportCanvasPatternToImage`/`setResizeMode` и
// масштаб `SCALE_PATTERN` (константа `false`, ветка `height *= 1.5` не
// исполняется никогда) не перенесены.
import indexOfAndSplice from '@helpers/array/indexOfAndSplice'
import clearMediaElementSource from '@helpers/dom/clearMediaElementSource'
import deepEqual from '@helpers/object/deepEqual'
import { renderImageFromUrlPromise } from '@helpers/dom/renderImageFromUrl'
import windowSize from '@helpers/windowSize'
import IS_IMAGE_BITMAP_SUPPORTED from '@environment/imageBitmapSupport'
import { IS_FIREFOX } from '@environment/userAgent'

// tweb хранит плотность прямо на холсте (глобальное `HTMLCanvasElement.dpr`
// в их `global.d.ts`); у нас поле объявлено здесь, у единственного писателя.
declare global {
  interface HTMLCanvasElement {
    dpr?: number
  }
}

const USE_BITMAP = IS_IMAGE_BITMAP_SUPPORTED && IS_FIREFOX

type ChatBackgroundPatternRendererInitOptions = {
  element: HTMLElement
  url: string
  width: number
  height: number
  mask?: boolean
}

export default class ChatBackgroundPatternRenderer {
  private static INSTANCES: ChatBackgroundPatternRenderer[] = []

  private options!: ChatBackgroundPatternRendererInitOptions
  private canvases: Set<HTMLCanvasElement>
  private renderImageFromUrlPromise?: Promise<HTMLImageElement>
  private image?: HTMLImageElement
  private imageBitmap?: ImageBitmap

  constructor() {
    this.canvases = new Set()
  }

  public static getInstance(options: ChatBackgroundPatternRendererInitOptions) {
    let instance = this.INSTANCES.find((instance) => {
      return instance.options.element === options.element && deepEqual(instance.options, options, ['element'])
    })

    if(!instance) {
      instance = new ChatBackgroundPatternRenderer()
      instance.init(options)
      this.INSTANCES.push(instance)
    }

    return instance
  }

  public init(options: ChatBackgroundPatternRendererInitOptions) {
    this.options = options
  }

  public renderToCanvas(canvas: HTMLCanvasElement) {
    return this.renderImageFromUrl(this.options.url).then(() => {
      return this.fillCanvas(canvas)
    })
  }

  private renderImageFromUrl(url: string) {
    if(this.renderImageFromUrlPromise) return this.renderImageFromUrlPromise
    const img = this.image = document.createElement('img')
    img.crossOrigin = 'anonymous'
    return this.renderImageFromUrlPromise = renderImageFromUrlPromise(img, url, false).then(() => {
      if(!IS_IMAGE_BITMAP_SUPPORTED || !USE_BITMAP) {
        return img
      }

      return createImageBitmap(img, {
        resizeWidth: 1440,
        resizeHeight: 2960,
      }).then((imageBitmap) => {
        this.imageBitmap = imageBitmap
        return img
      })
    }).catch((error: unknown) => {
      clearMediaElementSource(img)
      throw error
    })
  }

  public cleanup(canvas: HTMLCanvasElement) {
    this.canvases.delete(canvas)

    if(!this.canvases.size) {
      indexOfAndSplice(ChatBackgroundPatternRenderer.INSTANCES, this)

      this.imageBitmap?.close()
      if(this.image) clearMediaElementSource(this.image)
    }
  }

  public fillCanvas(canvas: HTMLCanvasElement) {
    const context = canvas.getContext('2d')
    // happy-dom и прочие среды без 2D-контекста: рисовать некуда
    if(!context) return
    const { width, height } = canvas

    const source = (this.imageBitmap || this.image)!

    let imageWidth = source.width
    let imageHeight = source.height
    const patternHeight = (500 + (windowSize.height / 2.5)) * canvas.dpr!
    const ratio = patternHeight / imageHeight
    imageWidth *= ratio
    imageHeight = patternHeight

    if(this.options.mask) {
      context.fillStyle = '#000'
      context.fillRect(0, 0, width, height)
      context.globalCompositeOperation = 'destination-out'
    } else {
      context.globalCompositeOperation = 'source-over'
    }

    const d = (y: number) => {
      for(let x = 0; x < width; x += imageWidth) {
        context.drawImage(source, x, y, imageWidth, imageHeight)
      }
    }

    const centerY = (height - imageHeight) / 2
    d(centerY)

    if(centerY > 0) {
      let topY = centerY
      do {
        d(topY -= imageHeight)
      } while(topY >= 0)
    }

    const endY = height - 1
    for(let bottomY = centerY + imageHeight; bottomY < endY; bottomY += imageHeight) {
      d(bottomY)
    }
  }

  public setCanvasDimensions(canvas: HTMLCanvasElement) {
    const devicePixelRatio = Math.min(2, window.devicePixelRatio)
    const width = this.options.width * devicePixelRatio
    const height = this.options.height * devicePixelRatio

    canvas.dpr = devicePixelRatio
    canvas.dataset.originalHeight = '' + height
    canvas.width = width
    canvas.height = height
  }

  public createCanvas() {
    const canvas = document.createElement('canvas')
    this.canvases.add(canvas)
    this.setCanvasDimensions(canvas)
    return canvas
  }

  public resize(width: number, height: number) {
    this.init({
      ...this.options,
      width,
      height,
    })

    const promises: Promise<unknown>[] = []
    for(const canvas of this.canvases) {
      this.setCanvasDimensions(canvas)
      promises.push(this.renderToCanvas(canvas))
    }

    return Promise.all(promises)
  }

  public static resizeInstancesOf(element: HTMLElement) {
    const toResize = this.INSTANCES.filter((instance) => instance.options.element === element)

    const rect = element.getBoundingClientRect()

    return Promise.all(toResize.map((instance) => instance.resize(rect.width, rect.height)))
  }
}
