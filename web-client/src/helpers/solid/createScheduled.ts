// Порт tweb `src/helpers/solid/createScheduled.ts` (812502980) — значение
// сигнала, пропущенное через планировщик (throttle).
//
// Расхождения с оригиналом:
//  1. Только `createScheduled` и `createThrottled`: `createDebounced` никто не
//     зовёт (первый потребитель — `saveButton.solid.tsx`).
//  2. `track(value)` (`helpers/solid/track.ts` — функция-аннотация, просто
//     вызывает аргумент) — прямым вызовом `value()`.
import { createEffect, createSignal, type Accessor } from 'solid-js'
import throttle from '@helpers/schedulers/throttle'

export function createScheduled<T>(value: Accessor<T>, scheduleWith: (callback: () => void) => () => void) {
  const [scheduledValue, setScheduledValue] = createSignal(value())

  const scheduledSet = scheduleWith(() => setScheduledValue(() => value()))

  createEffect(() => {
    value()
    scheduledSet()
  })

  return scheduledValue
}

export function createThrottled<T>(value: Accessor<T>, delayMs: number, shouldRunFirst?: boolean) {
  return createScheduled(value, (callback) => throttle(callback, delayMs, shouldRunFirst))
}
