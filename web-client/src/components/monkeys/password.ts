/**
 * Порт tweb `src/components/monkeys/password.ts` (812502980, 62 строки) —
 * обезьянка поля пароля мастера 2FA: одна анимация `TwoFactorSetupMonkeyPeek`
 * в `div.media-sticker-wrapper`; «глазок» поля (`PasswordInputHelpers
 * .onVisibilityClickAdditional`) переводит её в «подглядывает» (кадр 0→16) и
 * обратно (16→0). Кадр останавливает `enterFrame` на `needFrame` — как у
 * оригинала, без `playPart`.
 *
 * У нас есть и React-двойник той же анимации (`components/PasswordMonkey.tsx`) —
 * у экрана блокировки пасскода (`PasscodeLockScreen.tsx`, ещё React); его
 * предмет — проп `peeking`, а не поле-класс, поэтому класс оригинала заведён
 * отдельно. С переездом экрана блокировки двойник уходит.
 *
 * Отличия от оригинала:
 *  1. `animation`/`loadPromise` — необязательные поля (strict): до загрузки
 *     анимации их нет, `remove()` у tweb проверяет то же самое.
 */
import lottieLoader from '@lib/lottie/lottieLoader'
import type LottiePlayer from '@lib/lottie/lottiePlayer'
import type PasswordInputField from '@components/passwordInputField'

export default class PasswordMonkey {
  public container: HTMLElement
  public animation?: LottiePlayer
  public needFrame = 0
  protected loadPromise?: Promise<unknown>

  constructor(protected passwordInputField: PasswordInputField, protected size: number) {
    this.container = document.createElement('div')
    this.container.classList.add('media-sticker-wrapper')
  }

  public load() {
    if(this.loadPromise) return this.loadPromise
    return this.loadPromise = lottieLoader.loadAnimationAsAsset({
      container: this.container,
      loop: false,
      autoplay: false,
      width: this.size,
      height: this.size,
      noCache: true,
    }, 'TwoFactorSetupMonkeyPeek').then((_animation) => {
      const animation = this.animation = _animation
      animation.addEventListener('enterFrame', (currentFrame: number) => {
        if((animation.direction === 1 && currentFrame >= this.needFrame) ||
          (animation.direction === -1 && currentFrame <= this.needFrame)) {
          animation.setSpeed(1)
          animation.pause()
        }
      })

      this.passwordInputField.helpers.onVisibilityClickAdditional = () => {
        if(this.passwordInputField.helpers.passwordVisible) {
          animation.setDirection(1)
          animation.curFrame = 0
          this.needFrame = 16
          animation.play()
        } else {
          animation.setDirection(-1)
          animation.curFrame = 16
          this.needFrame = 0
          animation.play()
        }
      }

      return lottieLoader.waitForFirstFrame(_animation)
    })
  }

  public remove() {
    if(this.animation) {
      this.animation.remove()
    }
  }
}
