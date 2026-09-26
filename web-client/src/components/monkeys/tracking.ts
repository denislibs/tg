/**
 * Порт tweb `src/components/monkeys/tracking.ts` (812502980, 164 строки) —
 * «следящая» обезьянка над обычным полем (`InputField`): idle-луп
 * `TwoFactorSetupMonkeyIdle` и `TwoFactorSetupMonkeyTracking` в одном
 * `div.media-sticker-wrapper`; ввод двигает кадр по длине значения, уход
 * фокуса возвращает к нулю и к idle. Потребитель — повтор пароля мастера 2FA
 * (`sidebarLeft/tabs/2fa/reEnterPassword.solid.tsx`).
 *
 * Отличия от оригинала:
 *  1. Ветка `CodeInputFieldCompat` (фокус → кадр 1, ввод → доля от длины кода,
 *     :24-40) не переносится: поле кода у нас — Solid (`auth/CodeInput.solid.tsx`),
 *     и его обезьянка — Solid-порт этого же файла `auth/TrackingMonkey.solid.tsx`.
 *     Оттуда же берётся арифметика кадра (`computeTrackingFrame`,
 *     `computeTrackingStep`, `shouldPauseOnFrame` — вынесенные дословно
 *     `playAnimation`/`enterFrame` оригинала), чтобы не держать её двумя копиями.
 *  2. `animation`/`idleAnimation`/`loadPromise` — необязательные поля (strict):
 *     до загрузки их нет, `playAnimation`/`remove` у tweb проверяют то же самое.
 */
import type InputField from '@components/inputField'
import lottieLoader from '@lib/lottie/lottieLoader'
import type LottiePlayer from '@lib/lottie/lottiePlayer'
import {
  computeTrackingFrame,
  computeTrackingStep,
  shouldPauseOnFrame,
} from '@components/auth/TrackingMonkey.solid'

export default class TrackingMonkey {
  public container: HTMLElement

  protected max = 45
  protected needFrame = 0

  protected animation?: LottiePlayer
  protected idleAnimation?: LottiePlayer

  protected loadPromise?: Promise<unknown>

  constructor(protected inputField: InputField, protected size: number) {
    this.container = document.createElement('div')
    this.container.classList.add('media-sticker-wrapper')

    const input = inputField.input

    input.addEventListener('blur', () => {
      this.playAnimation(0)
    })

    input.addEventListener('input', () => {
      this.playAnimation(inputField.value.length)
    })
  }

  // 1st symbol = frame 15
  // end symbol = frame 165
  public playAnimation(length: number) {
    if(!this.animation) return

    const frame = computeTrackingFrame(length, this.max)
    if(frame) {
      if(this.idleAnimation) {
        this.idleAnimation.stop(true)
        this.idleAnimation.canvas[0].style.display = 'none'
      }

      this.animation.canvas[0].style.display = ''
    }

    const step = computeTrackingStep(this.needFrame, frame)
    this.animation.setDirection(step.direction)
    if(step.resetSpeed) {
      this.animation.setSpeed(7)
    }

    this.needFrame = frame

    this.animation.play()
  }

  public load() {
    if(this.loadPromise) return this.loadPromise
    return this.loadPromise = Promise.all([
      lottieLoader.loadAnimationAsAsset({
        container: this.container,
        loop: true,
        autoplay: true,
        width: this.size,
        height: this.size,
      }, 'TwoFactorSetupMonkeyIdle').then((animation) => {
        this.idleAnimation = animation

        // ! animationIntersector will stop animation instantly
        if(!this.inputField.value.length) {
          animation.play()
        }

        return lottieLoader.waitForFirstFrame(animation)
      }),

      lottieLoader.loadAnimationAsAsset({
        container: this.container,
        loop: false,
        autoplay: false,
        width: this.size,
        height: this.size,
      }, 'TwoFactorSetupMonkeyTracking').then((_animation) => {
        const animation = this.animation = _animation

        if(!this.inputField.value.length) {
          animation.canvas[0].style.display = 'none'
        }

        animation.addEventListener('enterFrame', (currentFrame: number) => {
          if(shouldPauseOnFrame(animation.direction as 1 | -1, currentFrame, this.needFrame)) {
            animation.setSpeed(1)
            animation.pause()
          }

          if(currentFrame === 0 && this.needFrame === 0) {
            if(this.idleAnimation) {
              this.idleAnimation.canvas[0].style.display = ''
              this.idleAnimation.play()
              animation.canvas[0].style.display = 'none'
            }
          }
        })

        return lottieLoader.waitForFirstFrame(_animation)
      }),
    ])
  }

  public remove() {
    if(this.animation) this.animation.remove()
    if(this.idleAnimation) this.idleAnimation.remove()
  }
}
