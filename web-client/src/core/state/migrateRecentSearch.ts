// Разовый перенос «недавних» из localStorage в State.
//
// Раньше список недавних чатов в глобальном поиске жил в
// `localStorage['recentSearch']` (SearchView), в обход State — при том, что
// ключ такого же имени в схеме уже был объявлен и пустовал. Теперь фича на
// State, а накопленное у пользователей надо перенести, а не потерять: та же
// конвенция, что у миграций IndexedDB в `core/store/persist.ts` — шаг
// расширяет и переливает, но не стирает данные пользователя.
//
// Переносим ТОЛЬКО если State по этому ключу пуст: иначе более свежее значение
// (например, приехавшее зеркалом из соседней вкладки) затёрлось бы старьём.
// Ключ localStorage после переноса удаляем — второй раз шаг не сработает, и
// файл можно будет выпилить, когда пользователи прогреются.
import { useAppStateStore, setAppState } from '../../stores/appState'

const LEGACY_KEY = 'recentSearch'

export function migrateRecentSearchFromLocalStorage(): void {
  let legacy: unknown
  try {
    const raw = localStorage.getItem(LEGACY_KEY)
    if (!raw) return
    legacy = JSON.parse(raw)
  } catch {
    // Битый JSON — переносить нечего; ключ убираем, чтобы не спотыкаться о него.
    try { localStorage.removeItem(LEGACY_KEY) } catch { /* приватный режим */ }
    return
  }

  const ids = Array.isArray(legacy) ? legacy.filter((x): x is string => typeof x === 'string') : []
  if (ids.length && !useAppStateStore.getState().recentSearch.length) {
    setAppState('recentSearch', ids.slice(0, 20))
  }
  try { localStorage.removeItem(LEGACY_KEY) } catch { /* приватный режим */ }
}
