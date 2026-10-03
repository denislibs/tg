/** @jsxImportSource solid-js */
// Порт tweb `src/components/chat/topbarPlate.tsx` (812502980, 307 строк) — общая плашка
// под шапкой чата (`.pinned-container`): ей пользуются закреп (`pinnedMessage`), аудио
// (`chat/audio`), заявки (`requests`), настройки пира (`actions`), звонок/эфир
// (`topbarGroupCall`/`topbarLive`). Пачка П-5 волны 7 (Б-21).
//
// Составной компонент `<TopbarPlate>` с подкомпонентами и императивный контроллер
// `createTopbarPlate` для классов (`topbar.ts`). Классы — `pinned-${modifier}-*`, их держит
// портированный `styles/tweb/_chatPinned.scss`.
//
// РАСХОЖДЕНИЯ С ОРИГИНАЛОМ
//  1. `Button.Icon` у нас берёт `aria-label` строкой, а не узлом: `I18n.format('Close', true)`
//     оригинала — та же строка.
import { createContext, createSignal, useContext, type Accessor, type JSX, type Ref } from 'solid-js'
import { render } from 'solid-js/web'
import classNames from '@helpers/string/classNames'
import Button from '@components/buttonTsx.solid'
import RippleElement from '@components/rippleElement.solid'
import I18n from '@lib/langPack'
import buttonKeyDown from '@helpers/solid/buttonKeyDown'

const BASE = 'pinned-container'

type PlateContextValue = {
  modifier: string
}

const PlateContext = createContext<PlateContextValue>()
const PlateBodyContext = createContext(false)

const useModifier = () => useContext(PlateContext)!.modifier
const baseCls = (suffix: string) => `${BASE}-${suffix}`
const modCls = (modifier: string, suffix: string) => `pinned-${modifier}-${suffix}`

const TopbarPlate = (props: {
  /** Modifier identifier (e.g. `message`, `audio`, `translation`, `live`) — drives `pinned-${modifier}-*` classes. */
  modifier: string
  /** Controlled hidden state. When true, applies `hide` class. */
  hidden?: boolean
  class?: string
  ref?: Ref<HTMLDivElement>
  children: JSX.Element
}) => {
  return (
    <PlateContext.Provider value={{ modifier: props.modifier }}>
      <div
        ref={props.ref}
        class={classNames(
          BASE,
          `pinned-${props.modifier}`,
          props.hidden && 'hide',
          props.class,
        )}
      >
        {props.children}
      </div>
    </PlateContext.Provider>
  )
}

TopbarPlate.Body = (props: {
  ref?: Ref<HTMLDivElement>
  noRipple?: boolean
  class?: string
  onClick?: (e: MouseEvent) => void
  children: JSX.Element
}) => {
  const modifier = useModifier()
  return (
    <PlateBodyContext.Provider value={!!props.onClick}>
      <RippleElement
        component="div"
        ref={props.ref}
        noRipple={props.noRipple}
        class={classNames(baseCls('wrapper'), modCls(modifier, 'wrapper'), props.class)}
        onClick={props.onClick}
      >
        {props.children}
      </RippleElement>
    </PlateBodyContext.Provider>
  )
}

TopbarPlate.Content = (props: {
  class?: string
  children: JSX.Element
  ripple?: boolean
  clickable?: boolean
  disabled?: boolean
}) => {
  const modifier = useModifier()
  const clickable = props.clickable ?? useContext(PlateBodyContext)
  return (
    <RippleElement
      component={clickable ? 'button' : 'div'}
      type={clickable ? 'button' : undefined}
      disabled={props.disabled}
      noRipple={!props.ripple}
      class={classNames(baseCls('content'), modCls(modifier, 'content'), props.class)}
    >
      {props.children}
    </RippleElement>
  )
}

TopbarPlate.Title = (props: {
  class?: string
  children: JSX.Element
}) => {
  const modifier = useModifier()
  return (
    <div class={classNames(baseCls('title'), modCls(modifier, 'title'), props.class)}>
      {props.children}
    </div>
  )
}

TopbarPlate.Subtitle = (props: {
  class?: string
  children: JSX.Element
}) => {
  const modifier = useModifier()
  return (
    <div class={classNames(baseCls('subtitle'), modCls(modifier, 'subtitle'), props.class)}>
      {props.children}
    </div>
  )
}

TopbarPlate.CloseButton = (props: {
  onClick?: (e: MouseEvent) => void
  class?: string
  ref?: Ref<HTMLElement>
}) => {
  const modifier = useModifier()
  return (
    <Button.Icon
      ref={props.ref}
      icon="close"
      class={classNames(baseCls('close'), modCls(modifier, 'close'), props.class)}
      aria-label={I18n.format('Close', true)}
      onClick={props.onClick}
      noRipple
    />
  )
}

TopbarPlate.ActionButton = (props: {
  /** Set true while the previous button cross-fades out. Adds `is-leaving`. */
  leaving?: boolean
  as?: 'button' | 'a'
  class?: string
  onClick?: (e: MouseEvent) => void
  ref?: Ref<HTMLElement>
  children: JSX.Element
}) => {
  const modifier = useModifier()
  const className = () => classNames(
    baseCls('action-button'),
    modCls(modifier, 'action-button'),
    'text-overflow-no-wrap',
    props.leaving && 'is-leaving',
    props.class,
  )
  return props.as === 'a' ?
    <a
      ref={props.ref as Ref<HTMLAnchorElement>}
      class={className()}
      role="button"
      tabindex={0}
      onKeyDown={buttonKeyDown}
      onClick={props.onClick}
    >
      {props.children}
    </a> :
    <button
      ref={props.ref as Ref<HTMLButtonElement>}
      class={className()}
      onClick={props.onClick}
    >
      {props.children}
    </button>
}

TopbarPlate.PrimaryButton = (props: {
  onClick: () => void
  children: JSX.Element
  class?: string
  danger?: boolean
  /** Plain label: default text colour and a neutral hover, no primary tint. */
  quiet?: boolean
  ref?: Ref<HTMLElement>
}) => {
  const modifier = useModifier()
  return (
    <Button
      ref={props.ref}
      class={classNames(
        baseCls('primary-button'),
        modCls(modifier, 'primary-button'),
        props.danger && 'btn-primary btn-transparent danger',
        props.quiet && 'btn-primary btn-transparent',
        props.class,
      )}
      primaryTransparent={!props.danger && !props.quiet}
      onClick={props.onClick}
    >
      {props.children}
    </Button>
  )
}

export default TopbarPlate

// =============================================================================
// Imperative controller — bridge for class-based callers (topbar.ts).
// =============================================================================

export type TopbarPlateController = {
  /** The plate's root DOM element. Append it wherever needed. */
  container: HTMLElement
  /** Height read by `topbar.setFloating()`. `'auto'` = measured at runtime. */
  height: number | 'auto'
  /** Reactive hidden state — useful for outer effects that depend on visibility. */
  hidden: Accessor<boolean>
  setHidden: (hidden: boolean) => void
  /** Convenience for legacy `pinnedContainer.isVisible()` callers. */
  isVisible: () => boolean
  destroy: () => void
}

export type CreateTopbarPlateOptions = {
  modifier: string
  height: number | 'auto'
  /** Defaults to `true` — plate stays hidden until first content is ready. */
  initiallyHidden?: boolean
  /**
   * Reactive class accessor applied to the plate root in addition to the
   * built-in `pinned-container` / `pinned-${modifier}` / `hide` classes.
   */
  class?: Accessor<string>
  /** Called every time `hidden` flips — typically wires `topbar.setFloating`. */
  onVisibilityChange?: (visible: boolean) => void
  /**
   * Render fn for the plate body. Receives the live `hidden` accessor and
   * its setter so consumers can drive visibility from inside.
   */
  render: (api: {
    hidden: Accessor<boolean>
    setHidden: (hidden: boolean) => void
  }) => JSX.Element
}

/**
 * Mount a `<TopbarPlate>` detached from any parent and return an imperative
 * controller. The consumer takes ownership of `.container` and places it
 * into its own layout.
 */
export const createTopbarPlate = (options: CreateTopbarPlateOptions): TopbarPlateController => {
  const [hidden, setHiddenSignal] = createSignal(options.initiallyHidden ?? true)
  const setHidden = (next: boolean) => {
    if(hidden() === next) return
    setHiddenSignal(next)
    options.onVisibilityChange?.(!next)
  }

  let plateEl: HTMLDivElement | undefined
  const host = document.createElement('div')

  const dispose = render(() => (
    <TopbarPlate
      modifier={options.modifier}
      hidden={hidden()}
      class={options.class?.()}
      ref={(el) => (plateEl = el)}
    >
      {options.render({ hidden, setHidden })}
    </TopbarPlate>
  ), host)

  return {
    container: plateEl!,
    height: options.height,
    hidden,
    setHidden,
    isVisible: () => !hidden(),
    destroy: () => {
      dispose()
      plateEl?.remove()
    },
  }
}
