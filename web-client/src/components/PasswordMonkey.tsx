// PasswordMonkey — обезьянка на экранах пароля. Порт tweb
// `components/monkeys/password.ts` (62 строки, целиком, дословно — оригинал
// уже написан под tlottie): одна анимация `TwoFactorSetupMonkeyPeek` в
// `container` (`div.media-sticker-wrapper`), tlottie сама кладёт canvas
// внутрь него (`LottiePlayer.canvas[0]`) — отдельного host-`div` нет, как и
// в оригинале (это было отступление версии на `lottie-web`). Закрывает глаза
// лапами; когда пароль показан «глазком» — подглядывает.
//
// Кадр 0→16 (открыть)/16→0 (закрыть) — ручной подсчёт через `enterFrame`+
// `needFrame`, как в оригинале (:29-51), а НЕ `playSegments`/`playPart`:
// `LottiePlayer` даёт готовые `playPart`/`playToFrame`
// (tweb `lottiePlayer.ts:1068-1119`), но `password.ts` ими не пользуется —
// задаёт `direction`/`curFrame`/`needFrame` вручную и зовёт `play()`, а
// `enterFrame`-листенер сам останавливает подыгрывание на цели. Порт
// повторяет ровно это, а не сокращает до `playSegments` (было отступлением
// версии на `lottie-web`, у которой не было ручного `needFrame`).
import { useEffect, useRef } from 'react'
import lottieLoader from '@lib/lottie/lottieLoader'
import type LottiePlayer from '@lib/lottie/lottiePlayer'

const PEEK_FRAME = 16 // tweb PasswordMonkey: сегмент [0..16] — раскрыть глаза

export default function PasswordMonkey({ peeking, size = 130 }: { peeking: boolean; size?: number }) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const animRef = useRef<LottiePlayer | null>(null)
  const needFrameRef = useRef(0)

  useEffect(() => {
    let alive = true
    const container = wrapRef.current
    if (!container) return

    // Деградация без WASM SIMD (backlogs/frontend/lottie-no-wasm-fallback.md,
    // часть 2 — закрыта): `loadAnimationAsAsset` бросает `NO_WASM`
    // (`lib/lottie/lottieLoader.ts:216`), канва в DOM не появляется
    // (`lib/lottie/lottiePlayer.ts:1207`) — но сама `loadAnimationAsAsset`
    // вставляет в `container` статичный PNG первого кадра ДО реджекта
    // (`lib/lottie/lottieAssetFallback.ts`), поэтому обезьянка не пропадает
    // совсем, а перестаёт подглядывать (кадр статичный).
    const load = lottieLoader
      .loadAnimationAsAsset(
        { container, loop: false, autoplay: false, width: size, height: size, noCache: true },
        'TwoFactorSetupMonkeyPeek',
      )
      .then((animation) => {
        if (!alive) {
          animation.remove()
          return
        }
        animRef.current = animation

        // tweb :29-36 — останавливаем подыгрывание, когда добрались до цели
        // (`needFrame`); `direction`/`curFrame` читаются с самого плеера, как
        // в оригинале (`this.animation.direction`).
        animation.addEventListener('enterFrame', (currentFrame: number) => {
          const needFrame = needFrameRef.current
          if (
            (animation.direction === 1 && currentFrame >= needFrame) ||
            (animation.direction === -1 && currentFrame <= needFrame)
          ) {
            animation.setSpeed(1)
            animation.pause()
          }
        })

        return lottieLoader.waitForFirstFrame(animation)
      })

    // Реджект (NO_WASM/сеть) гасим ЗДЕСЬ, в одном месте — приём
    // `StickerMedia.tsx:282`, а не россыпью `.catch(() => {})`.
    void load.catch(() => {})

    return () => {
      alive = false
      animRef.current?.remove()
      animRef.current = null
    }
  }, [size])

  const first = useRef(true)
  useEffect(() => {
    const anim = animRef.current
    if (!anim) return
    if (first.current && !peeking) return // стартовое состояние — глаза закрыты
    first.current = false

    // tweb :39-51 — ручной перевод: направление + стартовый кадр + цель, сам
    // `play()` двигает плеер, а `enterFrame`-листенер выше тормозит на цели.
    if (peeking) {
      anim.setDirection(1)
      anim.curFrame = 0
      needFrameRef.current = PEEK_FRAME
    } else {
      anim.setDirection(-1)
      anim.curFrame = PEEK_FRAME
      needFrameRef.current = 0
    }
    anim.play()
  }, [peeking])

  // width/height контейнера — раскладка ДО первого кадра (canvas ложится в
  // DOM только когда анимация реально прогрузилась, `lottiePlayer.ts:1207`);
  // сам размер канвы задаётся явно в `loadAnimationAsAsset` (width/height:
  // size), а не читается с контейнера.
  // Отступление от tweb: `margin: 0 auto` — обезьянку зовут ещё два экрана
  // (пасскод, 2FA в настройках), где центрировать её больше некому.
  return (
    <div
      ref={wrapRef}
      className="media-sticker-wrapper"
      style={{ width: size, height: size, margin: '0 auto' }}
    />
  )
}
