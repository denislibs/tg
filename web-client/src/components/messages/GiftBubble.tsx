// Бабл сообщения-подарка (tweb StarGiftBubble): центрированная карточка с
// эмодзи подарка, подписью и кнопкой «Посмотреть». Клик открывает инфо-попап;
// получателю (владельцу) там доступны обмен на звёзды и показ/скрытие.
import { useState } from 'react'
import Text from '../../shared/ui/Text'
import { useT } from '../../i18n'
import type { MessageActionStarGift } from '../../core/messages/messageAction'
import StarIcon from '../stars/StarIcon'
import GiftInfoPopup from '../stars/GiftInfoPopup'
import s from './GiftBubble.module.scss'

export default function GiftBubble({ gift, date, out }: { gift: MessageActionStarGift; date: number; out: boolean }) {
  const t = useT()
  const [open, setOpen] = useState(false)
  // Владелец подарка — получатель (входящее сообщение), не отправитель.
  const isOwner = !out

  return (
    <>
      <div className={s.card} onClick={() => setOpen(true)}>
        <span className={s.emoji}>{gift.gift.emoji}</span>
        <Text size={16} weight={600} color="var(--primary-text-color)" style={{ textAlign: 'center' }}>
          {gift.gift.title}
        </Text>
        <div className={s.price}>
          <StarIcon size={14} />
          {gift.gift.stars}
        </div>
        {gift.message && (
          <Text size={14} color="var(--primary-text-color)" style={{ textAlign: 'center', marginTop: 2 }}>
            {gift.message.text}
          </Text>
        )}
        <div className={s.viewBtn}>{isOwner ? t('View Gift') : t('Gift Sent')}</div>
      </div>
      {open && (
        <GiftInfoPopup gift={gift} date={date} isOwner={isOwner} onClose={() => setOpen(false)} />
      )}
    </>
  )
}
