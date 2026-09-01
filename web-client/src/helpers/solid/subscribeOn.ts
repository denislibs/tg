/**
 * Порт tweb `src/helpers/solid/subscribeOn.ts` — подписка на события узла,
 * живущая ровно столько же, сколько владелец Solid-эффекта: `onCleanup`
 * снимает её сам.
 *
 * Нужна там, где узел строит ИМПЕРАТИВНЫЙ класс, а слушает его Solid-компонент
 * (`components/checkboxFieldTsx.solid.tsx` слушает `checkboxField.input`), —
 * `ListenerSetter` там завести некуда, у Solid-компонента нет `destroy()`.
 */
import { onCleanup } from 'solid-js'
import type { ListenerElement } from '@helpers/listenerSetter'

export function subscribeOn<T extends ListenerElement>(obj: T): T['addEventListener'] {
  return ((event: string, callback: EventListenerOrEventListenerObject, options?: unknown) => {
    (obj as EventTarget).addEventListener(event, callback, options as AddEventListenerOptions)

    onCleanup(() => {
      (obj as EventTarget).removeEventListener(event, callback, options as EventListenerOptions)
    })
  }) as T['addEventListener']
}
