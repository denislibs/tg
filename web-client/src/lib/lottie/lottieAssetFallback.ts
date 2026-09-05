// Часть 2 задачи «фолбэк без WASM SIMD» (web-client/backlogs/frontend/
// lottie-no-wasm-fallback.md): без SIMD `lottieLoader.loadAnimationAsAsset`
// отклоняется с NO_WASM ДО первого кадра (`lottieLoader.ts:215-216`) — канва в
// DOM не появляется вовсе (`lottiePlayer.ts:1207` — аппендится только на первом
// реально отрисованном кадре). У 11 встроенных ассетов (`public/assets/tgs/
// *.json` — обезьянки, уточки, папки, ключ, конверт) нет и не будет серверного
// превью, зато первый кадр отрисован ЗАРАНЕЕ, на сборке
// (`scripts/generate-tgs-thumbnails.mjs`, тем же движком tlottie.wasm) и лежит
// PNG рядом с json.
//
// Единственная точка вставки — `lottieLoader.loadAnimationAsAsset` (см. правку
// там же): все пять мест показа (`PasswordMonkey.tsx`, `TrackingMonkey.solid.
// tsx`, `LottieSticker.tsx`, `lottieAnimation.solid.tsx` и через него
// `MediaHeader.solid.tsx`) зовут именно её — один способ деградации на всех
// пятерых, а не пять копий одной и той же логики по вызывающим.
import type { LottieAssetName } from './lottieLoader'

const FALLBACK_CLASS = 'lottie-asset-fallback'

/** URL PNG первого кадра — рядом с json, тот же паттерн, что и `makeAssetUrl`. */
export function makeAssetPngUrl(name: LottieAssetName): string {
  return 'assets/tgs/' + name + '.png'
}

/**
 * Вставляет статичный первый кадр вместо анимации, которую tlottie не смог
 * декодировать (NO_WASM). Идемпотентно на контейнер: `TrackingMonkey.solid.tsx`
 * грузит ДВЕ анимации (idle + tracking) в ОДИН `container` — без гварда второй
 * вызов добавил бы второй `<img>` рядом с первым (оба block-level, обычный
 * поток — они бы просто сложились по вертикали, а не легли друг на друга, как
 * canvas'ы, что реально переключаются `display:none`/`''`). Первый вызов
 * побеждает: у пары idle/tracking это ОДИН и тот же монитор одной сцены, кадр
 * которой не разъезжается по смыслу с любым из двух PNG.
 *
 * Не у ВСЕХ 41 имени `LottieAssetName` есть PNG — тип вендорен 1:1 с tweb
 * (docs/superpowers/plans/2026-09-05-lottie-single-engine.md, «41 имя мертво
 * целиком»), собран PNG только для тех 11, что реально используются. Файл не
 * найден (404) — `onerror` тихо убирает `<img>`: место остаётся пустым, как
 * было бы без этого фолбэка, а не битой иконкой раздора.
 */
export function renderStaticAssetFallback(container: HTMLElement | HTMLElement[], name: LottieAssetName): void {
  const containers = Array.isArray(container) ? container : [container]
  for (const el of containers) {
    if (!el || el.querySelector(`.${FALLBACK_CLASS}`)) continue
    const img = document.createElement('img')
    img.className = FALLBACK_CLASS
    img.style.display = 'block'
    img.style.width = '100%'
    img.style.height = '100%'
    img.style.objectFit = 'contain'
    img.decoding = 'async'
    img.alt = ''
    img.onerror = () => img.remove()
    img.src = makeAssetPngUrl(name)
    el.appendChild(img)
  }
}
