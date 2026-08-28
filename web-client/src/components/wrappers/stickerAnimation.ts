// src/components/wrappers/stickerAnimation.ts
//
// Порт tweb `src/components/wrappers/stickerAnimation.ts` (`wrapStickerAnimation`,
// :20-205) — «полёт» стикер-эффекта ПОВЕРХ всего приложения: узел кладётся не в
// цель, а в общий контейнер `emojiAnimationContainer` (:15-16, :201) и
// позиционируется по `getBoundingClientRect()` цели, чтобы его не резал
// `overflow` бабла и чипа реакции.
//
// Разметка 1:1 (:15-16, :63-68):
//   div.emoji-animation-container            ← один на приложение
//     └ div.emoji-animation[style="width/height/top/left"]
// Стили — `styles/tweb/_emojiAnimation.scss` (порт `scss/partials/_emojiAnimation.scss`,
// байт в байт).
//
// ─── Что не портировано и почему ────────────────────────────────────────────
//  • Ветки `relativeEffect`, `withRandomOffset`, `side: 'left'|'right'`,
//    `addOffsetX/Y`, `fullThumb`, `textColor`, `noOffscreen`, `stickerSize`,
//    `animation` (готовый плеер) — параметры оригинала, которых наш
//    единственный потребитель не задаёт: эффект вокруг чипа реакции зовёт его
//    ровно как `{side: 'center', play: false}` (tweb reaction.ts:1185-1194).
//    `setPosition` ниже — тот же расчёт оригинала (:153-187) с подставленным
//    `side === 'center'`, а не другой расчёт. Мёртвых веток не держим (правило
//    CLAUDE.md); понадобится второй потребитель — ветка доедет вместе с ним.
//  • `IS_VIBRATE_SUPPORTED`-вибро на первом кадре (:133-137): `navigator.vibrate`
//    — отдельная подсистема окружения (`environment/*`), которой у нас нет.
//  • `skipRatio` (:109) — у нашего `wrapSticker` этого параметра нет вовсе
//    (см. его докблок: вход `mediaId` + плоские метаданные, а не `MyDocument`).
//  • Очистка контейнера при смене чата (`emojiAnimationContainer.textContent = ''`,
//    tweb appImManager.ts:706) и перенос его в колонку на мобиле
//    (appImManager.ts:1383-1388) — обе живут у `appImManager`, которого у нас
//    нет. Живой полёт умирает сам: `middleware` ленты (см. `unmountAnimation`
//    по событию `destroy` плеера) и проверка `isInDOM(target)` на каждом кадре.
import isInDOM from '@helpers/dom/isInDOM'
import makeError from '@helpers/makeError'
import { getMiddleware, type Middleware } from '@helpers/middleware'
import throttleWithRaf from '@helpers/schedulers/throttleWithRaf'
import windowSize from '@helpers/windowSize'
import LottiePlayer from '@lib/lottie/lottiePlayer'
import wrapSticker from './sticker'

/** tweb stickerAnimation.ts:15-16 — ОДИН на приложение. */
export const emojiAnimationContainer = document.createElement('div')
emojiAnimationContainer.classList.add('emoji-animation-container')

/**
 * Подвесить общий контейнер к `document.body` — порт десктопной ветки
 * `appImManager.appendEmojiAnimationContainer` (tweb appImManager.ts:1383-1388:
 * `screen === mobile ? this.columnEl : document.body`). Мобильной ветки нет:
 * `columnEl` — поле `appImManager`, которого у нас нет; на узкой раскладке
 * эффект просто летит поверх всего окна, а не поверх колонки чата.
 */
function mountContainer(): void {
  if (emojiAnimationContainer.parentElement !== document.body) {
    document.body.append(emojiAnimationContainer)
  }
}

export interface WrapStickerAnimationOptions {
  /** файл эффекта на media-эндпоинте (у tweb — `doc` документа MTProto) */
  mediaId: number
  /** сторона квадрата полёта в пикселях (tweb `size`) */
  size: number
  /** узел, вокруг центра которого летит эффект (tweb `target`) */
  target: HTMLElement
  /** играть сразу (tweb `play`) */
  play: boolean
  /** зацикливать (tweb `loopEffect`) */
  loopEffect?: boolean
  /** зона актуальности вызывающего (tweb `middleware`) */
  middleware?: Middleware
  /** позвать, когда полёт снят (tweb `onUnmount`) */
  onUnmount?: () => void
  /** скроллер, за которым полёт следует (tweb `scrollable`) */
  scrollable?: { container: HTMLElement }
}

export default function wrapStickerAnimation({
  mediaId,
  size,
  target,
  play,
  loopEffect,
  middleware,
  onUnmount,
  scrollable,
}: WrapStickerAnimationOptions): { animationDiv: HTMLElement, stickerPromise: Promise<LottiePlayer> } {
  // tweb :63-68.
  const animationDiv = document.createElement('div')
  animationDiv.classList.add('emoji-animation')
  animationDiv.style.width = size + 'px'
  animationDiv.style.height = size + 'px'

  let animation: LottiePlayer | undefined

  // tweb :72-86.
  const unmountAnimation = () => {
    middlewareHelper.destroy()
    const a = animation
    animation = undefined
    a?.remove()
    animationDiv.remove()
    if (onScroll) scrollable!.container.removeEventListener('scroll', onScroll)
    if (a) {
      onUnmount?.()
    }
  }

  // tweb :88-89.
  const middlewareHelper = middleware?.create() ?? getMiddleware()
  const ownMiddleware = middlewareHelper.get()

  const stickerPromise = wrapSticker({
    div: animationDiv,
    mediaId,
    middleware: ownMiddleware,
    withThumb: false,
    needFadeIn: false,
    loop: !!loopEffect,
    width: size,
    height: size,
    play,
    group: 'none',
  }).render.then((_animation) => {
    // tweb :119-122.
    if (!ownMiddleware()) {
      if (_animation instanceof LottiePlayer) _animation.remove()
      throw makeError('MIDDLEWARE')
    }

    // У оригинала эффект — всегда lottie (`around_animation` каталога реакций),
    // поэтому ветки «файл оказался не анимацией» там нет. У нас формат известен
    // только ПОСЛЕ загрузки (`wrappers/sticker.ts` различает его по
    // `Content-Type`), а играть покадрово статикой нечем.
    if (!(_animation instanceof LottiePlayer)) {
      unmountAnimation()
      throw makeError('FILE_INVALID')
    }

    animation = _animation
    // tweb :125-129.
    animation.addEventListener('enterFrame', (frameNo) => {
      if ((!loopEffect && frameNo === animation!.maxFrame) || !isInDOM(target)) {
        unmountAnimation()
      }
    })

    animation.addEventListener('destroy', unmountAnimation)

    animation.onFirstFrame(() => {
      setPosition()
    })

    return animation
  })

  // tweb :153-187 при `side === 'center'`, `relativeEffect` и `withRandomOffset`
  // выключенных: `stableOffset*` и `randomOffset*` тогда нули, `rectX` — левый
  // край цели, а обе добавки вырождаются в центрирование квадрата по цели.
  const setPosition = () => {
    if (!isInDOM(target)) {
      unmountAnimation()
      return
    }

    const rect = target.getBoundingClientRect()
    const addOffsetX = (rect.width - size) / 2
    const addOffsetY = (rect.height - size) / 2
    const x = rect.left + addOffsetX
    const y = rect.top + addOffsetY

    if (y <= -size || y >= windowSize.height) {
      unmountAnimation()
      return
    }

    animationDiv.style.top = y + 'px'
    animationDiv.style.left = x + 'px'
  }

  // tweb :189-193.
  let onScroll: (() => void) | undefined
  if (scrollable) {
    onScroll = throttleWithRaf(setPosition)
    scrollable.container.addEventListener('scroll', onScroll)
  }

  // tweb :197-202 (ветка без `relativeEffect`).
  mountContainer()
  emojiAnimationContainer.append(animationDiv)

  return { animationDiv, stickerPromise }
}
