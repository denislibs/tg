// Инфо подарка (tweb PopupStarGiftInfo): эмодзи, название, от кого, сообщение.
// Владельцу — действия: показать/скрыть в профиле, обменять на звёзды.
import { useState } from 'react'
import { createPortal } from 'react-dom'
import classNames from '../../shared/lib/classNames'
import IconButton from '../../shared/ui/IconButton'
import Text from '../../shared/ui/Text'
import TgIcon from '../TgIcon'
import { useManagers } from '../../core/hooks/useManagers'
import { useStarsStore } from '../../stores/starsStore'
import { usePortalContainer } from '../../core/pip'
import { fmtWhen } from '../../core/dialogToChat'
import { useT } from '../../i18n'
import type { GiftInfo } from '../../core/managers/starsManager'
import StarIcon from './StarIcon'
import { usePopupTransition } from '../settings/kit'
import s from './stars.module.scss'

export default function GiftInfoPopup({
  gift, isOwner, onClose, onChanged,
}: {
  gift: GiftInfo
  isOwner: boolean
  onClose: () => void
  onChanged?: () => void
}) {
  const t = useT()
  const managers = useManagers()
  const [busy, setBusy] = useState(false)
  const [hidden, setHidden] = useState(gift.hidden)
  const portalContainer = usePortalContainer()
  const { cls } = usePopupTransition(true)

  const toggleHidden = async () => {
    if (busy) return
    setBusy(true)
    try {
      await managers.stars.setHidden(gift.id, !hidden)
      setHidden(!hidden)
      onChanged?.()
    } finally { setBusy(false) }
  }

  const convert = async () => {
    if (busy) return
    setBusy(true)
    try {
      const bal = await managers.stars.convert(gift.id)
      useStarsStore.getState().setBalance(bal)
      onChanged?.()
      onClose()
    } finally { setBusy(false) }
  }

  const fromLabel = gift.anonymous && !isOwner
    ? t('Anonymous')
    : gift.fromName || t('Anonymous')
  const dateLabel = fmtWhen(gift.date)

  return createPortal(
    <div className={classNames('popup', cls, s.overlay)} onClick={onClose}>
      <div className={classNames('popup-container', s.modal)} onClick={(e) => e.stopPropagation()}>
        <div className={s.header}>
          <IconButton onClick={onClose} color="var(--secondary-text-color)">
            <TgIcon name="close" />
          </IconButton>
          <Text size={18} weight={600} color="var(--primary-text-color)" className={s.headerTitle}>
            {gift.gift.title}
          </Text>
        </div>

        <div className={s.body}>
          <div className={s.giftInfo}>
            <span className={s.chosenEmoji}>{gift.gift.emoji}</span>
            <Text size={17} weight={600} color="var(--primary-text-color)">{gift.gift.title}</Text>
            <Text size={14} color="var(--secondary-text-color)">
              {t('From')}: {fromLabel}{dateLabel ? ` · ${dateLabel}` : ''}
            </Text>
            {isOwner && gift.hidden && (
              <Text size={13} color="var(--secondary-text-color)">{t('Hidden from your profile')}</Text>
            )}
            {gift.message && (
              <Text size={15} color="var(--primary-text-color)" style={{ marginTop: 4 }}>{gift.message}</Text>
            )}
            <div className={s.giftPrice} style={{ marginTop: 6 }}>
              <StarIcon size={14} />
              {gift.gift.priceStars}
            </div>
          </div>

          {isOwner && !gift.converted && (
            <div className={s.giftInfoActions}>
              <button type="button" className={s.secondaryBtn} disabled={busy} onClick={() => void toggleHidden()}>
                {hidden ? t('Show in Profile') : t('Hide from Profile')}
              </button>
              <button type="button" className={s.payBtn} disabled={busy} onClick={() => void convert()}>
                {t('Convert to')} <StarIcon size={16} /> {gift.convertStars}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>,
    portalContainer,
  )
}
