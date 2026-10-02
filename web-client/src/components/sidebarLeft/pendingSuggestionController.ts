// Порт tweb `src/components/sidebarLeft/pendingSuggestionController.ts`
// (812502980, 1-6) — дословно: вид плашки = реактивный «доступна ли» +
// компонент, который её рисует.
import type { JSX } from 'solid-js'

export type PendingSuggestionController = {
  available: () => boolean
  component: () => JSX.Element
}
