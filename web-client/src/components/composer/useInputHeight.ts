// src/components/composer/useInputHeight.ts
// Рост инпута по содержимому — механика tweb `components/inputFieldAnimated.ts`
// (:37-41 фейк-инпут, :51-98 пересчёт) + `chat/input.ts:2876-2899` (max-height).
//
// Почему фейк: у реального инпута высота зафиксирована инлайном, поэтому его
// `scrollHeight` не показывает «сколько нужно». Фейк — тот же HTML при
// `height:auto` (CSS `.input-field-input-fake`, _input.scss:210-224), его
// `scrollHeight` и есть цель.
//
// Длительность анимации у tweb ВЫЧИСЛЯЕМАЯ и пишется инлайном:
//   duration = round(50 * ln(|newHeight − currentHeight|))  (inputFieldAnimated.ts:62-65)
// — 21px (строка) → 152 ms, 42px → 187 ms. CSS-значение `.1s` (_chat.scss:1087)
// служит только фолбэком до первого пересчёта.
import { useCallback, useEffect, type RefObject } from 'react'

// input.ts:2880-2884
const MAX_HEIGHT_DEFAULT = 440
const MAX_HEIGHT_MOBILE = 160
const MAX_HEIGHT_MIN = 36
const SHORT_VIEWPORT_HEIGHT = 480
const SHORT_VIEWPORT_RESERVED = 160
/** input.ts:2909 — высота одной строки (16px шрифт, 21px интерлиньяж + .5rem паддингов) */
export const DEFAULT_INPUT_HEIGHT = 37

const TRANSITION_DURATION_FACTOR = 50 // inputFieldAnimated.ts:62

// input.ts:2886-2895. Мобильный порог — `mediaSizes.isMobile`, у tweb это брейкпоинт
// handhelds (600px); у нас медиа-запросы партиалов на нём же.
function computeMaxHeight(): number {
  if (window.innerWidth <= 600) return MAX_HEIGHT_MOBILE
  if (window.innerHeight <= SHORT_VIEWPORT_HEIGHT) {
    return Math.max(MAX_HEIGHT_MIN, window.innerHeight - 2 * 16 - SHORT_VIEWPORT_RESERVED)
  }
  return MAX_HEIGHT_DEFAULT
}

/**
 * Возвращает `autosize()` — пересчёт высоты инпута по фейку.
 * @param onChangeHeight input.ts:2910-2913 — публикация высоты наверх (сурплюс ленты).
 */
export function useInputHeight(
  inputRef: RefObject<HTMLDivElement | null>,
  fakeRef: RefObject<HTMLDivElement | null>,
) {
  const autosize = useCallback(() => {
    const input = inputRef.current
    const fake = fakeRef.current
    if (!input || !fake) return

    // inputFieldAnimated.ts:100-110 — фейк повторяет содержимое реального инпута.
    // Копируем узлами (не строкой разметки): рендерить пользовательский ввод как
    // HTML-строку запрещено (CLAUDE.md, «Безопасность»).
    fake.replaceChildren(...Array.from(input.childNodes, (n) => n.cloneNode(true)))

    const maxHeight = computeMaxHeight()
    input.style.maxHeight = `${maxHeight}px`
    const newHeight = Math.min(fake.scrollHeight, maxHeight)
    const currentHeight = parseFloat(input.style.height) || 0
    if (currentHeight === newHeight) return

    const duration = currentHeight
      ? Math.round(TRANSITION_DURATION_FACTOR * Math.log(Math.abs(newHeight - currentHeight)))
      : 0
    input.style.transitionDuration = `${duration}ms`
    input.style.height = newHeight ? `${newHeight}px` : ''
  }, [inputRef, fakeRef])

  // Стартовая высота одной строки + max-height (в дампе tweb это инлайн
  // `max-height: 440px; transition-duration: 0ms; height: 37px`), и пересчёт на resize
  // (input.ts:2924 — пересчёт max-height по `mediaSizes` resize).
  useEffect(() => {
    const input = inputRef.current
    if (!input) return
    input.style.maxHeight = `${computeMaxHeight()}px`
    input.style.transitionDuration = '0ms'
    input.style.height = `${DEFAULT_INPUT_HEIGHT}px`
    const onResize = () => autosize()
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [inputRef, autosize])

  return autosize
}
