// src/components/conversation/PinnedBar.tsx
// Плашка закреплённого сообщения — разметка tweb (`components/chat/pinnedMessage.tsx`
// + `topbarPlate.tsx`, живой DOM-референс docs/research/tweb-dom/03-pinned-plate.json):
// сегмент стека `.topbar-floating-plates`.
//
//   div.pinned-container.pinned-message[.is-many][.is-media] [data-mid]
//     button.btn-icon.rp.btn-menu-toggle.pinned-message-menu > div.c-ripple + span.tgico(pin)
//     div.pinned-container-wrapper.pinned-message-wrapper.hover-primary-effect.rp   ← onClick
//       div.c-ripple
//       div.pinned-message-border > …       ← индикатор-стек (PinnedBorder)
//       div.pinned-container-content.pinned-message-content
//         div.animated-super.pinned-message-media-container
//           div.animated-super-row.pinned-message-media > img
//         div.pinned-container-title.pinned-message-title > span.i18n + " " + div.animated-counter
//         div.pinned-container-subtitle.pinned-message-subtitle > div.animated-super > … > span
//     div.pinned-message-action > button.btn-icon.rp.pinned-message-unpin
//
// Клик по плашке — прыжок к показанному пину и перелистывание (onFollow);
// какой пин показан, решает usePinnedBar (в т.ч. по скроллу ленты).
// Memoized — only its own inputs (pins/index, searchOpen) re-render it.
import { memo } from 'react'
import IconButton from '../../shared/ui/IconButton'
import TgIcon from '../TgIcon'
import { useRipple } from '../../shared/ui/Ripple/useRipple'
import classNames from '../../shared/lib/classNames'
import { useT } from '../../i18n'
import type { Message } from '../../core/models'
import { pinBadgeNumber } from '../../core/pinnedCycle'
import { replyMediaLabel } from '../../core/messageToConvMsg'
import { useMediaThumb } from '../../core/hooks/useMediaThumb'
import PinnedBorder from './PinnedBorder'
import AnimatedSuper from './AnimatedSuper'

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

function PinnedBar({ pins, index, searchOpen, onFollow, onUnpin, onOpenList }: PinnedBarProps) {
  const t = useT()
  // tweb TopbarPlate.Body — это RippleElement: клик и ripple живут на wrapper,
  // не на корне плашки (корень `.pinned-message` — `cursor: initial`).
  const { onPointerDown: rippleDown, ripple } = useRipple()

  const shown = pins[index]
  const badge = pinBadgeNumber(index, pins.length)
  const isMany = pins.length > 1
  // tweb рисует превью и вешает `is-media` по ОДНОМУ признаку — `isMediaSet`,
  // который вернул wrapReplyDivAndCaption (pinnedMessage.tsx:546 → :561
  // `setIsMedia(isMediaSet)`, класс плашки — :223 `isMedia() && 'is-media'`;
  // при false ряд медиа ещё и снимается, :571-575 `animatedMedia.clearRows()`).
  // А false он у медиа без миниатюры — replyContainer.ts:79-81. Здесь тот же
  // признак — резолвнутый URL миниатюры: '' у голосового/аудио/файла без превью,
  // и тогда нет ни `<img>`, ни класса.
  const thumb = useMediaThumb(shown?.mediaId ?? null)

  if (searchOpen || pins.length === 0) return null

  return (
    <div
      className={classNames(
        'pinned-container', 'pinned-message',
        isMany ? 'is-many' : '',
        thumb ? 'is-media' : '',
      )}
      data-mid={shown?.id}
    >
      {/* tweb pinnedMessage.tsx:174-193 — ButtonMenuToggle({icon: 'pin'}) +
          `.pinned-message-menu`; видна всегда, а не только при нескольких пинах. */}
      <IconButton
        className="btn-menu-toggle pinned-message-menu"
        onClick={onOpenList}
        color="var(--secondary-text-color)"
        aria-label={t('Pinned Messages')}
      >
        <TgIcon name="pin" size={24} className="button-icon" />
      </IconButton>

      <div
        className="pinned-container-wrapper pinned-message-wrapper hover-primary-effect rp"
        onClick={onFollow}
        onPointerDown={rippleDown}
      >
        {ripple}
        {/* tweb pinnedMessageBorder.render(count, count - pinnedIndex - 1):
            сегменты по треку сверху вниз — верхний это старейший пин */}
        <PinnedBorder count={pins.length} index={pins.length - index - 1} />
        <div className="pinned-container-content pinned-message-content">
          <AnimatedSuper
            index={index}
            className="pinned-message-media-container"
            rowClassName="pinned-message-media"
          >
            {/* размеры/радиус/клип даёт ряд `.pinned-message-media`
                (_chatPinned.scss:141-165 + :390-392), картинке остаётся `> img` */}
            {thumb ? <img src={thumb} alt="" /> : null}
          </AnimatedSuper>
          <div className="pinned-container-title pinned-message-title">
            <span className="i18n">{t('Pinned Message')}</span>
            {' '}
            {/* tweb AnimatedCounter: «#N» проявляется на непервом пине,
                на новейшем (is-last) он схлопнут в scale(.68)/opacity 0 */}
            <div className={classNames('animated-counter', badge == null ? 'is-last' : '')}>{badge ?? ''}</div>
          </div>
          <div className="pinned-container-subtitle pinned-message-subtitle">
            <AnimatedSuper index={index}>
              {/* tweb wrapMessageForReply (messageForReply.ts:66) кладёт каждую
                  часть превью в `<span>` — включая лейбл медиа без подписи */}
              <span>{shown?.text || replyMediaLabel(shown?.type) || t('Message')}</span>
            </AnimatedSuper>
          </div>
        </div>
      </div>

      <div className="pinned-message-action">
        <IconButton
          className="pinned-message-unpin"
          onClick={(e) => { e.stopPropagation(); if (shown?.id != null) onUnpin(shown.id) }}
          color="var(--secondary-text-color)"
          aria-label={t('Unpin')}
        >
          <TgIcon name="close" size={24} className="button-icon" />
        </IconButton>
      </div>
    </div>
  )
}

export default memo(PinnedBar)
