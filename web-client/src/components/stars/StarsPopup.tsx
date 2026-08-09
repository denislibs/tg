// Попап баланса и пополнения звёзд (tweb PopupStars). Реального провайдера нет:
// пополнение — dev-операция (мгновенно зачисляет). Опции — как в tweb.
import { useState } from 'react'
import { createPortal } from 'react-dom'
import classNames from '../../shared/lib/classNames'
import IconButton from '../../shared/ui/IconButton'
import Text from '../../shared/ui/Text'
import TgIcon from '../TgIcon'
import { useManagers } from '../../core/hooks/useManagers'
import { useStarsBalance, setStarsBalance } from '../../stores/starsStore'
import { usePortalContainer } from '../../core/pip'
import { useT } from '../../i18n'
import StarIcon from './StarIcon'
import { usePopupTransition } from '../settings/kit'
import s from './stars.module.scss'

const TOPUP_OPTIONS = [100, 250, 500, 1000, 2500, 5000]

export default function StarsPopup({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT()
  const managers = useManagers()
  const balance = useStarsBalance()
  const [busy, setBusy] = useState(false)
  const portalContainer = usePortalContainer()
  const { mounted, cls } = usePopupTransition(open)

  const topUp = async (amount: number) => {
    if (busy) return
    setBusy(true)
    try {
      const bal = await managers.stars.topUp(amount)
      setStarsBalance(bal) // мгновенно (WS balance_update тоже придёт)
    } finally {
      setBusy(false)
    }
  }

  if (!mounted) return null

  return createPortal(
    <div className={classNames('popup', cls, s.overlay)} onClick={onClose}>
      <div className={classNames('popup-container', s.modal)} onClick={(e) => e.stopPropagation()}>
        <div className={s.header}>
          <IconButton onClick={onClose} color="var(--secondary-text-color)">
            <TgIcon name="close" />
          </IconButton>
          <Text size={18} weight={600} color="var(--primary-text-color)" className={s.headerTitle}>
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

          <Text size={13} color="var(--secondary-text-color)" style={{ display: 'block', textAlign: 'center', marginTop: 16 }}>
            {t('Demo: top-up adds Stars instantly, no real payment.')}
          </Text>
        </div>
      </div>
    </div>,
    portalContainer,
  )
}
