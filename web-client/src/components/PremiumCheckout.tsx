import { useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'framer-motion'
import Text from '../shared/ui/Text'
import TgIcon from './TgIcon'
import classNames from '../shared/lib/classNames'
import { useT } from '../i18n'
import { useManagers } from '../core/hooks/useManagers'
import { useChatsStore } from '../stores/chatsStore'
import { formatUsd, perMonthCents, type PremiumPlan } from '../core/premium/plans'
import {
  formatCardNumber,
  formatExpiry,
  isValidCard,
  isValidCardNumber,
  isValidCvc,
  isValidExpiry,
} from '../core/premium/card'
import s from './PremiumCheckout.module.scss'

// Mock card-payment sheet (tweb PopupPayment). Any well-formed, non-expired card
// is a "success": the server ignores card data and activates the subscription.
export default function PremiumCheckout({
  plan,
  open,
  onClose,
  onSuccess,
}: {
  plan: PremiumPlan
  open: boolean
  onClose: () => void
  onSuccess?: () => void
}) {
  const t = useT()
  const managers = useManagers()
  const setMe = useChatsStore((st) => st.setMe)
  const [number, setNumber] = useState('')
  const [expiry, setExpiry] = useState('')
  const [cvc, setCvc] = useState('')
  const [paying, setPaying] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const card = useMemo(() => ({ number, expiry, cvc }), [number, expiry, cvc])
  const valid = isValidCard(card)

  const pay = async () => {
    if (paying || !valid) return
    setPaying(true)
    setError(null)
    try {
      const { user } = await managers.premium.checkout(plan.id, card)
      setMe(user)
      onSuccess?.()
      onClose()
    } catch {
      setError(t('Payment failed. Please try again.'))
    } finally {
      setPaying(false)
    }
  }

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          className={s.overlay}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          onClick={onClose}
        >
          <motion.div
            className={s.dialog}
            initial={{ scale: 0.92, opacity: 0, y: 12 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.95, opacity: 0, y: 8 }}
            transition={{ type: 'spring', stiffness: 320, damping: 28 }}
            onClick={(e: React.MouseEvent) => e.stopPropagation()}
          >
            <div className={s.header}>
              <div className={s.close} onClick={onClose}>
                <TgIcon name="close" />
              </div>
              <Text size={19} weight={600} color="var(--tg-textPrimary)" className={s.title}>
                {t('Payment')}
              </Text>
            </div>

            <div className={s.body}>
              <div className={s.summary}>
                <div className={s.summaryIcon}>
                  <TgIcon name="star_filled" size={22} color="#fff" />
                </div>
                <div className={s.summaryBody}>
                  <Text size={16} weight={500} color="var(--tg-textPrimary)">
                    {t('Telegram Premium')} — {t(plan.labelKey)}
                  </Text>
                  <Text size={14} color="var(--tg-textSecondary)">
                    {formatUsd(perMonthCents(plan))} {t('per month')}
                  </Text>
                </div>
                <Text size={16} weight={600} color="var(--tg-textPrimary)">
                  {formatUsd(plan.priceCents)}
                </Text>
              </div>

              <div className={s.field}>
                <label className={s.label}>{t('Card Number')}</label>
                <input
                  className={classNames(s.input, number && !isValidCardNumber(number) ? s.inputError : '')}
                  inputMode="numeric"
                  autoComplete="cc-number"
                  placeholder="4242 4242 4242 4242"
                  value={number}
                  onChange={(e) => setNumber(formatCardNumber(e.target.value))}
                />
              </div>

              <div className={s.row}>
                <div className={s.field}>
                  <label className={s.label}>{t('Expiry')}</label>
                  <input
                    className={classNames(s.input, expiry && !isValidExpiry(expiry) ? s.inputError : '')}
                    inputMode="numeric"
                    autoComplete="cc-exp"
                    placeholder="MM/YY"
                    value={expiry}
                    onChange={(e) => setExpiry(formatExpiry(e.target.value))}
                  />
                </div>
                <div className={s.field}>
                  <label className={s.label}>CVC</label>
                  <input
                    className={classNames(s.input, cvc && !isValidCvc(cvc) ? s.inputError : '')}
                    inputMode="numeric"
                    autoComplete="cc-csc"
                    placeholder="123"
                    value={cvc}
                    maxLength={4}
                    onChange={(e) => setCvc(e.target.value.replace(/\D/g, '').slice(0, 4))}
                  />
                </div>
              </div>

              {error && (
                <Text size={14} color="var(--tg-danger, #e53935)" className={s.error}>
                  {error}
                </Text>
              )}
            </div>

            <div className={s.ctaWrap}>
              <motion.button
                type="button"
                className={s.cta}
                whileTap={valid && !paying ? { scale: 0.985 } : undefined}
                disabled={!valid || paying}
                onClick={() => void pay()}
              >
                {paying ? t('Processing…') : `${t('Pay')} ${formatUsd(plan.priceCents)}`}
              </motion.button>
              <Text size={12.5} color="var(--tg-textFaint)" className={s.disclaimer}>
                {t('This is a demo checkout. No real payment is processed.')}
              </Text>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  )
}
