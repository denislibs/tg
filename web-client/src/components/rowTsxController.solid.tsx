/** @jsxImportSource solid-js */
/**
 * Порт tweb/src/components/rowTsxController.tsx:1-398 (812502980) — императивный
 * фасад над Solid `Row` (`components/rowTsx.solid.tsx`). У tweb это мост ровно для
 * одного потребителя — строки чатлиста `DialogElement` (`lib/appDialogsManager.ts:321`,
 * у нас там же); всё остальное пишет JSX `<Row>`. Граница
 * запинена `rowTsxController.solid.test.tsx` (порт tweb `tests/rowTsxSafeMigrations.test.ts:56-66`).
 *
 * Как устроено (дословно): `mountRowController` (`:97-359`) монтирует `<Row>` в свой
 * `createRoot`, достаёт из готового DOM части (`:330-336`) и отдаёт объект-контроллер
 * с геттерами; `attachRowController` (`:390-398`) кладёт контроллер экземпляру под
 * символ, а геттеры/сеттеры ставит ОДИН раз на прототип класса (`:361-388`), так что
 * `this.title`/`this.container` читаются, как поля прежнего класса `Row`, но своих
 * свойств у экземпляра нет. Корень гаснет на `middleware.onDestroy` (`:338-346`).
 *
 * Портированный объём — то, что читает и передаёт `DialogElement` и потребители его
 * строки (`sortedUserList.ts` — `titleRight`, `appSelectPeers.solid.tsx` — `media`).
 * Не портировано — у нас этим частям нет вызывающих (у tweb у них тоже только
 * `DialogElement`, который их не передаёт):
 *  1. опции `icon`/`iconClasses`, `subtitleLangKey`/`titleLangKey`/`*LangArgs`,
 *     `titleRight` (без `Secondary`), `checkboxField`/`checkboxFieldOptions`/
 *     `withCheckboxSubtitle`/`checkboxKeys`, `navigationTab`, `buttonRight`/
 *     `buttonRightLangKey`, `rightContent`/`rightTextContent`, `contextMenu`,
 *     `asLabel`, `listenerSetter` (`:23-58`) — и ветки `<Show>` под них (`:303-314`);
 *  2. строковый `RowContent` (`htmlToDocumentFragment`, `:92-94`): `DialogElement`
 *     передаёт только `true` («узел заведи, наполню сам»);
 *  3. функция в `clickable` и `freezed` (`:123-137`, `:285-289`): строка чатлиста
 *     кликабельна `true`, клик ловит делегат списка (`setListClickListener`);
 *  4. `ensureSubtitle`/`ensureMidtitle` и сигналы `hasSubtitle`/`hasMidtitle`
 *     (`:167-192`, `:297-302`), `createTitle`, `createMedia`, `isDisabled`,
 *     `disableWithPromise`, `makeSortable`/`toggleSorting`,
 *     `openContextMenu`, `checkboxField`/`buttonRight` в контроллере, сеттер `media`;
 *
 * `toggleDisability` (`:262-265`) портирован: его зовёт вкладка заявок
 * (`sidebarRight/tabs/chatRequests.solid.tsx`, tweb `chatRequests.tsx:72`).
 * `createRowSortableIcon` (`:61-63`) портирован: его зовёт `DialogElement.createSortableIcon`
 * (`appDialogsManager.ts:542-546`) у закреплённых строк.
 */
import { createRoot, createSignal, Show } from 'solid-js'
import Row, { type RowMediaSizeType } from '@components/rowTsx.solid'
import type { Middleware } from '@helpers/middleware'
import Icon from '@components/icon'

export type { RowMediaSizeType } from '@components/rowTsx.solid'

/** tweb `:17` без строки (п. 2 шапки) */
type RowContent = HTMLElement | DocumentFragment | true

/** tweb `:23-58` в портированном объёме (п. 1, 3 шапки). */
export type RowTsxOptions = Partial<{
  subtitle: RowContent
  subtitleRight: RowContent
  title: RowContent
  titleRightSecondary: RowContent
  clickable: boolean
  havePadding: boolean
  noRipple: boolean
  noWrap: boolean
  middleware: Middleware
  asLink: boolean
}>

/** tweb `:61-63` — ручка перетаскивания строки (закреплённой строки чатлиста). */
export function createRowSortableIcon() {
  return Icon('menu', 'row-sortable-icon')
}

/** tweb `:65-90` в портированном объёме (п. 4 шапки). */
export type RowTsxController = {
  readonly container: HTMLElement
  readonly titleRow: HTMLElement
  readonly titleRight: HTMLElement
  readonly media: HTMLElement | undefined
  readonly subtitleRow: HTMLElement
  readonly subtitleRight: HTMLElement
  readonly title: HTMLElement
  readonly subtitle: HTMLElement
  dispose: () => void
  applyMediaElement: (media: HTMLElement, size?: RowMediaSizeType) => HTMLElement
  toggleDisability: (disable?: boolean) => () => void
}

type Part = 'title' | 'titleRow' | 'titleRight' | 'subtitle' | 'subtitleRow' | 'subtitleRight'

/** tweb `:97-359` */
const mountRowController = (options: RowTsxOptions = {}): RowTsxController => {
  const initialSubtitle = options.subtitle
  const initialTitle = options.title
  const titleRight = options.titleRightSecondary
  const subtitleRight = options.subtitleRight

  let container!: HTMLElement
  let currentMedia: HTMLElement | undefined
  const [media, setMedia] = createSignal<{ element: HTMLElement, size?: RowMediaSizeType }>()
  const parts: Partial<Record<Part, HTMLElement>> = {}

  const getPart = (className: string) => container.querySelector(`.${className}`) as HTMLElement
  const getTitle = () => container.querySelector(
    ':scope > .row-title, :scope > .row-title-row > .row-title:not(.row-title-right)',
  ) as HTMLElement
  const getSubtitle = () => container.querySelector(
    ':scope > .row-subtitle, :scope > .row-subtitle-row > .row-subtitle:not(.row-subtitle-right)',
  ) as HTMLElement

  let rootDispose: (() => void) | undefined
  let disposed = false
  const dispose = () => {
    if(disposed) {
      return
    }

    disposed = true
    rootDispose?.()
  }

  const controller: RowTsxController = {
    get container() {
      return container
    },
    get titleRow() {
      return parts.titleRow!
    },
    get titleRight() {
      return parts.titleRight!
    },
    get media() {
      return currentMedia
    },
    get subtitleRow() {
      return parts.subtitleRow!
    },
    get subtitleRight() {
      return parts.subtitleRight!
    },
    get title() {
      return parts.title!
    },
    get subtitle() {
      return parts.subtitle!
    },
    dispose,
    applyMediaElement: (element: HTMLElement, size?: RowMediaSizeType) => {
      currentMedia = element
      setMedia({ element, size })
      return element
    },
    toggleDisability: (disable = !container.classList.contains('is-disabled')) => {
      container.classList.toggle('is-disabled', disable)
      return () => controller.toggleDisability(!disable)
    },
  }

  createRoot((_dispose) => {
    rootDispose = _dispose
    return (
      <Row
        ref={(element) => container = element}
        clickable={options.clickable}
        havePadding={options.havePadding}
        noRipple={options.noRipple}
        noWrap={options.noWrap}
        as={options.asLink ? 'a' : undefined}
      >
        <Show when={initialSubtitle}>
          <Row.Subtitle subtitleRight={subtitleRight}>{initialSubtitle}</Row.Subtitle>
        </Show>
        <Show keyed when={media()}>{(value) => (
          <Row.Media element={value.element} size={value.size} />
        )}</Show>
        <Show when={initialTitle || titleRight}>
          <Row.Title
            titleRight={titleRight}
            titleRightSecondary={!!options.titleRightSecondary}
          >
            {initialTitle}
          </Row.Title>
        </Show>
      </Row>
    )
  })

  parts.title = getTitle()
  parts.titleRow = getPart('row-title-row')
  parts.titleRight = getPart('row-title-right')
  parts.subtitle = getSubtitle()
  parts.subtitleRow = getPart('row-subtitle-row')
  parts.subtitleRight = getPart('row-subtitle-right')

  // a Solid root is a RENDER lifetime, not an event-listener one (tweb `:338-341`):
  // корень гаснет вместе с владельцем отрисовки строки — её middleware
  options.middleware?.onDestroy(dispose)

  return controller
}

const ROW_CONTROLLER = Symbol.for('tweb.row-controller')
const prototypesWithRowController = new WeakSet<object>()

/** tweb `:364-388` — геттеры/сеттеры контроллера один раз на прототип класса. */
const installRowControllerDescriptors = (target: object, controller: RowTsxController) => {
  const prototype = Object.getPrototypeOf(target) as object | null
  const descriptorTarget = prototype && prototype !== Object.prototype ? prototype : target
  if(prototypesWithRowController.has(descriptorTarget)) {
    return
  }

  const descriptors: PropertyDescriptorMap = {}
  for(const key of Reflect.ownKeys(controller)) {
    const source = Object.getOwnPropertyDescriptor(controller, key)!
    // сеттер только проверяется на наличие, не вызывается — `this` не теряется
    // eslint-disable-next-line typescript/unbound-method
    const writable = source.set || ('writable' in source && source.writable)
    descriptors[key as keyof RowTsxController] = {
      configurable: true,
      get(this: { [ROW_CONTROLLER]: RowTsxController }) {
        return this[ROW_CONTROLLER][key as keyof RowTsxController]
      },
      set: writable ? function(this: { [ROW_CONTROLLER]: Record<PropertyKey, unknown> }, value: unknown) {
        this[ROW_CONTROLLER][key] = value
      } : undefined,
    }
  }

  Object.defineProperties(descriptorTarget, descriptors)
  prototypesWithRowController.add(descriptorTarget)
}

/** tweb `:390-398` */
export const attachRowController = <T extends object>(
  target: T,
  options: RowTsxOptions = {},
): T & RowTsxController => {
  const controller = mountRowController(options)
  Object.defineProperty(target, ROW_CONTROLLER, { value: controller })
  installRowControllerDescriptors(target, controller)
  return target as T & RowTsxController
}
