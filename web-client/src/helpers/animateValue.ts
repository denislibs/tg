// Порт tweb `helpers/animateValue.ts` — покадровая анимация скалярa (или вектора)
// по кривой. Нужен раскрытию медиа-спойлера: `DotRenderer.revealWithAnimation`
// гонит через него прогресс, а тот вырезает растущий круг на подложке-превью.
//
// отступление от tweb: вместо `@helpers/solid/requestRAF` — `fastRaf`
// (`@helpers/schedulers`). requestRAF оригинала это тот же коалесинг колбэков в
// один rAF, обёрнутый в `batch()` из solid-js; solid-js в нашем стеке нет
// (реактивных сигналов, которые нужно батчить, тоже) — остаётся ровно fastRaf,
// который у нас и есть.
import { defaultEasing } from '@helpers/easings'
import { lerp } from '@helpers/lerp'
import { fastRaf } from '@helpers/schedulers'

interface AnimateValueOptions {
  easing?: (progress: number) => number
  onEnd?: () => void
}

export { simpleEasing } from '@helpers/easings'

export function animateValue<T extends number | number[]>(
  start: T,
  end: T,
  duration: number,
  callback: (value: T) => void,
  { easing = defaultEasing, onEnd = () => {} }: AnimateValueOptions = {},
) {
  let startTime: number | undefined
  let canceled = false

  function animateFrame() {
    if (canceled) return
    const currentTime = performance.now()
    if (!startTime) startTime = currentTime

    const elapsed = currentTime - startTime
    const progress = Math.min(elapsed / duration, 1)
    const easedProgress = easing(progress)

    if (start instanceof Array && end instanceof Array) {
      const currentValues = start.map((startVal, index) => lerp(startVal, end[index], easedProgress))
      callback(currentValues as T)
    } else {
      callback(lerp(start as number, end as number, easedProgress) as T)
    }

    if (progress < 1) {
      fastRaf(animateFrame)
    } else {
      onEnd()
    }
  }

  fastRaf(animateFrame)

  return () => {
    canceled = true
  }
}
