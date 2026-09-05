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
// У нас обе исходные json-ки (`TwoFactorSetupMonkeyIdle.json`/
// `TwoFactorSetupMonkeyTracking.json`) с Этапа 0 плана «один движок lottie»
// (docs/superpowers/plans/2026-09-05-lottie-single-engine.md) лежат на той же
// статике `public/assets/tgs/`, что и у оригинала, но эта обезьянка ещё не
// переведена на tlottie/`LottieAnimation` — привязка по-прежнему `lottie-web`
// через `components/lottie.ts::loadLottie()` + `loadTgsAsset()` (fetch с той
// же статики вместо бандл-`import()`), тем же приёмом, что у `PasswordMonkey.
// tsx` (React, вторая обезьянка) и `MediaHeader.solid.tsx::StickerLottie`
// (тот же приём уже на Solid). Перевод на tlottie — Этапы 1-3 плана. Само
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
import { loadLottie, loadTgsAsset } from '../lottie'

const ASSETS = {
  idle: () => loadTgsAsset('TwoFactorSetupMonkeyIdle'),
  tracking: () => loadTgsAsset('TwoFactorSetupMonkeyTracking'),
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
  /** РЕАЛЬНОЕ текущее значение поля — читается ОДИН РАЗ, в момент завершения
   *  загрузки tracking-анимации (tweb `load()` :129-131: `!inputField.value.
   *  length` решает, скрыта ли канва с самого начала). НЕ реактивный источник
   *  движения кадра: значение может смениться и программным сбросом (карточка
   *  кода чистит поле на неверном коде), а такой сброс НЕ должен двигать
   *  обезьянку — см. `typedValue` ниже и находку ревью в докблоке компонента. */
  value: () => string
  /** значение поля В МОМЕНТ настоящего пользовательского ввода — источник
   *  движения кадра (аналог DOM-события `input` на `inputField.input` у
   *  оригинала, `tracking.ts:35-40`). Обязан ходить ТОЛЬКО из обработчика
   *  реального `input`-события (в нашем дереве — `CodeInput.solid.tsx`'s
   *  `onChange`, который сам зовётся исключительно из `handleInput`, а тот
   *  навешен на настоящее DOM-событие `input`), а не из общего сигнала
   *  «текущее значение поля»: `AuthCodeCard.solid.tsx` пишет `value` ещё и
   *  программным сбросом при неверном коде (`setValue('')` в `catch`), и это
   *  присваивание — ПРЯМОЙ аналог tweb `codeInputField.value = ''`
   *  (AuthCodeCard.tsx:126/147): такое присваивание `.value` в браузере НЕ
   *  порождает событие `input`, поэтому оригинальный листенер тоже на него не
   *  реагирует. Если этот проп когда-нибудь склеят обратно с `value`,
   *  обезьянка снова начнёт «откатывать» кадр назад на каждом сбросе поля —
   *  пин на регресс: `AuthCodeCard.solid.test.tsx` →
   *  «программный сброс значения (неверный код) НЕ доводит до
   *  playAnimation». */
  typedValue: () => string
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

  // tweb `focus`/`blur` :24-33 — playAnimation(1)/playAnimation(0).
  //
  // `on(..., {defer:true})` пропускает срабатывание на подписке (текущее
  // значение аксессора в момент монтирования) — конечный ВИДИМЫЙ эффект тот
  // же, что у tweb (автофокус карточки не дёргает обезьянку раньше времени),
  // но причина у нас ДРУГАЯ, не путать. У tweb это не «событие ненастоящее»
  // (DOM-событие `focus` всегда настоящее) — это гонка загрузки: `load()`
  // асинхронный, а фокус на поле ставит `focusWhenConnected` (AuthCodeCard.
  // tsx:308, `helpers/dom/focusWhenConnected.ts`) отложенно, через
  // requestAnimationFrame-цикл, ждущий, пока узел окажется в DOM — то есть
  // МИНИМУМ кадром позже монтирования `TrackingMonkey`. Если к моменту этого
  // (отложенного) `focus()` анимация ещё не догрузилась, `playAnimation`
  // молча выходит по гварду `if(!this.animation) return` (:55) — обезьянка
  // просто не успевает среагировать, а не «не должна». У нас же `defer:true`
  // нужен по СВОЕЙ причине: `AuthCodeCard.solid.tsx`'s `onMount` вызывает
  // `codeInputEl.focus()` СИНХРОННО при маунте, и это успевает установить
  // сигнал `focused` в `true` ДО первого прохода этого эффекта (Solid
  // регистрирует эффект первым в очереди — уже во время рендера JSX-дерева
  // компонент ещё не существует), так что без `defer` эффект принял бы этот
  // стартовый `true` за «смену» и увёл бы кадр, хотя реальной пользовательской
  // смены фокуса ещё не было.
  createEffect(
    on(
      () => props.focused(),
      (focused) => playAnimation(focused ? 1 : 0),
      { defer: true },
    ),
  )

  // tweb `input` :35-40 — `fastRaf(() => playAnimation(frac * max))`, frac = (1 +
  // value.length) / options.length. Источник — `typedValue`, а НЕ `value` (см.
  // разбор различия в докблоке пропов выше: `value` меняется и программным
  // сбросом поля, который у оригинала не рождает DOM-событие `input` и монстра
  // не двигает — находка ревью, покрыта `AuthCodeCard.solid.test.tsx` →
  // «программный сброс значения... НЕ доводит до playAnimation»).
  // `defer:true` — та же техническая причина, что у фокуса чуть выше:
  // пропустить срабатывание на ПОДПИСКЕ (стартовое значение аксессора), а не
  // имитировать «настоящесть» события.
  createEffect(
    on(
      () => props.typedValue(),
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
