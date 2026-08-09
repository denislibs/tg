// Порт tweb `src/components/sidebarLeft/pendingSuggestionItem.tsx`.
//
// Разметка снята с живого tweb (localhost:8099, плашка «Never miss a message!»):
//   div.rp.row.row-clickable.hover-effect._suggestion._secondary
//     > div.c-ripple
//     + button.btn-icon.close._close.rp > div.c-ripple + span.tgico.button-icon
//     + div[dir=auto].row-title    > span.text-bold > текст
//     + div[dir=auto].row-subtitle > span._suggestionSubtitle > текст
// В свёрнутом сайдбаре вместо строки — квадрат с одним эмодзи (tweb Show/fallback).
//
// Отступления от tweb:
//   • у tweb это `<Row>` + `<Button.Icon>` из его компонентной библиотеки; у нас
//     `.row`-классы проставляются вручную (как в ChatListItem) и крестик — наш
//     `IconButton` (он и есть порт `ButtonIcon`);
//   • эмодзи — обычный текст, а не `wrapEmojiText` (подсистемы замены эмодзи на
//     спрайты у нас нет).
import type { ReactNode } from 'react'
import classNames from '../../shared/lib/classNames'
import { useRipple } from '../../shared/ui/Ripple/useRipple'
import IconButton from '../../shared/ui/IconButton'
import TgIcon from '../TgIcon'
import s from './pendingSuggestion.module.scss'

export function SimpleSuggestion({
  emoji,
  title,
  subtitle,
  collapsed,
  onClick,
  onClose,
}: {
  emoji: string
  title: ReactNode
  subtitle: ReactNode
  /** сайдбар свёрнут в узкую полосу (tweb useIsSidebarCollapsed) */
  collapsed?: boolean
  onClick: () => void
  onClose?: () => void
}) {
  const { onPointerDown, ripple } = useRipple()

  if (collapsed) {
    return (
      <div
        className={classNames('rp', 'hover-effect', s.collapsed)}
        onPointerDown={onPointerDown}
        onClick={onClick}
      >
        {ripple}
        {emoji}
      </div>
    )
  }

  return (
    <div
      className={classNames('rp', 'row', 'row-clickable', 'hover-effect', s.secondary)}
      onPointerDown={onPointerDown}
      onClick={onClick}
    >
      {ripple}
      {onClose && (
        <IconButton
          className={classNames('close', s.close)}
          tabIndex={-1}
          onClick={(e) => {
            // tweb cancelEvent — клик по крестику не должен поднять onClick строки
            e.preventDefault()
            e.stopPropagation()
            onClose()
          }}
        >
          {/* tweb: span.tgico.button-icon; размер глифа берётся из font-size кнопки */}
          <TgIcon name="close" className="button-icon" size="inherit" />
        </IconButton>
      )}
      <div dir="auto" className="row-title">
        <span className={classNames('text-bold', s.suggestionTitle)}>{title}</span>
      </div>
      <div dir="auto" className="row-subtitle">
        <span className={s.suggestionSubtitle}>{subtitle}</span>
      </div>
    </div>
  )
}
