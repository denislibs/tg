// Порт tweb `src/helpers/solid/createAnimatedValue.ts` (47 строк) — 1:1.
// Solid-аналог React-хука `components/virtual/useAnimatedTop.ts` (тот же
// оригинал, портированный ранее под React); здесь форма оригинала — сигналы
// `current`/`animating`, потребитель кладёт их в стиль сам.
//
// `simpleEasing` у tweb лежит в `helpers/animateValue`, у нас — в
// `helpers/easings.ts` (туда его положил порт `useAnimatedTop`).
import { createEffect, createSignal, on, onCleanup, type Accessor } from 'solid-js'
import { simpleEasing } from '@helpers/easings'
import { animate } from '@helpers/animation'

export default function createAnimatedValue(
  value: Accessor<number>,
  time: number,
  easing: (t: number) => number = simpleEasing,
  shouldAnimate: Accessor<boolean> = () => true,
) {
  const [current, setCurrent] = createSignal(value())
  const [animating, setAnimating] = createSignal(false)

  createEffect(on(value, () => {
    if(!shouldAnimate()) {
      setCurrent(value())
      return
    }

    const startValue = current()
    const startTime = performance.now()
    setAnimating(true)

    let cleaned = false

    animate(() => {
      if(cleaned) return

      const progress = easing(Math.min(1, (performance.now() - startTime) / time))

      setCurrent((value() - startValue) * progress + startValue)

      if(progress < 1) return true
      setAnimating(false)
    })

    onCleanup(() => {
      cleaned = true
      setAnimating(false)
    })
  }, {
    defer: true,
  }))

  const result = current as Accessor<number> & { animating: Accessor<boolean> }

  result.animating = animating

  return result
}
