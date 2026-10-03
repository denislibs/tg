// Порт tweb `src/helpers/solid/createUnifiedSignal.ts` (812502980): сигнал одной
// функцией — без аргумента читает, с аргументом пишет. Расхождение под strict:
// запись идёт значением (`setter(() => value)`), а не «значение или апдейтер» —
// у потребителей (`Chat.searchSignal`) значение всегда объект или `undefined`.
import { createSignal } from 'solid-js'

/**
 * do not use getter in JSX
 */
export type UnifiedSignal<T> = {
  (): T
  (value: T): T
}

export default function createUnifiedSignal<T>(value?: T): UnifiedSignal<T> {
  const [getter, setter] = createSignal<T>(value as T)
  function signal(): T
  function signal(value: T): T
  function signal(...args: [] | [T]): T {
    if(args.length === 0) {
      return getter()
    }

    return setter(() => args[0] as T)
  }

  return signal
}
