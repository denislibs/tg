/** @jsxImportSource solid-js */
// TrackingMonkey — обезьянка на карточке ввода кода подтверждения. Порт tweb
// `src/components/monkeys/tracking.ts` (164 строки, целиком, дословно —
// оригинал уже написан под tlottie): один tlottie-контейнер `div.media-
// sticker-wrapper` с ДВУМЯ канвами внутри (idle-луп + tracking); на фокусе
// поля обезьянка открывает глаза и «отслеживает» набор цифр — кадр tracking-
// анимации считается от доли набранного кода.
//
// Движок — tlottie (`lottieLoader.loadAnimationAsAsset`, SIMD-декод в
// воркере), ассет — по URL `assets/tgs/<name>.json` (Этап 0 плана «один
// движок lottie», docs/superpowers/plans/2026-09-05-lottie-single-engine.md).
// Обе анимации делят ОДИН `container` (tweb :19-20/:104/:121 — `this.
// container` передаётся в оба `loadAnimationAsAsset`), тлотти сама кладёт
// каждый `canvas` внутрь него (`LottiePlayer.canvas[0]`), а видимость
// переключается на самой канве (`canvas[0].style.display`), а не на
// обёртке — идентично оригиналу, отдельного host-`div` на анимацию больше
// нет (это было отступление версии на `lottie-web`, у `AnimationItem` такого
// поля не было).
//
// Ручной подсчёт кадров через `enterFrame`+`needFrame` — НЕ отступление: у
// `LottiePlayer` есть готовые `playPart`/`playToFrame` (tweb
// `lottiePlayer.ts:1068-1119`), но сам оригинал `tracking.ts` ими не
// пользуется — считает кадр вручную и сравнивает в `enterFrame` (:133-152).
// Порт повторяет ровно это.
import { createEffect, on, onCleanup, onMount, type JSX } from 'solid-js'
import lottieLoader from '@lib/lottie/lottieLoader'
import type LottiePlayer from '@lib/lottie/lottiePlayer'
import { fastRaf } from '@helpers/schedulers'

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
  let containerEl: HTMLDivElement | undefined

  let idleAnim: LottiePlayer | undefined
  let trackingAnim: LottiePlayer | undefined
  // Гонка «ассет догрузился после размонтирования» (два независимых
  // `loadAnimationAsAsset`) — общий `alive`-флаг перед записью в замыкание,
  // тем же приёмом, что `PasswordMonkey.tsx`.
  let alive = true

  // `needFrame` — класс-поле tweb (`protected needFrame = 0`). Направление
  // отдельным полем НЕ дублируем: `LottiePlayer.direction` (tweb :137-138
  // читает именно `this.animation.direction`, не своё поле) — источник
  // истины один, как в оригинале.
  let needFrame = 0

  // tweb `playAnimation` целиком (:54-98) — общая точка входа и для focus/blur,
  // и для input.
  const playAnimation = (rawLength: number) => {
    if (!trackingAnim) return

    const frame = computeTrackingFrame(rawLength, MAX)

    if (frame) {
      if (idleAnim) {
        idleAnim.stop(true)
        idleAnim.canvas[0].style.display = 'none'
      }
      trackingAnim.canvas[0].style.display = ''
    }

    const step = computeTrackingStep(needFrame, frame)
    trackingAnim.setDirection(step.direction)
    if (step.resetSpeed) trackingAnim.setSpeed(7)
    needFrame = frame

    trackingAnim.play()
  }

  onMount(() => {
    if (!containerEl) return
    const container = containerEl

    // tweb `load()` :100-158 — два независимых лоадера в `Promise.all`, порядок
    // резолва не гарантирован, поэтому каждая ветка пишет только СВОЙ ref и не
    // зависит от соседней. ОБА делят один и тот же `container` (tweb :104/:121
    // — `this.container`), tlottie сама кладёт canvas каждой анимации внутрь
    // него.
    //
    // Деградация без WASM SIMD (решение плана «один движок lottie», раздел
    // «Решение по деградации без WASM SIMD»): `loadAnimationAsAsset` бросает
    // `NO_WASM` (`lib/lottie/lottieLoader.ts:216`), канва в DOM не появляется
    // (`lib/lottie/lottiePlayer.ts:1207` — аппендится только на первом кадре) —
    // idle-обезьянка просто не показывается, как в оригинале. Долг на случай,
    // если такой хвост браузеров окажется важен:
    // `web-client/backlogs/frontend/lottie-no-wasm-fallback.md`.
    const idleLoad = lottieLoader
      .loadAnimationAsAsset(
        { container, loop: true, autoplay: true, width: props.size, height: props.size },
        'TwoFactorSetupMonkeyIdle',
      )
      .then((animation) => {
        if (!alive) {
          animation.remove()
          return
        }
        idleAnim = animation

        // tweb :113-115 — играть сразу, если поле уже пустое к моменту загрузки.
        if (!props.value().length) animation.play()

        return lottieLoader.waitForFirstFrame(animation)
      })

    // Та же деградация NO_WASM, что у idle-загрузки выше.
    const trackingLoad = lottieLoader
      .loadAnimationAsAsset(
        { container, loop: false, autoplay: false, width: props.size, height: props.size },
        'TwoFactorSetupMonkeyTracking',
      )
      .then((animation) => {
        if (!alive) {
          animation.remove()
          return
        }
        trackingAnim = animation

        // tweb :129-131 — при пустом значении поля tracking-канва скрыта с самого начала.
        if (!props.value().length) animation.canvas[0].style.display = 'none'

        animation.addEventListener('enterFrame', (currentFrame: number) => {
          if (shouldPauseOnFrame(animation.direction as 1 | -1, currentFrame, needFrame)) {
            animation.setSpeed(1)
            animation.pause()
          }

          // tweb :143-151 — возврат к idle-лупу строго на нулевом кадре и только
          // если idle вообще загружена (та же проверка, что в оригинале).
          if (currentFrame === 0 && needFrame === 0 && idleAnim) {
            idleAnim.canvas[0].style.display = ''
            idleAnim.play()
            animation.canvas[0].style.display = 'none'
          }
        })

        return lottieLoader.waitForFirstFrame(animation)
      })

    // Реджект любой загрузки (NO_WASM/сеть) гасим ЗДЕСЬ, в одном месте — приём
    // `StickerMedia.tsx:282`, а не россыпью `.catch(() => {})` по каждому чейну.
    void Promise.all([idleLoad, trackingLoad]).catch(() => {})
  })

  onCleanup(() => {
    alive = false
    idleAnim?.remove()
    trackingAnim?.remove()
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
    <div
      ref={containerEl}
      class="media-sticker-wrapper"
      style={{ width: `${props.size}px`, height: `${props.size}px` }}
    />
  )
}
