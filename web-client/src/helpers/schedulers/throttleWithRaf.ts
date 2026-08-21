// * Jolly Cobra's schedulers — порт tweb `helpers/schedulers/throttleWithRaf.ts` 1:1.
import type { AnyToVoidFunction } from '@types'
import { fastRaf } from '@helpers/schedulers'
import throttleWith from '@helpers/schedulers/throttleWith'

export default function throttleWithRaf<F extends AnyToVoidFunction>(fn: F) {
  return throttleWith(fastRaf, fn)
}
