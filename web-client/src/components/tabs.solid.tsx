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
 *  • `Tabs.MenuIconTab` (`:118-148`), `Tabs.MenuInner` (`:150-163`) — нижний ряд и
 *    ряд категорий эмодзи-дропдауна (`emoticonsDropdown/{index,tab,category}.ts`,
 *    `tabs/emoji.ts`); императивные вызовы функцией, как у оригинала;
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
import ButtonIcon from '@components/buttonIcon'
import type { IconName } from '@core/tgico-icons'
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
  /** a row the panel fills in later (the emoticons categories) starts out empty */
  children?: JSX.Element
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

/**
 * The emoticons panel's flavour of a tab: an icon button borrowing the row's item styles.
 * Those rows are `no-stripe` — nothing slides behind the active tab, and the icon is the whole
 * tab, so there is neither a background element nor a label wrapper.
 */
Tabs.MenuIconTab = (props: {
  icon?: IconName
  class?: string
  /** `data-tab`, for a row whose tabs are not addressed by their position */
  tab?: number
  /** the accessible name — these tabs are icon-only, so nothing else supplies one */
  label?: string
  /** asking for it adds the square a set's preview is rendered into */
  paddingRef?: (el: HTMLElement) => void
}) => {
  // ButtonIcon reads the first word of its argument as the icon, so the classes go on after
  const button = ButtonIcon(props.icon, { noRipple: true })
  // filtered, because classList.add throws on the empty token a stray double space leaves
  button.classList.add('menu-horizontal-div-item', ...(props.class?.split(' ').filter(Boolean) || []))

  if(props.label) {
    button.setAttribute('aria-label', props.label)
  }

  if(props.tab !== undefined) {
    button.dataset.tab = '' + props.tab
  }

  if(props.paddingRef) {
    const padding = document.createElement('div')
    padding.classList.add('menu-horizontal-div-item-padding')
    button.append(padding)
    props.paddingRef(padding)
  }

  return button
}

/**
 * A scroller nested inside a row, holding tabs of its own: the emoji panel's recent strip,
 * which is a narrow pill until its tab goes active and then widens in place. Takes the
 * caller's scroller, since that one keeps appending tabs to it and destroys it.
 */
Tabs.MenuInner = (props: { scroll: HTMLElement }) => {
  props.scroll.classList.add('menu-horizontal-inner-scroll')

  return (
    <div class="menu-horizontal-inner">
      {props.scroll}
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
