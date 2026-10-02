// Круговое раскрытие смены темы — порт view-transition части tweb
// `ThemeController.setTheme` (`src/helpers/themeController.ts:354-468`,
// 812502980). Один исполнитель на оба переключателя: ⋮-меню приложения
// (`switchTheme` ниже, бургер колонки) и кнопку экрана входа
// (`components/auth/AuthCardsHost.solid.tsx`) — прежде у каждого была своя
// копия формулы.
//
// tweb 7082e1a18 → 091b476a9: круг задаётся в ПРОЦЕНТАХ бокса снапшота, а не
// в px. Старый Chromium гонит композитную анимацию `clip-path` в пикселях
// backing store (px ложились на 1/DPR от клика), Chrome 154 и WebKit — в CSS-
// пикселях; процент разрешается в пространстве самого бокса, поэтому точка и
// радиус верны везде без сниффинга версий и DPR.
//
// Расхождения с оригиналом (у каждого — предмет):
//  • быстрый путь. У tweb без координат/анимаций переход всё равно идёт через
//    `startViewTransition` (дефолтный кроссфейд, :413-419); у нас смена тогда
//    мгновенная — прежнее поведение обоих переключателей, вне предмета порта;
//  • гейт анимаций — `prefers-reduced-motion`, у tweb `liteMode`
//    (`animations`, :357) — прежний гейт наших переключателей.
import { getTransition } from '@config/transitions'
import { dispatchHeavyAnimationEvent } from '../dom/heavyAnimation'
import noop from '@helpers/noop'
import pause from '@helpers/schedulers/pause'
import appChatBackground from '@components/chat/bubbles/chatBackground.solid'
import { useSettingsStore } from '@/settings'
import { PRESET_MODE, resolvePreset, type ThemeChoice } from '@/theme'
import { getCurrentPreset } from './themeController'

// tweb :27 — сколько стоит пауза тяжёлого рендера и через сколько зависший
// переход принудительно завершается.
const THEME_TRANSITION_TIMEOUT = 2000

type ViewTransitionLike = {
  ready: Promise<void>
  finished: Promise<void>
  skipTransition?: () => void
}

export function switchThemeWithTransition(
  apply: () => void,
  coordinates: { x: number, y: number } | undefined,
  isNight: boolean,
): void {
  const start = (document as Document & {
    startViewTransition?: (cb: () => void | Promise<void>) => ViewTransitionLike
  }).startViewTransition
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  if (!start || !coordinates || reduce) {
    apply()
    return
  }

  // tweb :377-381 — день → ночь сжимает СТАРЫЙ снапшот (он поверх,
  // `.reverse::view-transition-old(root)`), ночь → день растит новый.
  const reverse = !isNight
  const root = document.documentElement
  root.classList.add('no-view-transition')
  root.classList.toggle('reverse', reverse)
  void root.offsetLeft // reflow

  const transition = start.call(document, async() => {
    apply()
    // tweb :386-395: `apply` разослал `theme_changed`, и фон чата перерисовывает
    // обои асинхронно (`instant`). Снимок нового состояния ждёт их, чтобы обои
    // раскрылись вместе с цветами; 500 мс — потолок, чтобы медленная картинка
    // не заморозила переключение.
    await Promise.race([appChatBackground.getReadyPromise(), pause(500)])
  })

  // tweb :397-401: пауза тяжёлого рендера на время раскрытия; `.catch` — чтобы
  // реджект `finished` не заклинил паузу до таймаута.
  void dispatchHeavyAnimationEvent(transition.finished.catch(noop), THEME_TRANSITION_TIMEOUT)

  // tweb :403-411 (`safetyTimeout` :407) — зависший переход принудительно завершается тем же сроком.
  const safetyTimeout = setTimeout(() => {
    transition.skipTransition?.()
  }, THEME_TRANSITION_TIMEOUT)
  void transition.finished.catch(noop).then(() => clearTimeout(safetyTimeout))

  const { x, y } = coordinates
  const pseudoElement = `::view-transition-${reverse ? 'old' : 'new'}(root)`

  let clipAnimation: Animation | undefined
  transition.ready.then(() => {
    // tweb :424-453 — круг в процентах собственного бокса снапшота.
    const box = getComputedStyle(root, pseudoElement)
    const width = parseFloat(box.width)
    const height = parseFloat(box.height)
    const measured = width > 0 && height > 0
    // Get the distance to the furthest corner
    const endRadius = Math.hypot(
      Math.max(x, (measured ? width : innerWidth) - x),
      Math.max(y, (measured ? height : innerHeight) - y),
    )
    // A circle's percentage radius resolves against the box diagonal divided by √2.
    const circle = measured
      ? (radius: number) => `circle(${radius / Math.hypot(width, height) * Math.SQRT2 * 100}% at ${x / width * 100}% ${y / height * 100}%)`
      : (radius: number) => `circle(${radius}px at ${x}px ${y}px)`
    const { easing, duration, keyframes } = getTransition(
      'standard',
      !reverse,
      [
        { clipPath: circle(0) },
        { clipPath: circle(endRadius) },
      ],
    )

    clipAnimation = root.animate(keyframes!, {
      duration: duration * 2,
      easing,
      pseudoElement,
      fill: 'forwards', // * without this rule animation will flick at the end
    })
  }).catch(noop) // `ready` rejects when the transition is skipped

  void transition.finished.catch(noop).finally(() => {
    clipAnimation?.cancel()
    root.classList.remove('no-view-transition', 'reverse')
  })
}

/**
 * Порт tweb `themeController.switchTheme` (`helpers/themeController.ts`, вызов —
 * бургер `sidebarLeft/index.ts:924`): день ↔ ночь от ПРИМЕНЁННОЙ темы (системную мог
 * сменить слушатель `setThemeListener`). Выбор пишется в настройки, тему применяет
 * их подписчик (`appImManager.applyCurrentTheme`) синхронно — внутри снапшота
 * перехода. Бывший `core/hooks/useThemeToggle.ts` шелла.
 */
export function switchTheme(coordinates?: { x: number, y: number }): void {
  const { themeChoice, update } = useSettingsStore.getState()
  const isNight = PRESET_MODE[getCurrentPreset() ?? resolvePreset(themeChoice)] === 'dark'
  const next: ThemeChoice = isNight ? 'day' : 'night'
  switchThemeWithTransition(() => update({ themeChoice: next }), coordinates, isNight)
}
