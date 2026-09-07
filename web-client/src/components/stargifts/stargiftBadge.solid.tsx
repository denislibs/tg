/** @jsxImportSource solid-js */
// Порт tweb `src/components/stargifts/stargiftBadge.tsx` (27 строк) — угловая
// лента-бейдж на плитке подарка («1 of 5K», «sold out»).
//
// Проп `backdropAttr` (`starGiftAttributeBackdrop` коллекционного подарка,
// градиент из `center_color`/`edge_color`) не портирован: коллекционных
// (`starGiftUnique`) подарков в нашей модели нет (`core/messages/messageAction.ts`,
// докблок `StarGift`), а `helpers/color::rgbIntToHex` — тоже.
import type { JSX } from 'solid-js'
import classNames from '@helpers/string/classNames'
import styles from './stargiftBadge.module.scss'

export function StarGiftBadge(props: {
  class?: string
  textClass?: string
  children: JSX.Element
}) {
  return (
    <div class={classNames(styles.badge, props.class)}>
      <div class={classNames(styles.text, props.textClass)}>
        {props.children}
      </div>
    </div>
  )
}
