// Загрузчик кадров стикеров для медиа-редактора. По mediaId (loadStickerContent
// из StickerMedia) готовит CanvasImageSource для composeScene:
//  • image (webp/png) — декодируется в <img>;
//  • lottie — свой скрытый плеер tlottie рисует в СОБСТВЕННЫЙ canvas[0], он и
//    отдаётся как источник ТЕКУЩЕГО кадра (движок не умеет рисовать в чужой
//    2D-контекст — см. комментарий у ensure() ниже). На каждом кадре дёргаем
//    onFrame → редактор перерисовывает превью (анимация видна вживую;
//    JPEG-экспорт берёт кадр, что нарисован на момент экспорта — полноценное
//    видео будет в C6).
//
// Расхождение с оригиналом (Этап 3 плана «один движок lottie»,
// docs/superpowers/plans/2026-09-05-lottie-single-engine.md): в tweb живой показ
// стикера в редакторе — это ДОМ-оверлей (`canvas/stickerLayerContent.tsx` зовёт
// общий `wrapSticker`, как в ленте сообщений), а сведение в один флэт-кадр —
// ОТДЕЛЬНЫЙ проход только для финального рендера видео/gif
// (`finalRender/lottieStickerFrameByFrameRenderer.ts` + интерфейс
// `StickerFrameByFrameRenderer`, `finalRender/types.ts`). У нас ОДИН
// канвас-компоузер обслуживает и живой превью, и покадровый экспорт — это НАШЕ
// архитектурное решение (сам этот файл, до всякого lottie-web), а не портируемое
// из tweb, и разделение на два прохода — отдельная задача шире периметра Этапа 3.
// Меняем поэтому только движок (lottie-web → tlottie): приём «дать плееру
// нарисовать в СВОЙ canvas и забрать canvas[0] как источник» — портирован из
// `lottieStickerFrameByFrameRenderer.ts:19-37,78-80` (тот же приём и в нашем
// `wrappers/sticker.ts:241-260`, уже на tlottie).
import lottieLoader from '@lib/lottie/lottieLoader'
import type LottiePlayer from '@lib/lottie/lottiePlayer'
import { loadStickerContent } from '../StickerMedia'

// Сторона офскрин-канваса lottie (кадр вписывается по аспекту — так рисует
// сам плеер в свой canvas, никакого preserveAspectRatio задавать не нужно).
const LOTTIE_SIZE = 256

// tweb `finalRender/constants.ts:2` — `FRAMES_PER_SECOND = 60`, тот же приём
// для детерминированного покадрового прохода при экспорте (см.
// `finalRender/renderToActualVideo.ts:291`: `currentTime * FRAMES_PER_SECOND | 0`).
// У tlottie `LottiePlayer` реальный fps стикера (`fps`/`frameCount`) — приватные
// поля вендоренного острова (`lottiePlayer.ts:92,1160-1162`); оригиналу они для
// этой цели тоже не нужны — он идёт тем же хардкодом.
const LOTTIE_EXPORT_FPS = 60

export class StickerAssets {
  private readonly onFrame: () => void
  private readonly sources = new Map<number, CanvasImageSource>()
  private readonly anims = new Map<number, LottiePlayer>()
  private readonly containers = new Map<number, HTMLDivElement>()
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
        // video-стикер (webm) в редакторе как оверлей пока не поддержан.
        if (c.kind !== 'lottie') return

        // Скрытый (off-DOM) контейнер под ОДИН плеер — как у оригинала
        // (`lottieStickerFrameByFrameRenderer.ts:19-26`): `loadAnimationWorker`
        // требует контейнер, класть в него канвасы больше некуда. tlottie НЕ
        // поддерживает рисование в чужой 2D-контекст (`rendererSettings.context`
        // — API lottie-web, которого здесь нет): `LottieOptions.canvas` — это
        // готовый `HTMLCanvasElement`, которым НЕСКОЛЬКО плееров делятся по
        // очереди (`lottieIcon.ts:66-76`), а не произвольный чужой context.
        const container = document.createElement('div')
        container.style.position = 'absolute'
        container.style.opacity = '0'
        container.style.pointerEvents = 'none'
        container.style.width = LOTTIE_SIZE + 'px'
        container.style.height = LOTTIE_SIZE + 'px'
        document.body.append(container)

        // Воркер парсит JSON из Blob (readBlobAsText в tlottie.worker.ts), а
        // loadStickerContent уже отдаёт разобранный объект — сериализуем
        // обратно, как `wrappers/sticker.ts:241-242`.
        const blob = new Blob([JSON.stringify(c.data)], { type: 'application/json' })
        lottieLoader
          .loadAnimationWorker({
            container,
            animationData: blob,
            loop: true,
            autoplay: true,
            width: LOTTIE_SIZE,
            height: LOTTIE_SIZE,
            name: 'mediaEditorSticker' + mediaId,
            // Мимо animationIntersector — как `StickerLayerContent.solid.tsx`
            // (`group: 'none'`): канвас офскрин весь свой век, видимость
            // страницы плееру не указ, лишний auto-pause не нужен.
            group: 'none',
            // Синхронное чтение canvas[0] на 'enterFrame' — как у оригинала
            // (`lottieStickerFrameByFrameRenderer.ts:35-36`, комментарий там же
            // прямо про это: "getRenderedFrame() reads canvas[0] synchronously").
            noOffscreen: true,
          })
          .then(
            (anim) => {
              if (this.dead || this.anims.has(mediaId)) {
                anim.remove()
                container.remove()
                return
              }
              anim.addEventListener('enterFrame', this.onFrame)
              this.anims.set(mediaId, anim)
              this.containers.set(mediaId, container)
              this.sources.set(mediaId, anim.canvas[0])
              this.onFrame()
            },
            () => {
              // Без WASM SIMD `loadAnimationWorker` отклоняется с NO_WASM ДО
              // первого кадра (`lottieLoader.ts:215-216`) — в отличие от
              // lottie-web (чистый JS-рендер, работал в любом браузере),
              // стикер в редакторе не появится СОВСЕМ: ни в живом превью, ни
              // в экспорте (`sceneRender.ts:493` молча пропускает слой без
              // источника). Долг тот же корень, что у остальных потребителей
              // tlottie (`backlogs/frontend/lottie-no-wasm-fallback.md`), но
              // ТЯЖЕЛЕЕ: там пропадает превью, здесь — слой в ЭКСПОРТЕ,
              // молча, без ошибки и предупреждения (пользователь не узнает,
              // что сохранённый результат отличается от того, что видел).
              // Открытый вопрос по этому месту не решён — см. бэклог, раздел
              // «Отдельно и жирно: медиаредактор — потеря тяжелее».
              container.remove()
            },
          )
      },
      () => {
        this.pending.delete(mediaId)
      },
    )
  }

  /** Текущий кадр стикера или null, если ещё не готов. */
  get(mediaId: number): CanvasImageSource | null {
    return this.sources.get(mediaId) ?? null
  }

  /**
   * Детерминированно перемотать все lottie-анимации на время timeSec (для
   * покадрового энкода видео): кадр = (timeSec * LOTTIE_EXPORT_FPS) mod
   * totalFrames, requestFrame ставит плеер на паузу и рисует нужный кадр в
   * canvas[0] синхронно — тот же смысл, что у `goToAndStop` lottie-web
   * (остановить автоплей и прыгнуть на кадр), которого у tlottie нет; здесь
   * это `pause()` + `requestFrame(frame)` (`lottiePlayer.ts:707-732,955-981`).
   * Статичные — no-op.
   */
  seek(timeSec: number): void {
    for (const anim of this.anims.values()) {
      const total = anim.maxFrame + 1
      if (!total) continue
      anim.pause()
      const frame = Math.floor((((timeSec * LOTTIE_EXPORT_FPS) % total) + total) % total)
      anim.requestFrame(frame)
    }
  }

  destroy(): void {
    this.dead = true
    for (const a of this.anims.values()) a.remove()
    for (const c of this.containers.values()) c.remove()
    this.anims.clear()
    this.containers.clear()
    this.sources.clear()
    this.pending.clear()
  }
}
