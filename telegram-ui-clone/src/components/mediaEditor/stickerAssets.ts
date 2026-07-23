// Загрузчик кадров стикеров для медиа-редактора. По mediaId (loadStickerContent
// из StickerMedia) готовит CanvasImageSource для composeScene:
//  • image (webp/png) — декодируется в <img>;
//  • lottie — крутится в offscreen-canvas через lottie-web (renderer canvas, как
//    LottieSticker), и этот canvas отдаётся как источник ТЕКУЩЕГО кадра. На
//    каждом кадре дёргаем onFrame → редактор перерисовывает превью (анимация
//    видна вживую; JPEG-экспорт берёт кадр, что нарисован на момент экспорта —
//    полноценное видео будет в C6).
import lottie, { type AnimationItem } from 'lottie-web'
import { loadStickerContent } from '../StickerMedia'

// Сторона offscreen-канваса lottie (кадр вписывается preserveAspectRatio).
const LOTTIE_SIZE = 256

export class StickerAssets {
  private readonly onFrame: () => void
  private readonly sources = new Map<number, CanvasImageSource>()
  private readonly anims = new Map<number, AnimationItem>()
  private readonly pending = new Set<number>()
  private dead = false

  constructor(onFrame: () => void) {
    this.onFrame = onFrame
  }

  /** Начать загрузку кадра стикера (идемпотентно). */
  ensure(mediaId: number): void {
    if (this.dead || this.sources.has(mediaId) || this.pending.has(mediaId)) return
    this.pending.add(mediaId)
    loadStickerContent(mediaId).then(
      (c) => {
        this.pending.delete(mediaId)
        if (this.dead) return
        if (c.kind === 'image') {
          const img = new Image()
          img.onload = () => {
            if (this.dead) return
            this.sources.set(mediaId, img)
            this.onFrame()
          }
          img.src = c.url
          return
        }
        // lottie → offscreen-canvas, обновляется на каждом кадре
        const canvas = document.createElement('canvas')
        canvas.width = LOTTIE_SIZE
        canvas.height = LOTTIE_SIZE
        const ctx = canvas.getContext('2d')
        if (!ctx) return
        const anim = lottie.loadAnimation<'canvas'>({
          // container обязателен по типам; при заданном rendererSettings.context
          // lottie рисует в наш offscreen-контекст, а фиктивный container не трогает.
          container: document.createElement('div'),
          renderer: 'canvas',
          loop: true,
          autoplay: true,
          animationData: c.data,
          rendererSettings: { context: ctx, clearCanvas: true, preserveAspectRatio: 'xMidYMid meet' },
        })
        anim.addEventListener('enterFrame', this.onFrame)
        this.anims.set(mediaId, anim)
        this.sources.set(mediaId, canvas)
        this.onFrame()
      },
      () => { this.pending.delete(mediaId) },
    )
  }

  /** Текущий кадр стикера или null, если ещё не готов. */
  get(mediaId: number): CanvasImageSource | null {
    return this.sources.get(mediaId) ?? null
  }

  /**
   * Детерминированно перемотать все lottie-анимации на время timeSec (для
   * покадрового энкода видео): кадр = (timeSec * frameRate) mod totalFrames,
   * goToAndStop рисует его в offscreen-canvas синхронно. Статичные — no-op.
   */
  seek(timeSec: number): void {
    for (const anim of this.anims.values()) {
      const total = anim.totalFrames
      if (!total) continue
      const fr = anim.frameRate || 60
      anim.goToAndStop(((timeSec * fr) % total + total) % total, true)
    }
  }

  destroy(): void {
    this.dead = true
    for (const a of this.anims.values()) a.destroy()
    this.anims.clear()
    this.sources.clear()
    this.pending.clear()
  }
}
