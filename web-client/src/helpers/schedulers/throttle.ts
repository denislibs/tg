// Порт tweb `helpers/schedulers/throttle.ts` — 1:1 по логике; правки только под
// наш строгий tsconfig (в tweb `strict` выключен):
//   • `args` объявлен с `| undefined` — до первого вызова его нет, под
//     `strictNullChecks` иначе ошибка;
//   • вместо двух `// @ts-ignore` над `fn(...args)` вызов идёт через
//     `fn.apply(null, args!)` (как в нашем порте `debounce.ts`) — рантайм тот же;
//   • `interval` типизирован `ReturnType<typeof setInterval>` вместо `number`
//     (в браузере это number, но тесты/vitest ходят через node-таймеры).
// Семантика оригинала сохранена целиком: `shouldRunFirst = true` — leading +
// trailing (первый вызов исполняется сразу, дальше не чаще, чем раз в `ms`, и
// последний накопленный аргумент доигрывается на следующем тике интервала);
// `shouldRunFirst = false` — trailing-only. `.clear()` снимает интервал.
// * Jolly Cobra's schedulers

import { AnyToVoidFunction } from '@types'

export type ThrottleReturnType<F extends AnyToVoidFunction> = {
  (...args: Parameters<F>): void
  clear(): void
}

export default function throttle<F extends AnyToVoidFunction>(
  fn: F,
  ms: number,
  shouldRunFirst = true,
): ThrottleReturnType<F> {
  let interval: ReturnType<typeof setInterval> | null = null
  let isPending: boolean
  let args: Parameters<F> | undefined

  const clear = () => {
    clearInterval(interval!)
    interval = null
  }

  const ret = (..._args: Parameters<F>) => {
    isPending = true
    args = _args

    if(!interval) {
      if(shouldRunFirst) {
        isPending = false
        fn.apply(null, args!)
      }

      interval = setInterval(() => {
        if(!isPending) {
          clear()
          return
        }

        isPending = false
        fn.apply(null, args!)
      }, ms)
    }
  }

  ret.clear = clear

  return ret
}
