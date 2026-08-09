import { useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import Text from '../shared/ui/Text'
import TgIcon from './TgIcon'
import classNames from '../shared/lib/classNames'
import { usePopupTransition } from './settings/kit'
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

  const { mounted, cls } = usePopupTransition(open)
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

  // Показ/скрытие — классы tweb `PopupElement` (`active`/`hiding`), см.
  // usePopupTransition в settings/kit.tsx: скрим набирает opacity, карточка едет
  // translate3d(0, 3rem, 0) → 0 за --popup-transition-time. Узел живёт в DOM до
  // конца затухания — роль AnimatePresence.
  if (!mounted) return null

  return createPortal(
    <div className={classNames('popup', cls, s.overlay)} onClick={onClose}>
      <div className={classNames('popup-container', s.dialog)} onClick={(e: React.MouseEvent) => e.stopPropagation()}>
        <div className={s.header}>
          <div className={s.close} onClick={onClose}>
            <TgIcon name="close" />
          </div>
          <Text size={19} weight={600} color="var(--primary-text-color)" className={s.title}>
            {t('Payment')}
          </Text>
        </div>

        <div className={s.body}>
          <div className={s.summary}>
            <div className={s.summaryIcon}>
              <TgIcon name="star_filled" size={22} color="#fff" />
            </div>
            <div className={s.summaryBody}>
              <Text size={16} weight={500} color="var(--primary-text-color)">
                {t('Telegram Premium')} — {t(plan.labelKey)}
              </Text>
              <Text size={14} color="var(--secondary-text-color)">
                {formatUsd(perMonthCents(plan))} {t('per month')}
              </Text>
            </div>
            <Text size={16} weight={600} color="var(--primary-text-color)">
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
            <Text size={14} color="#e53935" className={s.error}>
              {error}
            </Text>
          )}
        </div>

        <div className={s.ctaWrap}>
          {/* tweb не масштабирует кнопки по нажатию — отклик даёт ripple
              и фон (_button.scss:75-77); whileTap снят. */}
          <button
            type="button"
            className={s.cta}
            disabled={!valid || paying}
            onClick={() => void pay()}
          >
            {paying ? t('Processing…') : `${t('Pay')} ${formatUsd(plan.priceCents)}`}
          </button>
          <Text size={12.5} color="var(--secondary-text-color)" className={s.disclaimer}>
            {t('This is a demo checkout. No real payment is processed.')}
          </Text>
        </div>
      </div>
    </div>,
    document.body,
  )
}
