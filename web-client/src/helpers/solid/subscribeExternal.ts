/**
 * Адаптер Solid к НЕреактивному источнику с подпиской — прямой аналог React
 * `useSyncExternalStore`. У нас уже есть `subscribeOn.ts` (тоже адаптер
 * «источник вовне, снимает подписку Solid»), но он умеет только DOM-события
 * (`addEventListener`/`removeEventListener` узла); здесь источник — обычный
 * модуль-зеркало со своей парой `subscribe(cb): unsubscribe` / `getSnapshot()`
 * (`core/peerCache.ts::subscribePeerMirror`/`peerMirrorVersion`,
 * `core/chatFullCache.ts::subscribeChatFullMirror`/`chatFullMirrorVersion`).
 * Такого приёма в проекте не было ни разу — заводится здесь для
 * `stores/peers.solid.ts` и `stores/fullPeers.solid.ts`.
 *
 * Снимок читается сразу (значение первого рендера) и обновляется сигналом при
 * каждом уведомлении подписки; `onCleanup` снимает подписку сам — как и у
 * `subscribeOn`, вызывающему свою чистку заводить не нужно.
 *
 * `setValue(() => getSnapshot())` — форма с функцией-обновлением: снимок может
 * сам оказаться функцией или объектом, у которого важна ссылочная идентичность
 * (наши зеркала отдают `User | Chat | undefined`), и `setValue(getSnapshot())`
 * трактовал бы функцию как обновляющий колбэк вместо значения.
 */
import { createSignal, onCleanup, type Accessor } from 'solid-js'

export function subscribeExternal<T>(
  subscribe: (onStoreChange: () => void) => () => void,
  getSnapshot: () => T,
): Accessor<T> {
  const [value, setValue] = createSignal<T>(getSnapshot())
  const unsubscribe = subscribe(() => setValue(() => getSnapshot()))
  onCleanup(unsubscribe)
  return value
}
