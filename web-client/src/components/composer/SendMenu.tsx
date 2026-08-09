// src/components/composer/SendMenu.tsx
// Меню отправки — порт tweb `chat/sendContextMenu.ts`. Живёт ВНУТРИ
// `.btn-send-container` (input.ts:1361-1363), позиционируется целиком CSS:
// `.menu-send { top: auto; bottom: calc(100% + .5rem) }` (_chat.scss:36-39),
// показ — классом `.active` (_button.scss). Пункты постоянны, недоступные
// прячутся классом `hide` (sendContextMenu.ts:97) — условного рендера нет.
//
// Порядок пунктов — sendContextMenu.ts:42-70.
import type { ReactNode } from 'react'
import TgIcon, { type IconName } from '../TgIcon'
import classNames from '../../shared/lib/classNames'
import { useT } from '../../i18n'

function Item({ icon, label, hide, danger, onClick }: {
  icon: IconName
  label: string
  hide?: boolean
  danger?: boolean
  onClick?: () => void
}) {
  return (
    <div
      className={classNames('btn-menu-item', 'rp-overflow', danger ? 'danger' : '', hide ? 'hide' : '')}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
    >
      <TgIcon name={icon} className="btn-menu-item-icon" size="inherit" />
      <span className="btn-menu-item-text i18n">{label}</span>
    </div>
  )
}

interface Props {
  open: boolean
  onSilent: () => void
  onSchedule?: () => void
  onWhenOnline?: () => void
  /** «Remove Effect» — доступен, только когда эффект выбран (sendContextMenu.ts:68) */
  onRemoveEffect?: () => void
  /** ряд выбора эффекта — наш аналог `appendReactionsMenu` (sendContextMenu.ts:136) */
  effects: ReactNode
}

export default function SendMenu({ open, onSilent, onSchedule, onWhenOnline, onRemoveEffect, effects }: Props) {
  const t = useT()
  // sendContextMenu.ts:97 — доступность пунктов перепроверяется ПЕРЕД показом,
  // поэтому в покое `hide` ни на ком не висит.
  const hidden = (available: boolean) => open && !available
  return (
    <div className={classNames('btn-menu', 'menu-send', 'top-left', open ? 'active' : '')}>
      <Item icon="nosound" label={t('Send Without Sound')} onClick={onSilent} />
      <Item icon="schedule" label={t('Schedule Message')} hide={hidden(!!onSchedule)} onClick={onSchedule} />
      {/* «Напоминание» вместо «Запланировать» tweb показывает только в «Избранном»
          (sendContextMenu.ts:38: peerId === myId → type 'reminder'); у нас этой
          ветки нет — узел структурный и на показе всегда скрыт. */}
      <Item icon="schedule" label={t('Set a Reminder')} hide={hidden(false)} />
      <Item icon="online" label={t('Send When Online')} hide={hidden(!!onWhenOnline)} onClick={onWhenOnline} />
      <Item icon="crossround" label={t('Remove Effect')} danger hide={hidden(!!onRemoveEffect)} onClick={onRemoveEffect} />
      {effects}
    </div>
  )
}
