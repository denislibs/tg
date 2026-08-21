// Порт tweb `src/helpers/idleController.ts`.
//
// «Простаивает» = ОКНО без пользователя, а не скрытая вкладка: blur → idle,
// focus или ПЕРВОЕ движение мыши (на тач-устройствах — тач) → активен.
// Стартовое значение — `true`: после перезагрузки страница считается
// простаивающей, пока пользователь её не тронет (комментарий оригинала
// «Prevent setting online after reloading page»). Для анимаций это значит,
// что стикеры не играют до первого взаимодействия, а не «играют, пока
// вкладка видима».
//
// Отличия от оригинала (всё остальное — 1:1):
//   • нет `getAppWindow`/`onAppWindowChange` (Document PiP, куда tweb
//     переносит весь DOM): подсистемы PiP-окна у нас нет, слушатели вешаются
//     на единственное окно вкладки;
//   • нет `getFocusPromise` (tweb ждёт им фокуса перед отметкой прочтения,
//     bubbles.ts:2948) — у нас потребителя нет, а заводить его ради полноты
//     API значило бы завести мёртвый код.
import IS_TOUCH_SUPPORTED from '@environment/touchSupport'
import EventListenerBase from '@helpers/eventListenerBase'
import { IS_PREVIEW } from '@config/debug'

const FOCUS_EVENT_NAME = IS_TOUCH_SUPPORTED ? 'touchstart' : 'mousemove'
/** tweb :7 — окно превью никогда не в фокусе, простаивающим его считать нельзя */
const DO_NOT_IDLE = IS_PREVIEW

export class IdleController extends EventListenerBase<{
  change: (idle: boolean) => void
}> {
  private _isIdle: boolean

  private onBlur = () => {
    this.isIdle = true
  }

  private onActive = () => {
    this.isIdle = false
  }

  constructor() {
    super()

    this._isIdle = !DO_NOT_IDLE

    if(typeof window !== 'undefined') {
      window.addEventListener('blur', this.onBlur)
      window.addEventListener('focus', this.onActive)
      // * Prevent setting online after reloading page (комментарий tweb :61)
      window.addEventListener(FOCUS_EVENT_NAME, this.onActive, { once: true, passive: true })
    }
  }

  public get isIdle() {
    return this._isIdle
  }

  public set isIdle(value: boolean) {
    if(this._isIdle === value) {
      return
    }

    if(DO_NOT_IDLE && value) {
      return
    }

    this._isIdle = value
    this.dispatchEvent('change', value)
  }
}

const idleController = new IdleController()
export default idleController
