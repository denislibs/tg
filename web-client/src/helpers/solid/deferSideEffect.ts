// Порт tweb `src/helpers/solid/deferSideEffect.ts` (812502980) 1:1.
/**
 * Schedules a side effect to run in a microtask,
 * outside of the current reactive batch/effect.
 */
export default function deferSideEffect(callback: () => void) {
  queueMicrotask(callback)
}
