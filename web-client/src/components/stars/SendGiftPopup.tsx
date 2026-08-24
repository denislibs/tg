// Попап отправки подарка (tweb PopupSendGift): каталог → выбор → экран
// отправки (сообщение + анонимно + «Подарить за N звёзд»). При нехватке звёзд —
// кнопка ведёт на пополнение (dev). Оплата списывает баланс, подарок уходит
// получателю сообщением типа 'gift'.
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import classNames from '../../shared/lib/classNames'
import IconButton from '../../shared/ui/IconButton'
import Text from '../../shared/ui/Text'
import TgSwitch from '../TgSwitch'
import TgIcon from '../TgIcon'
import { useManagers } from '../../core/hooks/useManagers'
import { useStarsBalance } from '../../stores/starsStore'
import { usePortalContainer } from '../../core/pip'
import { useT } from '../../i18n'
import type { StarGift } from '../../core/messages/messageAction'
import StarIcon from './StarIcon'
import { usePopupTransition } from '../settings/kit'
import StarsPopup from './StarsPopup'
import s from './stars.module.scss'

export default function SendGiftPopup({
  open, onClose, onExitComplete, toUserId, toName, onSent,
}: {
  open: boolean
  onClose: () => void
  /** вызывается после exit-анимации — для управления из popupStore (снять со стека) */
  onExitComplete?: () => void
  toUserId: number
  toName: string
  onSent?: () => void
}) {
  const t = useT()
  const managers = useManagers()
  const balance = useStarsBalance()
  const [catalog, setCatalog] = useState<StarGift[]>([])
  const [chosen, setChosen] = useState<StarGift | null>(null)
  const [message, setMessage] = useState('')
  const [anonymous, setAnonymous] = useState(false)
  const [busy, setBusy] = useState(false)
  const [topupOpen, setTopupOpen] = useState(false)
  const portalContainer = usePortalContainer()
  const { mounted, cls } = usePopupTransition(open)

  // popupStore снимает попап со стека только после exit-анимации
  const exitRef = useRef(onExitComplete)
  exitRef.current = onExitComplete
  const wasMounted = useRef(mounted)
  useEffect(() => {
    if (wasMounted.current && !mounted) exitRef.current?.()
    wasMounted.current = mounted
  }, [mounted])

  useEffect(() => {
    if (!open) return
    void managers.stars.catalog().then(setCatalog).catch(() => setCatalog([]))
    setChosen(null); setMessage(''); setAnonymous(false)
  }, [open, managers])

  const enough = chosen ? balance >= chosen.stars : false

  const send = async () => {
    if (!chosen || busy) return
    if (!enough) { setTopupOpen(true); return }
    setBusy(true)
    try {
      // Баланс после списания приезжает кадром `updateStarsBalance` — своего
      // значения ответ больше не несёт (второй источник одного факта).
      await managers.stars.send(toUserId, chosen.id, message.trim(), anonymous)
      onSent?.()
      onClose()
    } finally {
      setBusy(false)
    }
  }

  return createPortal(
    <>
      {mounted && (
        <div className={classNames('popup', cls, s.overlay)} onClick={onClose}>
          <div className={classNames('popup-container', s.modal)} onClick={(e) => e.stopPropagation()}>
            <div className={s.header}>
              <IconButton onClick={chosen ? () => setChosen(null) : onClose} color="var(--secondary-text-color)">
                <TgIcon name={chosen ? 'back' : 'close'} />
              </IconButton>
              <Text size={18} weight={600} color="var(--primary-text-color)" className={s.headerTitle}>
                {chosen ? t('Send a Gift') : t('Send a Gift')}
              </Text>
              <div className={s.balancePill} onClick={() => setTopupOpen(true)} style={{ cursor: 'pointer' }}>
                <StarIcon size={18} />
                {balance}
              </div>
            </div>

            <div className={s.body}>
              {!chosen ? (
                <div className={s.giftsGrid}>
                  {catalog.map((g) => (
                    <div
                      key={g.id}
                      className={s.giftCard + (g.pFlags?.sold_out ? ' ' + s.giftSoldOut : '')}
                      onClick={() => !g.pFlags?.sold_out && setChosen(g)}
                    >
                      {g.pFlags?.limited && (
                        <span className={s.giftLimitedBadge}>
                          {g.pFlags.sold_out ? t('Sold Out') : t('Limited')}
                        </span>
                      )}
                      <span className={s.giftEmoji}>{g.emoji}</span>
                      <span className={s.giftPrice}>
                        <StarIcon size={13} />
                        {g.stars}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className={s.chosen}>
                  <span className={s.chosenEmoji}>{chosen.emoji}</span>
                  <Text size={17} weight={600} color="var(--primary-text-color)">{chosen.title}</Text>
                  <Text size={14} color="var(--secondary-text-color)" style={{ textAlign: 'center' }}>
                    {t('Gift to')} {toName}
                  </Text>
                  <input
                    className={s.giftInput}
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    placeholder={t('Message (optional)')}
                    maxLength={255}
                  />
                  <div className={s.rowToggle} onClick={() => setAnonymous((v) => !v)}>
                    <span>{t('Hide my name')}</span>
                    <TgSwitch checked={anonymous} />
                  </div>
                  <button type="button" className={s.payBtn} disabled={busy} onClick={() => void send()}>
                    {enough ? (
                      <>
                        {t('Send for')} <StarIcon size={16} /> {chosen.stars}
                      </>
                    ) : (
                      t('Top up Stars')
                    )}
                  </button>
                  {!enough && (
                    <div className={s.notEnough}>{t('Not enough Stars — top up to continue.')}</div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <StarsPopup open={topupOpen} onClose={() => setTopupOpen(false)} />
    </>,
    portalContainer,
  )
}
