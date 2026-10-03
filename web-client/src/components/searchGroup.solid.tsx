/** @jsxImportSource solid-js */
/**
 * Порт tweb `src/components/searchGroup.tsx:1-170` — группа выдачи поиска:
 * Solid-`Section` (`section.solid.tsx`) с чатлистом внутри.
 *
 * Группа рождается скрытой (`hide`, :52) и показывается `setActive()`/`toggle()`
 * только когда в ней есть строки; пустая при `toggle()` чистится (`clear()`,
 * :142-152 — заглушка и строки через `dialogElement.remove()`). «Показать ещё»
 * (`needShowMoreButton`, :163-165) и правый слот заголовка (`setNameRight`,
 * :166) — сигналы, читаемые мемо `nameRight` (:56-76). Корень Solid — свой
 * `createRoot` с `dispose` на `middleware.onClean` (:82, :111): у группы нет
 * хоста, она сама отдаёт `container`, поэтому `mountSolid` сюда не подходит.
 *
 * Эталон разметки — дамп `docs/tweb/dom/dumps/14-left-03b-search-chats-query.json`
 * (группы `contacts`, `messages`, `people`, `recent`).
 *
 * Расхождения с оригиналом:
 *  1. (снято К-2: клик по строке — `appImManager.setInnerPeer`, менеджеры не нужны.)
 *  2. `name` — `LangPackKey | false` (у оригинала `LangPackKey | boolean`):
 *     `true` не передаёт ни один вызывающий, а наш `Section` булев заголовок
 *     не принимает.
 *  3. `withContext: undefined` (:118) не передаётся — контекст-меню строки у
 *     `setListClickListener` не портировано (шапка `lib/appDialogsManager.ts`).
 *  4. Горизонтальный скроллер — `scrollable2.solid.tsx` (порт `scrollable2.tsx`,
 *     :7), список — `appDialogsManager.createChatList` (:77).
 *  5. Мемо `nameRight` (:56-76) создаётся ВНУТРИ `createRoot`, у оригинала —
 *     до него, без владельца (Solid такой мемо не снимает никогда). Поведение
 *     то же, но `dispose` по `middleware.onClean` гасит и его.
 */
import { createMemo, createRoot, createSignal, Show, type JSX } from 'solid-js'
import { i18n, type LangPackKey } from '@lib/langPack'
import classNames from '@helpers/string/classNames'
import type { Middleware } from '@helpers/middleware'
import Section from '@components/section.solid'
import Scrollable from '@components/scrollable2.solid'
import appDialogsManager, { createChatList, type DialogListElement } from '@lib/appDialogsManager'

// `(string & {})` вместо голого `string` оригинала (:9): тот же набор значений,
// но известные имена не растворяются в `string` (`no-redundant-type-constituents`)
export type SearchGroupType = 'contacts' | 'globalContacts' | 'messages' | (string & {})

export type SearchGroup = ReturnType<typeof createSearchGroup>

type NameRightProps = {
  children: JSX.Element,
  onClick?: () => void,
}

export function createSearchGroup(options: {
  name?: LangPackKey | false,
  type: string,
  clearable?: boolean,
  className?: string,
  clickable?: boolean,
  autonomous?: boolean,
  onFound?: Parameters<typeof appDialogsManager.setListClickListener>[0]['onFound'],
  noIcons?: boolean,
  middleware?: Middleware,
  scrollableX?: boolean,
}) {
  const {
    name,
    type,
    clearable = true,
    className,
    clickable = true,
    autonomous = true,
    onFound,
    noIcons,
    middleware,
    scrollableX,
  } = options

  const NameRight = (props: NameRightProps) => {
    return (
      <span
        class="cursor-pointer hover-underline"
        onClick={props.onClick}
      >
        {props.children}
      </span>
    )
  }

  const [hide, setHide] = createSignal(true)
  const [showingMore, setShowingMore] = createSignal(false)
  const [showMoreClassName, setShowMoreClassName] = createSignal<string>()
  const [_nameRight, setNameRight] = createSignal<NameRightProps>()
  const list = createChatList()
  let container!: HTMLDivElement
  let nameEl!: HTMLDivElement
  let placeholder: HTMLElement | undefined

  createRoot((dispose) => {
    // мемо живёт в корне группы: снаружи корня его некому было бы снять
    const nameRight = createMemo(() => {
      const _ = _nameRight()
      if(_) {
        return NameRight(_)
      }

      const toggleClassName = showMoreClassName()
      if(!toggleClassName) {
        return
      }

      return (
        <NameRight
          onClick={() => {
            setShowingMore((v) => !v)
          }}
        >
          {i18n(showingMore() ? 'Separator.ShowLess' : 'Separator.ShowMore')}
        </NameRight>
      )
    })

    void (
      <Section
        name={name || undefined}
        nameRef={(ref) => nameEl = ref}
        nameRight={nameRight()}
        class={classNames(
          'search-group',
          'search-group-' + type,
          className,
          hide() && 'hide',
          showMoreClassName() && !showingMore() && showMoreClassName(),
          scrollableX && 'search-group-with-scroll',
        )}
        ref={(ref) => container = ref}
        innerClass="search-group-inner"
        contentProps={{
          class: 'search-group-content',
        }}
      >
        <Show when={scrollableX} fallback={list}>
          <Scrollable
            class="search-group-scrollable-x"
            axis="x"
          >
            {list}
          </Scrollable>
        </Show>
      </Section>
    )

    middleware?.onClean(dispose)
  })

  if(clickable) {
    appDialogsManager.setListClickListener({
      list,
      onFound,
      autonomous,
    })
  }

  const group = {
    container,
    list,
    nameEl,
    autonomous,
    noIcons,
    createPlaceholder: undefined as (() => HTMLElement) | undefined,
    get placeholder() {
      return placeholder
    },
    addPlaceholder(el: HTMLElement) {
      group.removePlaceholder()
      placeholder = el
      container.append(el)
    },
    removePlaceholder() {
      placeholder?.remove()
      placeholder = undefined
    },
    clear() {
      setHide(true)
      group.removePlaceholder()
      if(clearable) {
        Array.from(list.children).forEach((el) => {
          const dialogElement = (el as DialogListElement).dialogElement
          if(dialogElement) dialogElement.remove()
          else el.remove()
        })
      }
    },
    setActive() {
      setHide(false)
    },
    toggle() {
      if(list.childElementCount) {
        group.setActive()
      } else {
        group.clear()
      }
    },
    needShowMoreButton(toggleClassName = 'is-short-5') {
      setShowMoreClassName(toggleClassName)
    },
    setNameRight,
  }

  return group
}
