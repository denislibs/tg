/** @jsxImportSource solid-js */
/**
 * Порт tweb `src/components/buttonTsx.tsx` — Solid-версия кнопки
 * (`<button>`/`<a>`/`<div>` с риплом и опциональной иконкой).
 *
 * ── Почему это ВТОРОЙ Button, и почему так и надо ──────────────────────────
 * У нас уже есть императивная фабрика `components/button.ts` (порт того же
 * tweb-файла классом-функцией: `document.createElement` + `ripple()`
 * навешивается вручную). Этот файл — независимый Solid-рендер, ровно как у
 * `rowTsx.solid.tsx`/`section.solid.tsx` в волне 2: он не оборачивает
 * `button.ts` и не сводится к нему — строит узел JSX-деревом через
 * `RippleElement` (`rippleElement.solid.tsx`), у которой ripple —
 * побочный эффект `createRenderEffect`, а не императивный вызов после
 * `createElement`. Разметка и классы у обоих одинаковые, поэтому один и тот
 * же `styles/tweb/_button.scss` обслуживает обе версии.
 *
 * ── Отличия от оригинала ───────────────────────────────────────────────────
 *  • `icon`/`iconAfter` — наш `IconName` (`@core/tgico-icons`), а не
 *    глобальный ambient-тип `Icon` оригинала (та же замена, что у
 *    `rowTsx.solid.tsx::Row.Icon` и `iconTsx.solid.tsx`) — значения те же,
 *    меняется только то, как тип попадает в область видимости;
 *  • иконка рисуется `IconTsx` (`iconTsx.solid.tsx`) вместо ambient JSX
 *    `<Icon>` оригинала — тот же Solid-порт `components/icon.ts`, что уже
 *    используют Row/Section;
 *  • рипл — `RippleElement` (`rippleElement.solid.tsx`), уже портированная
 *    в волне 2 обёртка над `components/ripple.ts`; сам `ripple()` — тот же
 *    модуль, что и у императивной кнопки, различается только точка вызова.
 */
import { createMemo, createSignal, type Accessor, type JSX, type Ref, type Setter } from 'solid-js'
import { i18n, type FormatterArguments, type LangPackKey } from '@lib/langPack'
import { IconTsx } from '@components/iconTsx.solid'
import classNames from '@helpers/string/classNames'
import RippleElement from '@components/rippleElement.solid'
import type { IconName } from '@core/tgico-icons'

type ButtonAccessibilityProps = Pick<JSX.ButtonHTMLAttributes<HTMLButtonElement>,
  | 'aria-label'
  | 'aria-pressed'
  | 'on:keydown'
>

const Button = (props: Partial<{
  ref: Ref<HTMLElement>
  as: 'a' | 'div' | 'button'
  class: string
  disabled: boolean
  primaryFilled: boolean
  primary: boolean
  primaryTransparent: boolean
  large: boolean
  children: JSX.Element
  icon: IconName
  iconAfter: IconName
  iconClass: string
  onClick: (e: MouseEvent) => unknown
  text: LangPackKey
  textArgs: FormatterArguments
  noRipple: boolean
  rippleSquare: boolean
  onlyMobile: boolean
  tabIndex: number
}> & ButtonAccessibilityProps = {}): JSX.Element => {
  let disabled: Accessor<boolean>, setDisabled: Setter<boolean> | undefined
  if (props.disabled !== undefined) {
    disabled = createMemo(() => props.disabled!)
  } else {
    [disabled, setDisabled] = createSignal(false)
  }

  return (
    <RippleElement
      // Приведение — на месте оригинального `props.ref as Ref<any>` (:43): тег
      // узла выбирается пропом `as` ('a'/'div'/'button'), поэтому `Ref` кнопки
      // объявлен по общему `HTMLElement`, а `RippleElement`/`Dynamic` знает
      // конкретный тег и требует свой (тот же приём и тот же комментарий, что
      // у `rowTsx.solid.tsx` для того же случая).
      ref={props.ref as Ref<HTMLButtonElement>}
      component={props.as || 'button'}
      class={classNames(
        props.class,
        props.primaryFilled && 'btn-primary btn-color-primary',
        props.primary && 'btn btn-primary primary',
        props.primaryTransparent && 'btn-primary primary btn-transparent',
        props.large && 'btn-large',
        props.onlyMobile && 'only-handhelds',
      )}
      disabled={disabled()}
      onClick={props.onClick && setDisabled ? ((e: MouseEvent) => {
        const result = props.onClick!(e)
        if (result instanceof Promise) {
          setDisabled!(true)
          result.finally(() => {
            setDisabled!(false)
          })
        }
      }) : props.onClick}
      noRipple={props.noRipple}
      rippleSquare={props.rippleSquare}
      tabIndex={props.tabIndex}
      aria-label={props['aria-label']}
      aria-pressed={props['aria-pressed']}
      on:keydown={props['on:keydown']}
    >
      {props.icon && <IconTsx icon={props.icon} class={classNames('button-icon', props.iconClass)} />}
      {props.text ? i18n(props.text, props.textArgs) : props.children}
      {props.iconAfter && <IconTsx icon={props.iconAfter} class={classNames('button-icon', props.iconClass)} />}
    </RippleElement>
  )
}

Button.Corner = (props: Partial<{
  ref: Ref<HTMLElement>
  children: JSX.Element
  onClick: (e: MouseEvent) => void
  class: string
}>) => {
  return (
    <Button {...props} class={classNames('btn-circle', 'btn-corner', 'z-depth-1', props.class)} tabIndex={-1} />
  )
}

Button.Icon = (props: { icon: IconName } & Partial<{
  ref: Ref<HTMLElement>
  children: JSX.Element
  onClick: (e: MouseEvent) => void
  class: string
  noRipple: boolean
  tabIndex: number
}> & ButtonAccessibilityProps) => {
  return (
    <Button
      {...props}
      class={classNames('btn-icon', props.icon, props.class)}
      tabIndex={props.tabIndex ?? -1}
    />
  )
}

export default Button
