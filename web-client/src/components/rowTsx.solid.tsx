/** @jsxImportSource solid-js */
/**
 * Порт tweb `src/components/rowTsx.tsx` — строка настроек в Solid-разметке.
 *
 * ── Почему это ВТОРОЙ Row, и почему так и надо ─────────────────────────────
 * У tweb ДВА самостоятельных порта строки: императивный класс
 * (`components/row.ts` → наш `components/row.ts`) и вот этот составной
 * Solid-компонент. Они не обёртки друг над другом и не сводятся: класс строит
 * узел разом из объекта опций, а компонент собирается из детей
 * (`<Row.Title>`, `<Row.Subtitle>`, …), которые регистрируются в контексте
 * (`helpers/solid/createComponentContext.ts`) и выкладываются РОДИТЕЛЕМ в
 * порядке разметки строки, а не в порядке написания. Разметка и классы у обоих
 * одинаковые, поэтому один `styles/tweb/_row.scss` обслуживает обе версии.
 *
 * ЭТОТ файл — и есть ответ на «второй порт Row» из #112: наш React-двойник
 * (`components/settings/kit.tsx`) сводится не к классу, а сюда, и умрёт вместе
 * с последним React-экраном настроек. Пока у оригинала два порта строки — у
 * нас их тоже должно быть два, и ровно эти.
 *
 * ── Что не перенесено ──────────────────────────────────────────────────────
 * Проп `contextMenu` (`:37`, и вся ветка `ref`-мемо `:67-86`) — он требует
 * `helpers/dom/createContextMenu`, которого в репо нет; ровно то же
 * расхождение и по той же причине уже записано у императивного
 * `components/row.ts`, и снимает их обе ЗАДАЧА #110. Вместе с пропом не
 * перенесены его следствия: `isClickable()` не спрашивает про меню, а `onClick`
 * не подставляет `openContextMenu`. Возвращать проп половинчато (принять и
 * молча не вешать меню) нельзя — это мёртвая опция в публичном контракте.
 *
 * Закомментированные у оригинала пропы (`buttonRight`, `rightTextContent`,
 * `checkboxKeys`, `:35-36`, `:39`) не переносятся: они и там не код.
 */
import { children, Show, splitProps, useContext, type JSX, type Ref } from 'solid-js'
import classNames from '@helpers/string/classNames'
import { IconTsx } from '@components/iconTsx.solid'
import RippleElement from '@components/rippleElement.solid'
import createComponentContext, { type ComponentContextValue } from '@helpers/solid/createComponentContext'
import type { IconName } from '@core/tgico-icons'

export type RowMediaSizeType = 'small' | 'medium' | 'big' | 'abitbigger' | 'bigger' | '40'

type Kind = 'title' | 'subtitle' | 'media' | 'midtitle' | 'icon' |
  'rightContent' | 'checkboxField' | 'checkboxFieldToggle' | 'radioField'

type RowContextValue = ComponentContextValue<Kind> & {
  noWrap?: boolean
}

const {
  context: RowContext,
  createValue: createRowValue,
} = createComponentContext<RowContextValue, Kind>()

const Row = (props: { children: JSX.Element } & Partial<{
  ref: Ref<HTMLElement>
  clickable: boolean | JSX.EventHandlerUnion<HTMLElement, MouseEvent>
  havePadding: boolean
  noRipple: boolean
  noWrap: boolean
  disabled: boolean
  fakeDisabled: boolean
  color: 'primary' | 'danger'
  as: 'a' | 'label' | 'div'
  classList: { [key: string]: boolean }
  class: string
}>) => {
  const value: RowContextValue = {
    ...createRowValue(),
    get noWrap() {
      return props.noWrap
    },
  }

  const { store } = value

  const isCheckbox = () => !!(store.checkboxField || store.checkboxFieldToggle || store.radioField)
  const isClickable = () => !!(props.clickable || isCheckbox())
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

  // Приведение `ref` — на месте оригинального `props.ref as any` (:83): тег
  // узла выбирается пропом `as`, поэтому `Ref` строки объявлен по общему
  // `HTMLElement`, а `RippleElement` знает тег и требует свой.
  return (
    <RippleElement
      ref={props.ref as Ref<HTMLDivElement>}
      component={props.as === 'a' ? 'a' : (props.as === 'label' || isCheckbox() ? 'label' : 'div')}
      classList={{
        'row': true,
        'no-subtitle': !store.subtitle,
        'no-wrap': value.noWrap,
        'row-with-icon': !!store.icon,
        'row-with-padding': havePadding(),
        [`row-clickable hover-${props.color ? props.color + '-' : ''}effect`]: isClickable(),
        'is-disabled': props.disabled,
        'is-fake-disabled': props.fakeDisabled,
        'row-grid': !!store.rightContent,
        'with-midtitle': !!store.midtitle,
        ...(props.classList || {}),
        [props.class as string]: !!props.class,
      }}
      onClick={typeof props.clickable !== 'boolean' ? props.clickable : undefined}
      noRipple={!haveRipple()}
    >
      {resolvedChildren()}
      {store.title}
      {store.midtitle}
      {store.subtitle}
      {store.icon}
      {store.checkboxField || store.radioField}
      {store.rightContent}
      {store.media}
    </RippleElement>
  )
}

Row.RowPart = (props: {
  class: string
  part?: JSX.Element
}) => {
  const resolved = children(() => props.part)
  return (
    <Show when={resolved()}>
      <div
        class={classNames(
          'row-' + props.class,
          useContext(RowContext)?.noWrap ? 'no-wrap' : undefined,
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
  additionalClass?: string
  left?: JSX.Element
  right?: JSX.Element
  rightSecondary?: boolean
}) => {
  const part = <Row.RowPart class={classNames(props.class, props.additionalClass)} part={props.left} />
  const resolved = children(() => props.right)
  return (
    <Show when={resolved()} fallback={part}>
      <div class={classNames('row-row', `row-${props.class}-row`)}>
        {part}
        <Row.RowPart
          class={classNames(
            props.class,
            props.additionalClass,
            `row-${props.class}-right${props.rightSecondary ? ` row-${props.class}-right-secondary` : ''}`,
          )}
          part={resolved()}
        />
      </div>
    </Show>
  )
}

Row.Title = (props: {
  children: JSX.Element
  class?: string
  titleRight?: JSX.Element
  titleRightSecondary?: boolean
}) => {
  const context = useContext(RowContext)!
  return context.register('title', (
    <Row.Row
      class="title"
      additionalClass={props.class}
      left={props.children}
      right={props.titleRight || context.store.checkboxFieldToggle}
      rightSecondary={props.titleRightSecondary}
    />
  ))
}

Row.Midtitle = (props: {
  children: JSX.Element
}) => {
  return useContext(RowContext)!.register('midtitle', (
    <Row.Row
      class="midtitle"
      left={props.children}
    />
  ))
}

Row.Subtitle = (props: {
  children: JSX.Element
  class?: string
  subtitleRight?: JSX.Element
}) => {
  return useContext(RowContext)!.register('subtitle', (
    <Row.Row
      class="subtitle"
      additionalClass={props.class}
      left={props.children}
      right={props.subtitleRight}
    />
  ))
}

Row.Icon = (props: {
  icon: IconName
  class?: string
}) => {
  return useContext(RowContext)!.register('icon', (
    <IconTsx icon={props.icon} class={classNames('row-icon', props.class)} />
  ))
}

Row.RightContent = (inProps: JSX.HTMLAttributes<HTMLDivElement>) => {
  const [props, restProps] = splitProps(inProps, ['class'])
  return useContext(RowContext)!.register('rightContent', (
    <div class={classNames('row-right', props.class as string)} {...restProps} />
  ))
}

Row.CheckboxField = (props: {
  children: JSX.Element
}) => {
  return useContext(RowContext)!.register('checkboxField', props.children)
}

Row.RadioField = (props: {
  children: JSX.Element
}) => {
  return useContext(RowContext)!.register('radioField', props.children)
}

Row.CheckboxFieldToggle = (props: {
  children: JSX.Element
}) => {
  return useContext(RowContext)!.register('checkboxFieldToggle', props.children)
}

Row.Media = (inProps: JSX.HTMLAttributes<HTMLDivElement> & {
  children?: JSX.Element
  size: RowMediaSizeType
  class?: string
}) => {
  const [props, restProps] = splitProps(inProps, ['children', 'size', 'class'])

  return useContext(RowContext)!.register('media', (
    <div
      class={classNames(
        'row-media',
        props.size && `row-media-${props.size}`,
        props.class as string,
      )}
      {...restProps}
    >
      {props.children}
    </div>
  ))
}

export default Row
