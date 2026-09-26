/** @jsxImportSource solid-js */
/**
 * Порт tweb/src/components/rowTsx.tsx:1-526 (812502980) — строка в Solid-разметке.
 *
 * Составной компонент: дети (`<Row.Title>`, `<Row.Subtitle>`, …) РЕГИСТРИРУЮТ
 * свой узел в контексте (`helpers/solid/createComponentContext.ts`), а
 * выкладывает их родитель в порядке разметки строки (`:247-257`), не в порядке
 * написания. Разбор с адресами — `docs/tweb/settings-rows.md` § 1.
 *
 * Что пришло с HEAD поверх старой базы (803f9599d/2197fee9c/ef41b29db/472e3e76b):
 * `toggleAside` (`:108-112`) — тумблер при подписи уезжает в `div.row-right`
 * (`:254-256`); радио справа `radioFieldRight` (`:457-459`, `:340-359`);
 * `contextMenu`/`openContextMenuRef` (`:179-204`, `:215`); гашение клика
 * `disabled`/`aria-disabled` и «уехавшей» мышью (`:205-216`); a11y (`:116-164`,
 * `:222-225`, `:243`, `:260`); `ref`-пропы частей, `rowClass`,
 * `titleRightClass`, `midtitleRight`; `element`-формы `RightContent`/`Media`
 * (`registerExternalElement`, `:54-75`); пустой `RightContent` не рендерится
 * (`:441-447`); `style`; экспорт `createRowTitle` (`:33-38`).
 *
 * Расхождения с оригиналом:
 *  1. `attachHotClassName` (`:463`) → `classList.add`: это `classList.add` плюс
 *     снятие на hot-replace модуля, а ветка HMR у нас не портирована
 *     (`helpers/solid/classname.ts`).
 *  2. Проп `contextMenu` (`:96`) выведен из НАШЕГО `helpers/dom/createContextMenu.ts`
 *     тем же `Omit<Parameters<…>[0], 'findElement' | 'listenTo' | 'listenerSetter'>`.
 *     У нашей фабрики нет опций HEAD `resolveAppendTo`, `onOpenAfter`,
 *     `position`, `reopenOnTrigger`, `cancelOnOpenFalse` — строка их не
 *     принимает, пока их не принесёт порт фабрики (шапка `createContextMenu.ts`).
 *  3. `clickable` — `boolean | JSX.EventHandler` вместо
 *     `JSX.HTMLAttributes['onClick']` (`:79`): у Solid это ещё и связанная пара
 *     `[handler, data]`, а оригинал зовёт `clickable(event)` как функцию (`:210`)
 *     — пара у него упала бы. Тип сужен до того, что код умеет.
 *  4. Глобальный тип `Icon` → `IconName` (`@core/tgico-icons`); `useContext(RowContext)`
 *     под strict — с `!` (ребёнок вне `<Row>` — ошибка разметки, как у tweb).
 *
 * Закомментированные у оригинала пропы (`buttonRight`, `buttonRightLangKey`,
 * `rightTextContent`, `checkboxKeys`, `:90-92`, `:98`) не переносятся: они и
 * там не код.
 *
 * У tweb ДВА самостоятельных порта строки — императивный `row.ts` и этот
 * компонент; с ef41b29db `row.ts` у tweb удалён, у нас он живёт до задачи 31
 * плана 2D (`docs/superpowers/plans/2026-09-26-wave-2d-settings-rowtsx.md`).
 * React-двойник (`components/settings/kit.tsx`) сводится сюда и умрёт с
 * последним React-экраном настроек.
 */
import {
  children,
  createRenderEffect,
  createSignal,
  onCleanup,
  onMount,
  Show,
  splitProps,
  useContext,
  type JSX,
  type Ref,
} from 'solid-js'
import classNames from '@helpers/string/classNames'
import { IconTsx } from '@components/iconTsx.solid'
import RippleElement from '@components/rippleElement.solid'
import createComponentContext, { type ComponentContextValue } from '@helpers/solid/createComponentContext'
import createContextMenu from '@helpers/dom/createContextMenu'
import { hasMouseMovedSinceDown } from '@helpers/dom/clickEvent'
import ListenerSetter from '@helpers/listenerSetter'
import type { IconName } from '@core/tgico-icons'
import { getRowIconBackgroundImage } from '@helpers/rowIconBackground'
import buttonKeyDown from '@helpers/solid/buttonKeyDown'
import labelControl from '@helpers/dom/labelControl'
import {
  RADIO_FIELD_RIGHT_CLASS,
  ROW_CHECKBOX_FIELD_CLASS,
  ROW_CHECKBOX_FIELD_TOGGLE_CLASS,
  ROW_RADIO_FIELD_CLASS,
} from '@components/rowFieldClasses'

export type RowMediaSizeType = 'small' | 'medium' | 'big' | 'abitbigger' | 'bigger' | '40'

export const createRowTitle = () => {
  const title = document.createElement('div')
  title.classList.add('row-title')
  title.dir = 'auto'
  return title
}

type Kind = 'title' | 'subtitle' | 'media' | 'midtitle' | 'icon' |
  'rightContent' | 'checkboxField' | 'checkboxFieldToggle' | 'radioField' | 'radioFieldRight'

type RowContextValue = ComponentContextValue<Kind> & {
  noWrap?: boolean
  /** Тумблер в своей правой колонке, а не в строке заголовка. См. `Row.CheckboxFieldToggle` */
  toggleAside?: boolean
}

const {
  context: RowContext,
  createValue: createRowValue,
} = createComponentContext<RowContextValue, Kind>()

/**
 * Готовый узел (`element`) как часть строки: классы части вешаются на него и
 * снимаются на уходе — только те, которых у узла не было до строки (`:67-69`).
 */
function registerExternalElement(
  context: RowContextValue,
  kind: Kind,
  element: () => HTMLElement,
  className: () => string,
) {
  createRenderEffect(() => {
    const currentElement = element()
    const classes = className().split(' ').filter(Boolean)
    if(!currentElement) {
      return
    }

    const addedClasses = classes.filter((className) => !currentElement.classList.contains(className))
    currentElement.classList.add(...addedClasses)
    onCleanup(() => currentElement.classList.remove(...addedClasses))
  })

  return context.register(kind, (
    <Show keyed when={element()}>{(currentElement) => currentElement}</Show>
  ))
}

const Row = (props: { children: JSX.Element } & Partial<{
  ref: Ref<HTMLElement>
  clickable: boolean | JSX.EventHandler<HTMLElement, MouseEvent>
  role: JSX.HTMLAttributes<HTMLElement>['role']
  tabIndex: number
  'aria-label': string
  'on:keydown': JSX.HTMLAttributes<HTMLElement>['on:keydown']
  havePadding: boolean
  noRipple: boolean
  noWrap: boolean
  disabled: boolean
  fakeDisabled: boolean
  color: 'primary' | 'danger'
  as: 'a' | 'label' | 'div'
  'aria-checked': boolean
  'aria-disabled': boolean
  contextMenu: Omit<Parameters<typeof createContextMenu>[0], 'findElement' | 'listenTo' | 'listenerSetter'>
  openContextMenuRef: (open?: ReturnType<typeof createContextMenu>['open']) => void
  classList: { [key: string]: boolean }
  class: string
  style: JSX.CSSProperties | string
}>) => {
  const value: RowContextValue = {
    ...createRowValue(),
    get noWrap() {
      return props.noWrap
    },
    // с подписью под заголовком тумблер в строке заголовка висел бы над
    // серединой строки, не на одной линии с иконкой/медиа рядом — ему отдают
    // правую колонку (tweb `:108-112`)
    get toggleAside() {
      return !!(this.store.checkboxFieldToggle && this.store.subtitle && !this.store.rightContent)
    },
  }

  const { store } = value
  const [hasNestedControl, setHasNestedControl] = createSignal(false)
  let containerElement!: HTMLElement

  const isCheckbox = () => !!(
    store.checkboxField || store.checkboxFieldToggle || store.radioField || store.radioFieldRight
  )
  const isClickable = () => !!(props.clickable || isCheckbox() || props.contextMenu)
  const inferredButton = () => isClickable() && !isCheckbox() && !props.as && !hasNestedControl()
  const role = () => props.role || (inferredButton() ? 'button' : undefined)

  const setupAccessibility = () => {
    if(!isClickable()) return
    let primaryTarget: HTMLElement | undefined
    const clearPrimaryTarget = () => {
      if(!primaryTarget) return
      primaryTarget.removeEventListener('keydown', buttonKeyDown)
      primaryTarget.removeAttribute('role')
      primaryTarget.removeAttribute('tabindex')
      primaryTarget.removeAttribute('aria-disabled')
      primaryTarget = undefined
    }
    const update = () => {
      const title = containerElement.querySelector<HTMLElement>('.row-title')
      containerElement.querySelectorAll<HTMLElement>('input[type="checkbox"], input[type="radio"]').forEach((control) => labelControl(control, title))
      const nested = Array.from(containerElement.querySelectorAll<HTMLElement>(
        'button, a[href], input, select, textarea, [contenteditable="true"], [role="button"], [tabindex]',
      )).filter((element) => element !== primaryTarget)
      setHasNestedControl(!!nested.length)
      // Строке с отдельным действием справа нужна отдельная первичная цель, а
      // не интерактивный предок и не заголовок, до которого дотянется только мышь.
      const needsPrimaryTarget = !props.as && !props.role && !isCheckbox() && nested.length &&
        title && !nested.some((element) => title.contains(element) || element.matches('input, select, textarea, [contenteditable="true"]'))
      if(!needsPrimaryTarget || primaryTarget !== title) clearPrimaryTarget()
      if(needsPrimaryTarget) {
        primaryTarget = title!
        primaryTarget.setAttribute('role', 'button')
        primaryTarget.tabIndex = props.disabled ? -1 : 0
        primaryTarget.setAttribute('aria-disabled', String(!!props.disabled))
        primaryTarget.addEventListener('keydown', buttonKeyDown)
      }
    }
    createRenderEffect(update)
    const observer = new MutationObserver(update)
    observer.observe(containerElement, { childList: true, subtree: true })
    onCleanup(() => {
      observer.disconnect()
      clearPrimaryTarget()
    })
  }
  const haveRipple = () => !!(!props.noRipple && isClickable())
  const havePadding = () => !!(
    props.havePadding ||
    store.icon ||
    store.checkboxField ||
    store.radioField ||
    store.media
  )
  const resolvedChildren = children(() => (
    <RowContext.Provider value={value}>
      {props.children}
    </RowContext.Provider>
  ))

  let openContextMenu: ReturnType<typeof createContextMenu>['open'] | undefined
  const ref = (container: HTMLElement) => {
    containerElement = container
    const listenerSetter = new ListenerSetter()

    if(props.contextMenu) {
      const { open } = createContextMenu({
        ...props.contextMenu,
        listenTo: container,
        listenerSetter,
      })

      openContextMenu = open
      props.openContextMenuRef?.(open)
    }

    onCleanup(() => {
      openContextMenu = undefined
      props.openContextMenuRef?.()
      listenerSetter.removeAll()
    })

    if(typeof props.ref === 'function') {
      props.ref(container)
    }
  }
  const onClick: JSX.EventHandler<HTMLElement, MouseEvent> = (event) => {
    if(props.disabled || props['aria-disabled']) return
    const clickable = props.clickable
    if(typeof clickable === 'function') {
      if(!hasMouseMovedSinceDown(event)) {
        clickable(event)
      }
      return
    }

    openContextMenu?.(event)
  }

  const element = (
    <RippleElement
      ref={ref}
      component={props.as === 'a' ? 'a' : (props.as === 'label' || isCheckbox() ? 'label' : 'div')}
      role={role()}
      tabIndex={props.tabIndex ?? (role() === 'button' ? props.disabled ? -1 : 0 : undefined)}
      aria-checked={props['aria-checked']}
      aria-disabled={props['aria-disabled'] || props.disabled ? true : undefined}
      classList={{
        'row': true,
        'no-subtitle': !store.subtitle,
        'no-wrap': value.noWrap,
        'row-with-icon': !!store.icon,
        'row-with-padding': havePadding(),
        [`row-clickable hover-${props.color ? props.color + '-' : ''}effect`]: isClickable(),
        'is-disabled': props.disabled,
        'is-fake-disabled': props.fakeDisabled,
        'row-grid': !!store.rightContent || value.toggleAside,
        'with-midtitle': !!store.midtitle,
        ...(props.classList || {}),
        [props.class as string]: !!props.class,
      }}
      onClick={typeof props.clickable === 'function' || props.contextMenu ? onClick : undefined}
      aria-label={props['aria-label']}
      style={props.style}
      onKeyDown={!props['on:keydown'] && !isCheckbox() && isClickable() ? buttonKeyDown : undefined}
      on:keydown={props['on:keydown']}
      noRipple={!haveRipple()}
    >
      {resolvedChildren()}
      {store.title}
      {store.midtitle}
      {store.subtitle}
      {store.icon}
      {store.checkboxField || store.radioField}
      {store.rightContent}
      <Show when={value.toggleAside}>
        <div class="row-right">{store.checkboxFieldToggle}</div>
      </Show>
      {store.media}
    </RippleElement>
  )
  onMount(setupAccessibility)
  return element
}

Row.RowPart = (props: {
  class: string
  part?: JSX.Element
  elementRef?: Ref<HTMLDivElement>
}) => {
  const resolved = children(() => props.part)
  return (
    <Show when={!!props.elementRef || !!resolved()}>
      <div
        ref={(element) => {
          if(typeof props.elementRef === 'function') {
            props.elementRef(element)
          }
        }}
        class={classNames(
          'row-' + props.class,
          useContext(RowContext)!.noWrap && 'no-wrap',
        )}
        dir="auto"
      >
        {resolved()}
      </div>
    </Show>
  )
}

Row.Row = (props: {
  class: string
  rowClass?: string
  additionalClass?: string
  rightAdditionalClass?: string
  left?: JSX.Element
  right?: JSX.Element
  rightSecondary?: boolean
  leftRef?: Ref<HTMLDivElement>
  rightRef?: Ref<HTMLDivElement>
}) => {
  const part = (
    <Row.RowPart
      elementRef={props.leftRef}
      class={classNames(props.class, props.additionalClass)}
      part={props.left}
    />
  )
  const resolved = children(() => props.right)
  return (
    <Show when={!!props.rightRef || !!resolved()} fallback={part}>
      <div class={classNames('row-row', `row-${props.class}-row`, props.rowClass)}>
        {part}
        <Row.RowPart
          elementRef={props.rightRef}
          class={classNames(
            props.class,
            props.additionalClass,
            props.rightAdditionalClass,
            `row-${props.class}-right${props.rightSecondary ? ` row-${props.class}-right-secondary` : ''}`,
          )}
          part={resolved()}
        />
      </div>
    </Show>
  )
}

Row.Title = (props: {
  children?: JSX.Element
  rowClass?: string
  class?: string
  titleRight?: JSX.Element
  titleRightClass?: string
  titleRightSecondary?: boolean
  ref?: Ref<HTMLDivElement>
  titleRightRef?: (element: HTMLDivElement) => void
}) => {
  const context = useContext(RowContext)!
  const explicitRight = children(() => props.titleRight)
  const control = () => context.store.radioFieldRight || (
    context.toggleAside ? undefined : context.store.checkboxFieldToggle
  )
  const right = () => {
    const explicit = explicitRight()
    const currentControl = control()
    return explicit && currentControl ? [explicit, currentControl] : explicit || currentControl
  }

  return context.register('title', (
    <Row.Row
      class="title"
      rowClass={props.rowClass}
      additionalClass={props.class}
      left={props.children}
      right={right()}
      rightAdditionalClass={classNames(
        props.titleRightClass,
        !!(explicitRight() && control()) && 'row-title-right-with-control',
      )}
      rightSecondary={props.titleRightSecondary}
      leftRef={props.ref}
      rightRef={props.titleRightRef}
    />
  ))
}

Row.Midtitle = (props: {
  children?: JSX.Element
  midtitleRight?: JSX.Element
  ref?: Ref<HTMLDivElement>
}) => {
  return useContext(RowContext)!.register('midtitle', (
    <Row.Row
      class="midtitle"
      left={props.children}
      right={props.midtitleRight}
      leftRef={props.ref}
    />
  ))
}

Row.Subtitle = (props: {
  children?: JSX.Element
  class?: string
  subtitleRight?: JSX.Element
  ref?: Ref<HTMLDivElement>
  subtitleRightRef?: (element: HTMLDivElement) => void
}) => {
  return useContext(RowContext)!.register('subtitle', (
    <Row.Row
      class="subtitle"
      additionalClass={props.class}
      left={props.children}
      right={props.subtitleRight}
      leftRef={props.ref}
      rightRef={props.subtitleRightRef}
    />
  ))
}

// tweb `:401-420` (2197fee9c + `noBackground`): иконка — плашка
// `span.row-icon.row-icon-colored` с градиентом inline, глиф внутри.
Row.Icon = (props: {
  icon: IconName
  class?: string
  noBackground?: boolean
}) => {
  return useContext(RowContext)!.register('icon', (
    <span
      class={classNames(
        'row-icon',
        'row-icon-colored',
        props.class,
      )}
      style={!props.noBackground ? {
        'background-image': getRowIconBackgroundImage(props.icon),
      } : undefined}
    >
      <IconTsx icon={props.icon} class="row-icon-icon" />
    </span>
  ))
}

type ExternalRowElementProps = {
  class?: string
  element: HTMLElement
}

Row.RightContent = (inProps: JSX.HTMLAttributes<HTMLDivElement> | ExternalRowElementProps) => {
  const context = useContext(RowContext)!

  if('element' in inProps) {
    return registerExternalElement(
      context,
      'rightContent',
      () => inProps.element,
      () => classNames('row-right', inProps.class),
    )
  }

  const [props, restProps] = splitProps(inProps, ['class', 'children'])
  const resolved = children(() => props.children)
  // пустая правая колонка всё равно заняла бы свою дорожку грида и зазор перед
  // ней, поэтому, когда класть туда нечего, колонки у строки нет (tweb `:441-442`)
  return context.register('rightContent', (
    <Show when={!!resolved()}>
      <div class={classNames('row-right', props.class as string)} {...restProps}>{resolved()}</div>
    </Show>
  ))
}

/**
 * tweb `registerRowField` (`:454-468`): регистрирует поле И метит его как своё
 * для строки, чтобы `_row.scss` раскладывал именно этот чекбокс, а не любой
 * другой внутри строки (см. `rowFieldClasses`). Радио с `radio-field-right`
 * регистрируется как `radioFieldRight` — оно уходит в правую часть заголовка.
 */
function registerRowField(kind: Kind, classes: string[], element: JSX.Element) {
  const context = useContext(RowContext)!
  const resolved = children(() => element)
  const registeredKind = kind === 'radioField' && resolved.toArray().some((node) => (
    node instanceof HTMLElement && node.classList.contains(RADIO_FIELD_RIGHT_CLASS)
  )) ? 'radioFieldRight' : kind

  createRenderEffect(() => {
    resolved.toArray().forEach((node) => {
      if(node instanceof HTMLElement) node.classList.add(...classes)
    })
  })

  return context.register(registeredKind, resolved())
}

Row.CheckboxField = (props: {
  children: JSX.Element
}) => {
  return registerRowField('checkboxField', [ROW_CHECKBOX_FIELD_CLASS], props.children)
}

Row.RadioField = (props: {
  children: JSX.Element
}) => {
  return registerRowField('radioField', [ROW_RADIO_FIELD_CLASS], props.children)
}

Row.CheckboxFieldToggle = (props: {
  children: JSX.Element
}) => {
  // тумблер носит только `row-checkbox-field-toggle` — как у tweb HEAD
  // (ef41b29db снял с него `row-checkbox-field`, `:482-492`)
  return registerRowField(
    'checkboxFieldToggle',
    [ROW_CHECKBOX_FIELD_TOGGLE_CLASS],
    props.children,
  )
}

type RowMediaProps = JSX.HTMLAttributes<HTMLDivElement> & {
  children?: JSX.Element
  size?: RowMediaSizeType
  class?: string
}

type ExternalRowMediaProps = ExternalRowElementProps & {
  size?: RowMediaSizeType
}

Row.Media = (inProps: RowMediaProps | ExternalRowMediaProps) => {
  const context = useContext(RowContext)!
  const classes = () => classNames(
    'row-media',
    inProps.size && `row-media-${inProps.size}`,
    inProps.class,
  )

  if('element' in inProps) {
    return registerExternalElement(context, 'media', () => inProps.element, classes)
  }

  const [props, restProps] = splitProps(inProps, ['children', 'size', 'class'])
  return context.register('media', (
    <div
      class={classes()}
      {...restProps}
    >
      {props.children}
    </div>
  ))
}

export default Row
