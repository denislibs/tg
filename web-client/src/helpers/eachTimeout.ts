// Порт tweb `src/helpers/eachTimeout.ts` (812502980). Отличие одно — стиль
// репозитория: без точек с запятой и с `unknown` вместо `any` у колбэка.
import ctx from '@environment/ctx'
import noop from '@helpers/noop'

// It's better to use timeout instead of interval, because interval can be corrupted
export default function eachTimeout(callback: () => unknown, getNextTimeout: () => number, runFirst = true) {
  const cancel = () => {
    clearTimeout(timeout)
  }

  // replace callback to run noop and restore after
  const _callback = callback
  if(!runFirst) {
    callback = noop
  }

  let timeout: number
  const run = () => {
    callback()
    timeout = ctx.setTimeout(run, Math.max(0, getNextTimeout()))
  }
  run()

  callback = _callback

  return cancel
}
