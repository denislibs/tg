// Порт tweb `src/helpers/solid/requestRAF.ts` — 1:1 по логике (`void cb()`
// оригинала → `cb()`, `typescript/no-meaningless-void-operator`). Колбэки
// одного кадра собираются в пачку и исполняются под одним `batch`, чтобы
// записи в сигналы из нескольких `ResizeObserver` дали один пересчёт, а не по
// одному на узел.
import { batch } from 'solid-js'
import { fastRaf } from '@helpers/schedulers'

let rafCallbacks: Array<() => void> = []
let isRAFing = false

export function requestRAF(callback: () => void) {
  rafCallbacks.push(callback)

  const cleanup = () => {
    const index = rafCallbacks.indexOf(callback)
    if(index !== -1) rafCallbacks.splice(index, 1)
  }

  if(isRAFing) return cleanup

  isRAFing = true

  fastRaf(() => {
    const savedCallbacks = rafCallbacks

    rafCallbacks = []
    isRAFing = false

    batch(() => {
      savedCallbacks.forEach((cb) => cb())
    })
  })

  return cleanup
}
