/** @jsxImportSource solid-js */
// TrackingMonkey — обезьянка на карточке ввода кода подтверждения. Порт tweb
// `src/components/monkeys/tracking.ts` (164 строки, целиком): две lottie-канвы
// (idle-луп + tracking) в одном `div.media-sticker-wrapper`; на фокусе поля
// обезьянка открывает глаза и «отслеживает» набор цифр — кадр tracking-
// анимации считается от доли набранного кода. Долг закрыт (был записан
// в бэклоге фронта — запись удалена вместе с этим портом).
//
// ── Движок анимации — осознанное отступление от tweb ─────────────────────
// tweb грузит обе анимации через `lottieLoader.loadAnimationAsAsset(...)`
// (tlottie, SIMD-декод в воркере), ассет — по URL `assets/tgs/<name>.json`.
// У нас `web-client/public/assets/` не содержит каталога `tgs/` — обе исходные
// json-ки (`TwoFactorSetupMonkeyIdle.json`/`TwoFactorSetupMonkeyTracking.json`)
// лежат БАНДЛОМ в `src/assets/tgs/`. Поэтому привязка — `lottie-web` через
// `components/lottie.ts::loadLottie()` + динамический `import()` json, тем же
// приёмом, что у `PasswordMonkey.tsx` (React, вторая обезьянка) и
// `MediaHeader.solid.tsx::StickerLottie` (тот же приём уже на Solid). Само
// ПОВЕДЕНИЕ (арифметика кадра, направление, скорость, переключение канв) —
// 1:1 с оригиналом; отступление только в том, кто крутит кадры.
//
// Из первого отступления тянется второе, мельче: у tweb ОБЕ анимации рисуются
// в ОДИН `container` (tlottie сама кладёт `canvas` внутрь переданного узла,
// `LottiePlayer.canvas[0]`), и переключение видимости идёт через
// `canvas[0].style.display`. У raw `lottie-web` такого поля на `AnimationItem`
// нет — как и у `MediaHeader.solid.tsx::StickerLottie`, у каждой анимации свой
// host-`div` (свой `container`), и переключается видимость ХОСТА, а не канвы
// напрямую. Оба хоста лежат в одном `div.media-sticker-wrapper`, поэтому
// снаружи разметка не отличается от оригинала. Оверлея друг на друга им не
// требуется: idle и tracking взаимоисключающе видимы (второй всегда
// `display:none`, пока показан первый), а `.sticker` (mediaHeader.module.scss)
// центрирует единственного видимого ребёнка флексом — как в оригинале.
import { createEffect, on, onCleanup, onMount, type JSX } from 'solid-js'
import type { AnimationItem } from 'lottie-web'
import { fastRaf } from '@helpers/schedulers'
import { loadLottie } from '../lottie'

const ASSETS = {
  idle: () => import('../../assets/tgs/TwoFactorSetupMonkeyIdle.json'),
  tracking: () => import('../../assets/tgs/TwoFactorSetupMonkeyTracking.json'),
}

/** tweb `monkeys/tracking.ts` максимум диапазона слежения (класс-поле `max`). */
const MAX = 45

/**
 * tweb `playAnimation` :54-80 — арифметика кадра tracking-анимации от доли
 * набранного. Комментарий оригинала: «1st symbol = frame 15, end symbol =
 * frame 165». Клампы дословно: `length` сначала обрезается до 30 (даже если
 * ячеек кода больше — например, у кода длиннее 30 знаков), затем ещё раз до
 * `max` внутри самой формулы — у оригинала при `max=45` второй кламп никогда
 * не срабатывает раньше первого, но код воспроизведён как есть, а не
 * «оптимизирован». Вынесена чистой функцией, чтобы пинить арифметику
 * отдельно от DOM/lottie-обвязки (норма проводки задачи).
 */
export function computeTrackingFrame(rawLength: number, max: number): number {
  const length = Math.min(rawLength, 30)
  if (!length) return 0
  return Math.round(Math.min(max, length) * (165 / max) + 11.33)
}

/**
 * tweb `playAnimation` :83-92 — направление подыгрывания и решение о разгоне
 * скорости до 7 на возврате к нулевому кадру (обратный ход к «нейтралу»
 * играет быстрее, чем подъём по цифрам). `needFrame` — предыдущий целевой
 * кадр (класс-поле tweb), `frame` — новый, только что посчитанный.
 */
export function computeTrackingStep(
  needFrame: number,
  frame: number,
): { direction: 1 | -1; resetSpeed: boolean } {
  return {
    direction: needFrame > frame ? -1 : 1,
    resetSpeed: needFrame !== 0 && frame === 0,
  }
}

/** tweb `enterFrame` :137-138 — условие остановки подыгрывания текущего кадра. */
export function shouldPauseOnFrame(direction: 1 | -1, currentFrame: number, needFrame: number): boolean {
  return (direction === 1 && currentFrame >= needFrame) || (direction === -1 && currentFrame <= needFrame)
}

export type TrackingMonkeyProps = {
  /** сторона канвы, px — tweb `mediaSizes.isMobile ? 100 : 130` (у карточки кода — 130, см. вызывающего). */
  size: number
  /** число ячеек кода — tweb `inputField.options.length` (компат-обёртка `CodeInputFieldCompat`). */
  length: number
  /** текущее значение поля — реактивный аксессор. Меняется на каждый ввод/удаление
   *  цифры, как DOM-событие `input` у оригинала; пересчёт кадра идёт через `fastRaf`,
   *  как там же (`tracking.ts:35-40`). */
  value: () => string
  /** в фокусе ли поле — реактивный аксессор, аналог DOM `focus`/`blur` у оригинала. */
  focused: () => boolean
}

export default function TrackingMonkey(props: TrackingMonkeyProps): JSX.Element {
  let idleHost: HTMLDivElement | undefined
  let trackingHost: HTMLDivElement | undefined

  let idleAnim: AnimationItem | undefined
  let trackingAnim: AnimationItem | undefined
  // Гонка «ассет догрузился после размонтирования» (два независимых
  // `import()`+`loadLottie()`) — общий `alive`-флаг перед записью в замыкание,
  // тем же приёмом, что `PasswordMonkey.tsx`/`MediaHeader.solid.tsx`.
  let alive = true

  // Состояние подыгрывания — класс-поля `needFrame`/направление у tweb.
  let needFrame = 0
  let direction: 1 | -1 = 1

  // tweb `playAnimation` целиком (:54-98) — общая точка входа и для focus/blur,
  // и для input.
  const playAnimation = (rawLength: number) => {
    if (!trackingAnim) return

    const frame = computeTrackingFrame(rawLength, MAX)

    if (frame) {
      if (idleAnim) {
        idleAnim.stop()
        if (idleHost) idleHost.style.display = 'none'
      }
      if (trackingHost) trackingHost.style.display = ''
    }

    const step = computeTrackingStep(needFrame, frame)
    direction = step.direction
    trackingAnim.setDirection(direction)
    if (step.resetSpeed) trackingAnim.setSpeed(7)
    needFrame = frame

    trackingAnim.play()
  }

  onMount(() => {
    // tweb `load()` :100-158 — два независимых лоадера в `Promise.all`, порядок
    // резолва не гарантирован (у нас — два параллельных `import()`), поэтому
    // каждая ветка пишет только СВОЙ ref и не зависит от соседней.
    void Promise.all([loadLottie(), ASSETS.idle()]).then(([lottie, mod]) => {
      if (!alive || !idleHost) return
      idleAnim = lottie.loadAnimation({
        container: idleHost,
        renderer: 'canvas',
        loop: true,
        autoplay: true,
        animationData: mod.default as unknown,
        rendererSettings: { className: 'lottie', dpr: window.devicePixelRatio || 1 },
      })
    })

    void Promise.all([loadLottie(), ASSETS.tracking()]).then(([lottie, mod]) => {
      if (!alive || !trackingHost) return
      // Локальный const-алиас: TS не переносит сужение non-null через `let`
      // во вложенное замыкание (`enterFrame`-колбэк ниже) — та же причина,
      // по которой захват в замыкание обычно требует стабильной ссылки.
      const trackingHostEl = trackingHost
      const anim = lottie.loadAnimation({
        container: trackingHostEl,
        renderer: 'canvas',
        loop: false,
        autoplay: false,
        animationData: mod.default as unknown,
        rendererSettings: { className: 'lottie', dpr: window.devicePixelRatio || 1 },
      })
      trackingAnim = anim

      // tweb :129-131 — при пустом значении поля tracking-канва скрыта с самого начала.
      if (!props.value().length) trackingHostEl.style.display = 'none'

      anim.addEventListener('enterFrame', (e: { currentTime: number }) => {
        const currentFrame = Math.round(e.currentTime)

        if (shouldPauseOnFrame(direction, currentFrame, needFrame)) {
          anim.setSpeed(1)
          anim.pause()
        }

        // tweb :143-151 — возврат к idle-лупу строго на нулевом кадре и только
        // если idle вообще загружена (та же проверка, что в оригинале).
        if (currentFrame === 0 && needFrame === 0 && idleAnim) {
          if (idleHost) idleHost.style.display = ''
          idleAnim.play()
          trackingHostEl.style.display = 'none'
        }
      })
    })
  })

  onCleanup(() => {
    alive = false
    idleAnim?.destroy()
    trackingAnim?.destroy()
    idleAnim = undefined
    trackingAnim = undefined
  })

  // tweb `focus`/`blur` :24-33 — playAnimation(1)/playAnimation(0). `on(..., {defer:true})`
  // пропускает срабатывание на подписке (текущее значение аксессора при монтировании),
  // реагирует только на РЕАЛЬНУЮ смену фокуса — у оригинала тоже нет вызова до первого
  // настоящего события.
  createEffect(
    on(
      () => props.focused(),
      (focused) => playAnimation(focused ? 1 : 0),
      { defer: true },
    ),
  )

  // tweb `input` :35-40 — `fastRaf(() => playAnimation(frac * max))`, frac = (1 +
  // value.length) / options.length. `defer:true` по той же причине, что у фокуса.
  createEffect(
    on(
      () => props.value(),
      (value) => {
        fastRaf(() => {
          const frac = (1 + value.length) / props.length
          playAnimation(frac * MAX)
        })
      },
      { defer: true },
    ),
  )

  return (
    <div class="media-sticker-wrapper">
      <div ref={idleHost} style={{ width: `${props.size}px`, height: `${props.size}px` }} />
      <div ref={trackingHost} style={{ width: `${props.size}px`, height: `${props.size}px` }} />
    </div>
  )
}
