/**
 * Порт tweb `src/helpers/solid/renderComponent.tsx:1-29` (812502980) — Solid-
 * компонент в готовый узел императивного кода (или в корень без узла), снятие —
 * на `onDestroy` переданной миддлвари. Первый потребитель — вкладка «Изменить
 * контакт» (`sidebarRight/tabs/editContact.solid.tsx`, строки уведомлений и
 * телефона, tweb `editContact.tsx:239-287`).
 *
 * Расхождения с оригиналом:
 *  1. `HotReloadGuard` (`:10`, `:20-22`) нет — обвязка их дев-сборки, та же
 *     причина, что у `scaffoldSolidJSTab.solid.tsx` (шапка файла).
 *  2. Файл `.ts`, а не `.tsx`: JSX-обёртка `<Component {...props} />` у
 *     оригинала — это ровно `createComponent(Component, props)`, а `.tsx` вне
 *     маски `*.solid.tsx` у нас собирает React-плагин
 *     (`shared/solid/fileRuntime.ts`).
 */
import { createComponent, createRoot, type Component } from 'solid-js'
import { render } from 'solid-js/web'
import type { Middleware } from '@helpers/middleware'

type RenderComponentArgs<T extends object> = {
  element?: HTMLElement,
  Component: Component<T>,
  middleware: Middleware
} & (keyof T extends never ? { props?: T } : { props: T })

export const renderComponent = <T extends object>({
  element,
  Component,
  props,
  middleware,
}: RenderComponentArgs<T>) => {
  const ToRender = () => createComponent(Component, props || ({} as T))

  const dispose = element ?
    render(ToRender, element) :
    createRoot((dispose) => { ToRender(); return dispose })

  middleware.onDestroy(() => dispose())
}
