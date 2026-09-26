/** @jsxImportSource solid-js */
/**
 * Порт tweb `src/components/tabs.tsx:10-95` — Solid-разметка полосы вкладок
 * поверх классов `.menu-horizontal-*` (стили — `styles/tweb/_slider.scss:3-80`,
 * партиал оригинала). Поведения здесь нет: `active`, переезд подчёркивания и
 * слайдер содержимого вешает на готовую разметку `components/horizontalMenu.ts`.
 * Разбор — `docs/tweb/folders-tabs.md` § 1.3; эталон разметки — живой дамп
 * `docs/tweb/dom/dumps/14-left-01-chatlist.json:46-56` (пин —
 * `tabs.solid.test.tsx`).
 *
 * Части и потребители (как в оригинале):
 *  • `Tabs` (`:10-20`), `Tabs.Menu` (`:22-39`), `Tabs.MenuTab` (`:41-54`),
 *    `Tabs.MenuScrollable` (`:56-69`) — ряд папок `foldersTabs.tsx`;
 *  • `Tabs.MenuGradient` (`:71-95`) — тот же ряд (JSX, `foldersTabs.tsx:53`) и
 *    `AppSearchSuper` (прямым вызовом функции с приведением к узлу,
 *    `appSearchSuper.ts:597`). Собственных стилей у `menu-horizontal-gradient*`
 *    нет ни у нас, ни в tweb — правило даёт потребитель
 *    (`.folders-tabs-gradient*` в `_leftSidebar.scss:315-325`,
 *    `.search-super-tabs-gradient*` в `_searchSuper.scss:92-98`).
 *
 * ОБЪЯВЛЕННЫЕ РАСХОЖДЕНИЯ С ОРИГИНАЛОМ
 *
 *  1. `TabsContext` (`:7-8`) не заводится, и `Tabs` отдаёт `props.children` без
 *     провайдера (`:16-18`). Контекст в оригинале — пустышка `createContext<{}>()`
 *     со значением `{}`: во всём `tweb/src` его никто не читает (`useContext`
 *     нет), закомментированные пропы `tab`/`onChange` (`:11-12`) — след так и не
 *     сделанного API. Провайдер без читателей — мёртвый код. `Tabs` оставлен
 *     ради формы потребителя (`<Tabs>…</Tabs>` у `foldersTabs.tsx:52-59`).
 *  2. `Tabs.Content`, `Tabs.ContentTab`, `Tabs.Simple` (`:97-170`) не
 *     портированы: их потребители в tweb — `sidebarRight/tabs/boosts.tsx:139-286`
 *     и `popups/stars.tsx:760`, которых у нас нет; `Tabs.Simple` к тому же зовёт
 *     позиционную форму `horizontalMenu(tabs, content, …)`, сознательно не
 *     портированную (отступление 2 в шапке `components/horizontalMenu.ts`).
 *     План папок, отложенная задача 18.
 *  3. `Scrollable` — наш порт `scrollable2.solid.tsx` (в оригинале
 *     `@components/scrollable2`); контракт пропов, включая `contextRef` с
 *     `container`, тот же (`scrollable2.solid.tsx:81-111`).
 */
import type { JSX, Ref } from 'solid-js'
import Scrollable from '@components/scrollable2.solid'
import classNames from '@helpers/string/classNames'

const Tabs = (props: {
  children: JSX.Element
}) => {
  return props.children
}

Tabs.Menu = (props: {
  class?: string
  id?: string
  ref?: Ref<HTMLDivElement>
  onClick?: (e: MouseEvent) => void
  children: JSX.Element
}) => {
  return (
    <div
      ref={props.ref}
      class={classNames('menu-horizontal-div', props.class)}
      id={props.id}
      onClick={props.onClick}
    >
      {props.children}
    </div>
  )
}

Tabs.MenuTab = (props: {
  ref?: Ref<HTMLDivElement>
  class?: string
  children: JSX.Element
}) => {
  return (
    <div ref={props.ref} class={classNames('menu-horizontal-div-item', props.class)}>
      <i class="menu-horizontal-div-item-background" />
      <div class="menu-horizontal-div-item-span">
        {props.children}
      </div>
    </div>
  )
}

Tabs.MenuScrollable = (props: {
  ref?: Ref<HTMLDivElement>
  scrollableProps?: Partial<Parameters<typeof Scrollable>[0]>
  class?: string
  children: JSX.Element
}) => {
  return (
    <div ref={props.ref} class={classNames('menu-horizontal-scrollable', props.class)}>
      <Scrollable axis="x" {...(props.scrollableProps || {})}>
        {props.children}
      </Scrollable>
    </div>
  )
}

Tabs.MenuGradient = (props: {
  color: 'surface' | 'background'
  smaller?: boolean
  className?: string
  ref?: Ref<HTMLDivElement>
}) => {
  return (
    <div
      ref={props.ref}
      class={classNames(
        'menu-horizontal-gradient-container',
        props.className && props.className + '-container',
      )}
    >
      <div
        class={classNames(
          'menu-horizontal-gradient',
          'menu-horizontal-gradient-color-' + props.color,
          props.smaller && 'menu-horizontal-gradient-smaller',
          props.className,
        )}
      ></div>
    </div>
  )
}

export default Tabs
