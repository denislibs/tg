// Бабл сообщения-подарка (tweb StarGiftBubble): центрированная карточка с
// эмодзи подарка, подписью и кнопкой «Посмотреть». Клик открывает инфо-попап;
// получателю (владельцу) там доступны обмен на звёзды и показ/скрытие.
import { useState } from 'react'
import Text from '../../shared/ui/Text'
import { useT } from '../../i18n'
import type { GiftInfo } from '../../core/managers/starsManager'
import StarIcon from '../stars/StarIcon'
import GiftInfoPopup from '../stars/GiftInfoPopup'
import s from './GiftBubble.module.scss'

export default function GiftBubble({ gift, out }: { gift: GiftInfo; out: boolean }) {
  const t = useT()
  const [open, setOpen] = useState(false)
  // Владелец подарка — получатель (входящее сообщение), не отправитель.
  const isOwner = !out

  return (
    <>
      <div className={s.card} onClick={() => setOpen(true)}>
        <span className={s.emoji}>{gift.gift.emoji}</span>
        <Text size={16} weight={600} color="var(--tg-textPrimary)" style={{ textAlign: 'center' }}>
          {gift.gift.title}
        </Text>
        <div className={s.price}>
          <StarIcon size={14} />
          {gift.gift.priceStars}
        </div>
        {gift.message && (
          <Text size={14} color="var(--tg-textPrimary)" style={{ textAlign: 'center', marginTop: 2 }}>
            {gift.message}
          </Text>
        )}
        <div className={s.viewBtn}>{isOwner ? t('View Gift') : t('Gift Sent')}</div>
      </div>
      {open && (
        <GiftInfoPopup gift={gift} isOwner={isOwner} onClose={() => setOpen(false)} />
      )}
    </>
  )
}
