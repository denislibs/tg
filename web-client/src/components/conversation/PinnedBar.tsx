// src/components/conversation/PinnedBar.tsx
// Плашка закреплённого сообщения — разметка tweb (`components/chat/pinnedMessage.tsx`
// + живой DOM-референс §3): сегмент стека `.topbar-floating-plates`.
//
//   div.pinned-container.pinned-message[.is-many][.is-media] [data-mid]
//     button.pinned-message-menu            ← список пинов (только при is-many)
//     div.pinned-container-wrapper.pinned-message-wrapper
//       div.pinned-message-border > …       ← индикатор-стек (PinnedBorder)
//       div.pinned-container-content.pinned-message-content
//         div.animated-super.pinned-message-media-container
//         div.pinned-container-title.pinned-message-title > span.i18n + div.animated-counter
//         div.pinned-container-subtitle.pinned-message-subtitle > div.animated-super
//     div.pinned-message-action > button.pinned-message-unpin
//
// Клик по плашке — прыжок к показанному пину и перелистывание (onFollow);
// какой пин показан, решает usePinnedBar (в т.ч. по скроллу ленты).
// Memoized — only its own inputs (pins/index, searchOpen) re-render it.
import { memo } from 'react'
import IconButton from '../../shared/ui/IconButton'
import TgIcon from '../TgIcon'
import classNames from '../../shared/lib/classNames'
import { useT } from '../../i18n'
import type { Message } from '../../core/models'
import { pinBadgeNumber } from '../../core/pinnedCycle'
import { replyMediaLabel } from '../../core/messageToConvMsg'
import { useMediaThumb } from '../../core/hooks/useMediaThumb'
import PinnedBorder from './PinnedBorder'
import AnimatedSuper from './AnimatedSuper'
import s from './PinnedBar.module.scss'

export interface PinnedBarProps {
  pins: Message[]
  /** индекс показанного пина (0 = новейший) — из usePinnedBar */
  index: number
  searchOpen: boolean
  /** клик по плашке: прыжок к показанному пину + перелистывание */
  onFollow: () => void
  onUnpin: (id: number) => void
  /** открыть экран «Закреплённые сообщения» */
  onOpenList: () => void
}

/** Превью медиа пина 40×40 (tweb .pinned-message-media внутри animated-super). */
function PinnedMedia({ mediaId }: { mediaId: number }) {
  const url = useMediaThumb(mediaId)
  return <img className={classNames('pinned-message-media', s.media)} src={url || undefined} alt="" />
}

function PinnedBar({ pins, index, searchOpen, onFollow, onUnpin, onOpenList }: PinnedBarProps) {
  const t = useT()

  const shown = pins[index]
  const badge = pinBadgeNumber(index, pins.length)
  const isMany = pins.length > 1
  const mediaId = shown?.mediaId ?? null

  if (searchOpen || pins.length === 0) return null

  return (
    <div
      className={classNames(
        'pinned-container', 'pinned-message',
        isMany ? 'is-many' : '',
        mediaId ? 'is-media' : '',
        s.bar,
      )}
      data-mid={shown?.id}
      onClick={onFollow}
    >
      {/* tweb: слева кнопка списка пинов, видна только при нескольких пинах
          (_chatPinned.scss `:not(.is-many) .pinned-message-pinlist { display: none }`) */}
      <IconButton
        className="pinned-message-menu pinned-message-pinlist"
        onClick={(e) => { e.stopPropagation(); onOpenList() }}
        color="var(--secondary-text-color)"
        aria-label={t('Pinned Messages')}
      >
        <TgIcon name="pinlist" size={24} />
      </IconButton>

      <div className={classNames('pinned-container-wrapper', 'pinned-message-wrapper', s.wrapper)}>
        {/* tweb pinnedMessageBorder.render(count, count - pinnedIndex - 1):
            сегменты по треку сверху вниз — верхний это старейший пин */}
        <PinnedBorder count={pins.length} index={pins.length - index - 1} />
        <div className={classNames('pinned-container-content', 'pinned-message-content')}>
          <AnimatedSuper index={index} className="pinned-message-media-container">
            {mediaId ? <PinnedMedia mediaId={mediaId} /> : null}
          </AnimatedSuper>
          <div className={classNames('pinned-container-title', 'pinned-message-title')}>
            <span className="i18n">{t('Pinned message')}</span>
            {/* tweb AnimatedCounter: «#N» проявляется на непервом пине,
                на новейшем (is-last) он схлопнут в scale(.68)/opacity 0 */}
            <div className={classNames('animated-counter', badge == null ? 'is-last' : '')}>{badge ?? ''}</div>
          </div>
          <div className={classNames('pinned-container-subtitle', 'pinned-message-subtitle')}>
            <AnimatedSuper index={index}>
              {shown?.text || replyMediaLabel(shown?.type) || t('Message')}
            </AnimatedSuper>
          </div>
        </div>
      </div>

      <div className="pinned-message-action">
        <IconButton
          className="pinned-message-unpin pinned-message-close"
          onClick={(e) => { e.stopPropagation(); if (shown?.id != null) onUnpin(shown.id) }}
          color="var(--secondary-text-color)"
          aria-label={t('Unpin')}
        >
          <TgIcon name="close" size={24} />
        </IconButton>
      </div>
    </div>
  )
}

export default memo(PinnedBar)
