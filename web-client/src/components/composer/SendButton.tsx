// src/components/composer/SendButton.tsx
// Кнопка отправки — дерево tweb `chat/input.ts:1301-1326` + `sendContextMenu.ts`:
//
//   div.btn-send-container
//     span.btn-send-stars-badge.stars-badge-base > span.tgico.stars-badge-base__icon + span
//     button.btn-icon.rp.btn-circle.btn-send.animated-button-icon.<состояние>
//       div.c-ripple
//       span.tgico.animated-button-icon-icon.btn-send-icon-{send,schedule,edit,record,record-video,forward}
//     div.btn-send-effect-container
//     div.btn-menu.menu-send.top-left
//
// Морф — не подмена узла: все шесть иконок лежат в DOM постоянно, по умолчанию
// проигрывая `hide-icon .4s forwards ease-in-out` (_animatedIcon.scss:159-170);
// активную выбирает класс состояния на самой кнопке, включая
// `grow-icon .4s forwards ease-in-out` (_chat.scss:180-188). Поэтому здесь нет ни
// AnimatePresence, ни key-ремаунта: меняется одна строка className.
import type { MouseEventHandler, ReactNode } from 'react'
import IconButton from '../../shared/ui/IconButton'
import TgIcon, { type IconName } from '../TgIcon'
import classNames from '../../shared/lib/classNames'
import s from './extras.module.scss'

// input.ts:193 — ChatSendBtnIcon.
export type SendBtnIcon = 'send' | 'record' | 'record-video' | 'edit' | 'schedule' | 'forward'

// input.ts:1306-1313 — порядок в DOM строго фиксирован.
const ICONS: [IconName, SendBtnIcon][] = [
  ['logo', 'send'],
  ['schedule', 'schedule'],
  ['check', 'edit'],
  ['microphone_filled', 'record'],
  ['recordround', 'record-video'],
  ['forward_filled', 'forward'],
]

interface Props {
  icon: SendBtnIcon
  /** `.btn-send.disabled` (_chat.scss:165-168): pointer-events нет, фон вторичный */
  disabled?: boolean
  /** платные сообщения: цена в звёздах (input.ts:4020-4034) */
  stars?: number
  /** выбранный эффект сообщения — бейдж в `.btn-send-effect-container` */
  effectEmoji?: string | null
  /** медленный режим: обратный отсчёт поверх кнопки */
  slowmodeText?: string | null
  onClick: () => void
  onMouseDown: MouseEventHandler<HTMLButtonElement>
  onMouseUp: MouseEventHandler<HTMLButtonElement>
  onMouseLeave: () => void
  onContextMenu: MouseEventHandler<HTMLButtonElement>
  menu: ReactNode
}

export default function SendButton({
  icon, disabled, stars, effectEmoji, slowmodeText, onClick, onMouseDown, onMouseUp, onMouseLeave, onContextMenu, menu,
}: Props) {
  return (
    <div className="btn-send-container">
      {/* отступление от tweb: пока не портирован `partials/_starsBadge.scss`,
          неактивный бейдж прячем глобальным `hide` — иначе он не спозиционирован
          (`position:absolute; --scale: 0`) и торчал бы рядом с кнопкой. */}
      <span
        className={classNames(
          'btn-send-stars-badge', 'stars-badge-base',
          stars ? 'btn-send-stars-badge--active' : 'hide',
        )}
      >
        <TgIcon name="star" className="stars-badge-base__icon" size="inherit" />
        <span>{stars ?? ''}</span>
      </span>

      <IconButton
        className={classNames('btn-circle', 'btn-send', 'animated-button-icon', icon, disabled ? 'disabled' : '')}
        onClick={onClick}
        onMouseDown={onMouseDown}
        onMouseUp={onMouseUp}
        onMouseLeave={onMouseLeave}
        onContextMenu={onContextMenu}
      >
        {ICONS.map(([name, type]) => (
          <TgIcon key={type} name={name} className={`animated-button-icon-icon btn-send-icon-${type}`} size="inherit" />
        ))}
        {/* отступление от tweb: обратного отсчёта slowmode на кнопке в оригинале нет
            (там отсчёт живёт в подсказке над инпутом) — держим свой, поверх иконок. */}
        {slowmodeText && <span className={s.slowmodeTimer}>{slowmodeText}</span>}
      </IconButton>

      {/* selectedEffect.tsx:57 — контейнер всегда в DOM, видимость даёт `is-visible`.
          отступление от tweb: внутри у нас символ-эмодзи, а не стикер 20×20 —
          наши эффекты не TL-документы, а свой canvas-движок (core/effects). */}
      <div className={classNames('btn-send-effect-container', effectEmoji ? 'is-visible' : '')}>
        {effectEmoji && <span className={classNames('btn-send-effect', s.effectBadge)}>{effectEmoji}</span>}
      </div>

      {menu}
    </div>
  )
}
