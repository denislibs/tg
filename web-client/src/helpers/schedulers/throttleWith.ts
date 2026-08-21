// * Jolly Cobra's schedulers — порт tweb `helpers/schedulers/throttleWith.ts` 1:1.
// Отличия только под правила репозитория: без `;`, `any` → генерики.
import type { AnyToVoidFunction } from '@types'

export default function throttleWith<F extends AnyToVoidFunction>(
  schedulerFn: (callback: () => void) => void,
  fn: F,
  shouldRunFirst = false,
) {
  let isPending: boolean
  let waiting: number | undefined
  let args: Parameters<F>

  const ret = (..._args: Parameters<F>) => {
    isPending = true
    args = _args

    if(waiting) {
      return
    }

    if(shouldRunFirst) {
      isPending = false
      fn(...args)
    }

    const _waiting = waiting = Math.random()
    schedulerFn(() => {
      if(waiting !== _waiting) {
        return
      }

      ret.clear()
      if(!isPending) {
        return
      }

      isPending = false
      fn(...args)
    })
  }

  ret.clear = () => {
    waiting = undefined
  }

  return ret
}
