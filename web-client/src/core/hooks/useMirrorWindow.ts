// src/core/hooks/useMirrorWindow.ts
//
// ЕДИНСТВЕННЫЙ мост из НЕреактивного зеркала окон (`core/history/messagesMirror.ts`)
// в React. Зеркало рассчитано на императивного потребителя — ленту
// `chat/bubbles.ts`, которая читает окно синхронно и перерисовывает то, о чём ей
// сказали события `rootScope`. React-потребителю нужен другой контракт:
// «перерисуйся, когда окно изменилось».
//
// Мост ОДИН на приложение и повторяет устройство двух соседних зеркал витрины —
// `core/hooks/usePeers.ts` над `core/peerCache.ts` и `chatFullMirrorVersion` над
// `core/chatFullCache.ts`: `useSyncExternalStore(subscribe, version)` + мемо по
// (ключ, версия). Заводить по мосту на компонент нельзя: подписка на
// `rootScope` в каждом хуке — это N независимых выводов одного факта «окно
// изменилось», каждый со своим фильтром по peerId и своим шансом промахнуться
// мимо типа события.
//
// Снимок — ЧИСЛО (версия), а не само окно: `getSnapshot` обязан возвращать
// стабильное значение между изменениями, а окно — массив, который зеркало
// пересобирает на каждой операции.
import { useMemo, useSyncExternalStore } from 'react'
import type { MyMessage } from '../models'
import { mirrorVersion, mirrorWindow, subscribeMirror } from '../history/messagesMirror'

// Одна и та же ссылка на «окна нет» — иначе каждый рендер отдавал бы новый
// массив и мемоизация у потребителя рвалась бы вхолостую.
const EMPTY: readonly MyMessage[] = []

/**
 * Окно зеркала по ключу (`winKey(peerId, threadRootId)`), с перерисовкой на
 * каждое его изменение. `null` — читать нечего (чат не открыт / не настоящий);
 * окно, о котором зеркало ещё ничего не знает, отдаётся пустым массивом.
 */
export function useMirrorWindow(key: string | null): readonly MyMessage[] {
  const version = useSyncExternalStore(subscribeMirror, mirrorVersion)
  // `version` в зависимостях — не «лишняя переменная», а ключ инвалидации:
  // само окно читается императивно (`mirrorWindow`), и другого признака его
  // изменения у мемо нет. Тот же приём и та же подавленная проверка — в
  // `usePeers` над зеркалом пиров.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => (key == null ? EMPTY : mirrorWindow(key) ?? EMPTY), [key, version])
}
