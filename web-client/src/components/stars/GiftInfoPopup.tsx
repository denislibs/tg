// Инфо подарка (tweb PopupStarGiftInfo): эмодзи, название, от кого, сообщение.
// Владельцу — действия: показать/скрыть в профиле, обменять на звёзды.
import { useState } from 'react'
import { createPortal } from 'react-dom'
import classNames from '../../shared/lib/classNames'
import IconButton from '../../shared/ui/IconButton'
import Text from '../../shared/ui/Text'
import TgIcon from '../TgIcon'
import { useManagers } from '../../core/hooks/useManagers'
import { setStarsBalance } from '../../stores/starsStore'
import { usePortalContainer } from '../../core/pip'
import { fmtWhen } from '../../core/dialogToChat'
import { useT } from '../../i18n'
import { isGiftConverted, isGiftHidden, type AnyStarGift } from '../../core/managers/starsManager'
import { usePeers } from '../../core/hooks/usePeers'
import { getPeerTitle } from '../../core/peers/getPeerTitle'
import { getPeerId } from '../../core/peers/peerId'
import StarIcon from './StarIcon'
import { usePopupTransition } from '../settings/kit'
import s from './stars.module.scss'

/**
 * Подарок приходит ДВУМЯ конструкторами одного предмета: в ленте это действие
 * пилюли (`messageActionStarGift`), в витрине профиля — `savedStarGift`. Попап
 * рисует оба, поэтому берёт объединение и спрашивает у него через
 * `isGiftHidden`/`isGiftConverted` — «скрыт» в двух конструкторах выражен
 * противоположными флагами (`unsaved` против `saved`), и это форма схемы.
 *
 * `date` приходит параметром: у витрины профиля дата — параметр конструктора, а
 * у пилюли её несёт САМО СООБЩЕНИЕ, и второй колонки под неё не заводится.
 */
export default function GiftInfoPopup({
  gift, date, isOwner, onClose, onChanged,
}: {
  gift: AnyStarGift
  /** когда подарен, СЕКУНДЫ эпохи */
  date: number
  isOwner: boolean
  onClose: () => void
  onChanged?: () => void
}) {
  const t = useT()
  const managers = useManagers()
  const [busy, setBusy] = useState(false)
  const [hidden, setHidden] = useState(isGiftHidden(gift))
  const portalContainer = usePortalContainer()
  const { cls } = usePopupTransition(true)
  // Даритель — ССЫЛКА на пир; имя собирает клиент. Анонимный подарок ссылки не
  // несёт вовсе — это и есть `pFlags.name_hidden`.
  const fromId = gift.from_id ? getPeerId(gift.from_id) : undefined
  const senders = usePeers(fromId != null ? [fromId] : [])
  const savedId = gift.saved_id ?? 0

  const toggleHidden = async () => {
    if (busy) return
    setBusy(true)
    try {
      await managers.stars.setHidden(savedId, !hidden)
      setHidden(!hidden)
      onChanged?.()
    } finally { setBusy(false) }
  }

  const convert = async () => {
    if (busy) return
    setBusy(true)
    try {
      const bal = await managers.stars.convert(savedId)
      setStarsBalance(bal)
      onChanged?.()
      onClose()
    } finally { setBusy(false) }
  }

  const fromLabel = fromId != null
    ? getPeerTitle({ peerId: fromId, peer: senders.get(fromId) })
    : t('Anonymous')
  const dateLabel = fmtWhen(new Date(date * 1000).toISOString())

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
            {isOwner && hidden && (
              <Text size={13} color="var(--secondary-text-color)">{t('Hidden from your profile')}</Text>
            )}
            {gift.message && (
              <Text size={15} color="var(--primary-text-color)" style={{ marginTop: 4 }}>{gift.message.text}</Text>
            )}
            <div className={s.giftPrice} style={{ marginTop: 6 }}>
              <StarIcon size={14} />
              {gift.gift.stars}
            </div>
          </div>

          {isOwner && !isGiftConverted(gift) && (
            <div className={s.giftInfoActions}>
              <button type="button" className={s.secondaryBtn} disabled={busy} onClick={() => void toggleHidden()}>
                {hidden ? t('Show in Profile') : t('Hide from Profile')}
              </button>
              <button type="button" className={s.payBtn} disabled={busy} onClick={() => void convert()}>
                {t('Convert to')} <StarIcon size={16} /> {gift.convert_stars ?? 0}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>,
    portalContainer,
  )
}
