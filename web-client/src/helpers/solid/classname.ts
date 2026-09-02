/**
 * Порт tweb `src/helpers/solid/classname.tsx` — реактивная привязка списка
 * классов к узлу, который построил ИМПЕРАТИВНЫЙ код (у Solid для своих узлов
 * есть `classList`, а чужому узлу его не задать).
 *
 * Снимает ПРЕДЫДУЩЕЕ значение перед тем, как поставить новое, — иначе классы
 * накапливались бы на узле от рендера к рендеру.
 *
 * Расширение имени: у tweb файл `.tsx`, но JSX в нём нет ни строчки, а у нас
 * `.tsx` вне маски `*.solid.tsx` собирает React-плагин
 * (`shared/solid/fileRuntime.ts`) — расширение `.ts` и есть тот же файл в
 * нашей раскладке рантаймов.
 *
 * `attachHotClassName` оригинала (`:14-17`) НЕ портирована: она снимает классы
 * при hot-replace модуля, и её единственный смысл — `import.meta.hot`. Ветки
 * без вызывающего не заводим.
 */
import { createEffect, on } from 'solid-js'

export function attachClassName(element: HTMLElement, accessor: () => string | undefined) {
  createEffect(on(accessor, (value, prev) => {
    if(prev) {
      element.classList.remove(...prev.split(' '))
    }
    if(value) {
      element.classList.add(...value.split(' '))
    }
  }))
}
