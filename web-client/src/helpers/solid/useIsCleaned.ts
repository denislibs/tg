// Порт tweb `src/hooks/useIsCleaned.ts` (812502980) 1:1 — признак «владелец уже
// снят» для колбэков, переживающих компонент (кадры анимации, rAF).
import { onCleanup } from 'solid-js'

export function useIsCleaned() {
  let isCleaned = false

  onCleanup(() => {
    isCleaned = true
  })

  return () => isCleaned
}
