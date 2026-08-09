// src/components/composer/ReplyWrapper.tsx
// ОДНА плашка на reply / edit / forward — как в tweb: контейнер строится один раз
// (`constructReplyElements`, input.ts:624-638), а `setTopInfo` (input.ts:4831-4906)
// лишь подменяет иконку и тело:
//
//   div.reply-wrapper.rows-wrapper-row
//     div.reply-wrapper-content [--peer-color-rgb; --peer-border-background]
//       button.btn-icon.reply-icon      (order: 0)
//       div.reply.quote-like.quote-like-hoverable.quote-like-border.rp   (order: 1)
//         div.c-ripple
//         div.reply-content > div.reply-title + div.reply-subtitle
//       button.btn-icon.reply-cancel    (order: 2)
//
// Раскрытие 0 → 3rem — чистый CSS: `.chat.is-helper-active .reply-wrapper`
// (_chat.scss:783-787), класс вешает Composer на контейнер чата. Поэтому здесь
// нет ни анимаций, ни AnimatePresence: содержимое просто доживает до конца
// схлопывания (tweb тоже не выкидывает старый узел мгновенно).
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import IconButton from '../../shared/ui/IconButton'
import TgIcon, { type IconName } from '../TgIcon'
import { useRipple } from '../../shared/ui/Ripple/useRipple'
import { useT } from '../../i18n'
import type { EditState, ForwardBar, ReplyState } from '../Composer'

// --transition-standard-out (base.scss:43) — столько же длится height-переход плашки.
const COLLAPSE_MS = 250

/** peerColors.ts:60-61 пишет `--peer-color-rgb` ссылкой на переменную темы; своей
 *  палитры `--peer-N-color-rgb` у нас нет, поэтому пишем реальный «r, g, b» —
 *  легальный вариант и в самом tweb (collectible-цвета, peerColors.ts:46-47). */
function hexToRgbTriplet(hex: string): string | undefined {
  const m = /^#?([\da-f]{6})$/i.exec(hex.trim())
  if (!m) return undefined
  const n = parseInt(m[1], 16)
  return `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`
}

interface Content {
  icon: IconName
  title: ReactNode
  subtitle: ReactNode
  rgb?: string
  onCancel: () => void
  onClick?: () => void
}

interface Props {
  reply: ReplyState | null
  editing: EditState | null
  forward: ForwardBar | null
  onCancelReply: () => void
  onCancelEdit: () => void
  onCancelForward: () => void
  /** клик по телу плашки форварда открывает меню опций (tweb reply-line-menu) */
  onOpenForwardMenu: () => void
  bodyRef: React.RefObject<HTMLDivElement | null>
}

export default function ReplyWrapper({
  reply, editing, forward, onCancelReply, onCancelEdit, onCancelForward, onOpenForwardMenu, bodyRef,
}: Props) {
  const t = useT()
  const { onPointerDown, ripple } = useRipple()

  // Порядок веток — как в tweb: правка перебивает форвард, форвард перебивает ответ.
  let content: Content | null = null
  if (editing) {
    content = { icon: 'edit', title: t('Edit message'), subtitle: editing.text, onCancel: onCancelEdit }
  } else if (forward) {
    content = {
      icon: 'forward',
      title: forward.count === 1
        ? (forward.dropAuthor ? t('Forward Message (sender name hidden)') : t('Forward Message'))
        : `${t('Forward Messages')} (${forward.count})`,
      subtitle: forward.text,
      onCancel: onCancelForward,
      onClick: onOpenForwardMenu,
    }
  } else if (reply) {
    content = {
      icon: 'reply',
      // input.ts:4630 — `i18n('ReplyTo', [title])`, где title — узел
      // `span.peer-title` с именем автора (wrapPeerTitle).
      title: <>{t('Reply to')} <span className="peer-title">{reply.snapshotName ?? reply.name}</span></>,
      subtitle: reply.quote ? (
        <>
          <TgIcon name="quote_outline" size={13} style={{ verticalAlign: '-1px', marginRight: 3, opacity: 0.7 }} />
          {reply.quote.text}
        </>
      ) : reply.snapshotText ?? reply.text,
      rgb: hexToRgbTriplet(reply.color),
      onCancel: onCancelReply,
    }
  }

  // Плашка схлопывается анимацией, поэтому содержимое доживает до её конца.
  const [shown, setShown] = useState<Content | null>(content)
  const latest = useRef(content)
  latest.current = content
  const active = !!content
  useEffect(() => {
    if (latest.current) {
      setShown(latest.current)
      return
    }
    const id = window.setTimeout(() => setShown(null), COLLAPSE_MS)
    return () => window.clearTimeout(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, editing, forward, reply])

  const vars = shown?.rgb
    ? ({ '--peer-color-rgb': shown.rgb, '--peer-border-background': `rgb(${shown.rgb})` } as CSSProperties)
    : undefined

  return (
    <div className="reply-wrapper rows-wrapper-row">
      {shown && (
        <div className="reply-wrapper-content" style={vars}>
          <IconButton noRipple className="reply-icon">
            <TgIcon name={shown.icon} className="button-icon" size="inherit" />
          </IconButton>
          <div
            ref={bodyRef}
            className="reply quote-like quote-like-hoverable quote-like-border rp"
            style={vars}
            onPointerDown={onPointerDown}
            onClick={shown.onClick}
          >
            {ripple}
            <div className="reply-content">
              <div className="reply-title"><span className="i18n">{shown.title}</span></div>
              <div className="reply-subtitle"><span>{shown.subtitle}</span></div>
            </div>
          </div>
          <IconButton noRipple className="reply-cancel" onClick={shown.onCancel}>
            <TgIcon name="close" className="button-icon" size="inherit" />
          </IconButton>
        </div>
      )}
    </div>
  )
}
