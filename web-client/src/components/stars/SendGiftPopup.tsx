// Попап отправки подарка (tweb PopupSendGift): каталог → выбор → экран
// отправки (сообщение + анонимно + «Подарить за N звёзд»). При нехватке звёзд —
// кнопка ведёт на пополнение (dev). Оплата списывает баланс, подарок уходит
// получателю сообщением типа 'gift'.
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'framer-motion'
import IconButton from '../../shared/ui/IconButton'
import Text from '../../shared/ui/Text'
import TgSwitch from '../TgSwitch'
import TgIcon from '../TgIcon'
import { useManagers } from '../../core/hooks/useManagers'
import { useStarsStore } from '../../stores/starsStore'
import { usePortalContainer } from '../../core/pip'
import { useT } from '../../i18n'
import type { StarGift } from '../../core/managers/starsManager'
import StarIcon from './StarIcon'
import StarsPopup from './StarsPopup'
import s from './stars.module.scss'

const EASE: [number, number, number, number] = [0.4, 0, 0.2, 1]

export default function SendGiftPopup({
  open, onClose, toUserId, toName, onSent,
}: {
  open: boolean
  onClose: () => void
  toUserId: number
  toName: string
  onSent?: () => void
}) {
  const t = useT()
  const managers = useManagers()
  const balance = useStarsStore((st) => st.balance)
  const [catalog, setCatalog] = useState<StarGift[]>([])
  const [chosen, setChosen] = useState<StarGift | null>(null)
  const [message, setMessage] = useState('')
  const [anonymous, setAnonymous] = useState(false)
  const [busy, setBusy] = useState(false)
  const [topupOpen, setTopupOpen] = useState(false)
  const portalContainer = usePortalContainer()

  useEffect(() => {
    if (!open) return
    void managers.stars.catalog().then(setCatalog).catch(() => setCatalog([]))
    setChosen(null); setMessage(''); setAnonymous(false)
  }, [open, managers])

  const enough = chosen ? balance >= chosen.priceStars : false

  const send = async () => {
    if (!chosen || busy) return
    if (!enough) { setTopupOpen(true); return }
    setBusy(true)
    try {
      const { balance: bal } = await managers.stars.send(toUserId, chosen.id, message.trim(), anonymous)
      useStarsStore.getState().setBalance(bal)
      onSent?.()
      onClose()
    } finally {
      setBusy(false)
    }
  }

  return createPortal(
    <>
      <AnimatePresence>
        {open && (
          <motion.div
            className={s.overlay}
            onClick={onClose}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15, ease: EASE }}
          >
            <motion.div
              className={s.modal}
              onClick={(e) => e.stopPropagation()}
              initial={{ y: 40, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 40, opacity: 0 }}
              transition={{ duration: 0.18, ease: EASE }}
            >
              <div className={s.header}>
                <IconButton onClick={chosen ? () => setChosen(null) : onClose} color="var(--tg-textSecondary)">
                  <TgIcon name={chosen ? 'back' : 'close'} />
                </IconButton>
                <Text size={18} weight={600} color="var(--tg-textPrimary)" className={s.headerTitle}>
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
                        className={s.giftCard + (g.soldOut ? ' ' + s.giftSoldOut : '')}
                        onClick={() => !g.soldOut && setChosen(g)}
                      >
                        {g.total != null && (
                          <span className={s.giftLimitedBadge}>{g.soldOut ? t('Sold Out') : t('Limited')}</span>
                        )}
                        <span className={s.giftEmoji}>{g.emoji}</span>
                        <span className={s.giftPrice}>
                          <StarIcon size={13} />
                          {g.priceStars}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className={s.chosen}>
                    <span className={s.chosenEmoji}>{chosen.emoji}</span>
                    <Text size={17} weight={600} color="var(--tg-textPrimary)">{chosen.title}</Text>
                    <Text size={14} color="var(--tg-textSecondary)" style={{ textAlign: 'center' }}>
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
                          {t('Send for')} <StarIcon size={16} /> {chosen.priceStars}
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
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <StarsPopup open={topupOpen} onClose={() => setTopupOpen(false)} />
    </>,
    portalContainer,
  )
}
