// Попап баланса и пополнения звёзд (tweb PopupStars). Реального провайдера нет:
// пополнение — dev-операция (мгновенно зачисляет). Опции — как в tweb.
import { useState } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'framer-motion'
import IconButton from '../../shared/ui/IconButton'
import Text from '../../shared/ui/Text'
import TgIcon from '../TgIcon'
import { useManagers } from '../../core/hooks/useManagers'
import { useStarsStore } from '../../stores/starsStore'
import { usePortalContainer } from '../../core/pip'
import { useT } from '../../i18n'
import StarIcon from './StarIcon'
import s from './stars.module.scss'

const EASE: [number, number, number, number] = [0.4, 0, 0.2, 1]
const TOPUP_OPTIONS = [100, 250, 500, 1000, 2500, 5000]

export default function StarsPopup({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT()
  const managers = useManagers()
  const balance = useStarsStore((st) => st.balance)
  const [busy, setBusy] = useState(false)
  const portalContainer = usePortalContainer()

  const topUp = async (amount: number) => {
    if (busy) return
    setBusy(true)
    try {
      const bal = await managers.stars.topUp(amount)
      useStarsStore.getState().setBalance(bal) // мгновенно (WS balance_update тоже придёт)
    } finally {
      setBusy(false)
    }
  }

  return createPortal(
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
              <IconButton onClick={onClose} color="var(--tg-textSecondary)">
                <TgIcon name="close" />
              </IconButton>
              <Text size={18} weight={600} color="var(--tg-textPrimary)" className={s.headerTitle}>
                {t('Telegram Stars')}
              </Text>
            </div>

            <div className={s.body}>
              <div className={s.bigBalance}>
                <div className={s.bigBalanceRow}>
                  <StarIcon size={32} />
                  {balance}
                </div>
                <div className={s.bigBalanceLabel}>{t('Your balance')}</div>
              </div>

              <div className={s.optionsGrid}>
                {TOPUP_OPTIONS.map((amount) => (
                  <div key={amount} className={s.option} onClick={() => void topUp(amount)}>
                    <div className={s.optionStars}>
                      <StarIcon size={18} />
                      {amount}
                    </div>
                  </div>
                ))}
              </div>

              <Text size={13} color="var(--tg-textSecondary)" style={{ display: 'block', textAlign: 'center', marginTop: 16 }}>
                {t('Demo: top-up adds Stars instantly, no real payment.')}
              </Text>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    portalContainer,
  )
}
