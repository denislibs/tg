/** @jsxImportSource solid-js */
// Порт tweb `src/components/buttonIconTsx.tsx` (812502980) — Solid-кнопка `.btn-icon`.
//
// Расхождение: подпись по умолчанию по глифу (`helpers/dom/iconButtonLabel.ts`,
// `getIconButtonLabelKey`) не портирована — у потребителей (поиск по чату,
// `components/chat/topbarSearch.solid.tsx`) `aria-label` задан явно.
import { type JSX, splitProps } from 'solid-js'
import classNames from '@helpers/string/classNames'
import Icon from '@components/icon'
import ripple from '@components/ripple'
import type { IconName } from '@core/tgico-icons'

export const ButtonIconTsx = (inProps: { icon?: IconName, noRipple?: boolean } & JSX.ButtonHTMLAttributes<HTMLButtonElement>) => {
  const [props, restProps] = splitProps(inProps, ['icon', 'class', 'children', 'noRipple', 'tabIndex'])

  const btn = (
    <button
      class={classNames('btn-icon', props.class)}
      {...restProps}
      type={restProps.type || 'button'}
      tabIndex={props.tabIndex ?? restProps.tabindex}
    >
      {props.icon && Icon(props.icon)}
      {props.children}
    </button>
  ) as HTMLButtonElement

  if(!props.noRipple) ripple(btn)

  return btn
}
